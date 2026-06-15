/**
 * signal-to-call orchestrator.
 *
 * Pure logic + dependency-injectable adapters so the chain is testable
 * end to end without hitting any live provider. The runtime skill
 * (.claude/skills/signal-to-call/SKILL.md) drives this from Claude.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

import { OUTBOUND_RULES } from '../../outbound/rules.js'

// ─── Public types ───────────────────────────────────────────────────────────

export interface SignalInput {
  source_url: string
  company_domain: string
  role: string
  posted_at?: string | null
}

export interface ResolvedPersona {
  segment_id: string
  segment_name: string
  seniority: 'executive' | 'manager' | 'ic'
}

export interface FiberResult {
  firstname: string
  lastname: string
  linkedin_url: string
  company: string
  title?: string
  email?: string | null
  /**
   * Free-form location string returned by Fiber. The orchestrator
   * inspects this to pick a timezone for the business-hours SLA. ISO
   * 3166-1 alpha-2 codes ("US", "DE") are honored verbatim; longer
   * forms ("United States", "Germany") are also recognized.
   */
  location?: string | null
}

export interface FullenrichResult {
  firstname: string
  lastname: string
  email: string | null
  email_status: string | null
  phone: string | null
}

export interface DryrunPayload {
  signal: SignalInput
  qualify: { verdict: 'pass' | 'fail'; failed_gate: string | null }
  persona: ResolvedPersona
  contact: {
    firstname: string
    lastname: string
    company: string
    linkedin_url: string
    email: string | null
    email_status: string | null
    phone: string | null
    phone_unavailable_reason: 'fiber_eu_coverage_gap' | null
  }
  opener: string
  task: { subject: string; due_at_iso: string; due_at_human: string }
  slack: { channel: string; preview: string }
  hubspot_calls_planned: Array<{ capability: string; provider: string }>
  started_at_iso: string
}

export interface SkillResult {
  dryrunPath: string
  dryrun: DryrunPayload
  pushed: boolean
  contactId?: string
  noteId?: string
  noteAssociated?: boolean
  taskId?: string
  durationMs: number
}

// ─── Dependency injection contract ──────────────────────────────────────────

export interface Deps {
  now(): Date
  loadFramework(): Promise<FrameworkLike>
  qualify(input: SignalInput): Promise<{ verdict: 'pass' | 'fail'; failed_gate: string | null }>
  peopleSearch(input: {
    company_name: string
    title: string
    query: string
    limit: number
  }): Promise<{ results: FiberResult[] }>
  peopleEnrich(input: {
    contacts: Array<{
      firstname: string
      lastname: string
      company_name: string
      linkedin_url: string
    }>
  }): Promise<{ results: FullenrichResult[] }>
  draftOpener(args: {
    firstname: string
    role: string
    company: string
    seniority: ResolvedPersona['seniority']
    sourceUrl: string
    phoneAvailable: boolean
  }): Promise<string>
  contactUpsert(input: {
    contact: {
      email: string | null
      firstname: string
      lastname: string
      company: string
      phone: string | null
      jobtitle: string
      linkedin_url: string
    }
  }): Promise<{ contactId: string }>
  attachNote(input: { contactId: string; body: string; timestamp: string }): Promise<{ noteId: string }>
  associateNoteToContact(input: { noteId: string; contactId: string }): Promise<{ associated: boolean }>
  createTask(input: { contactId: string; subject: string; body: string; dueAt: string }): Promise<{ taskId: string }>
  sendSlack(input: { event: string; data: Record<string, unknown> }): Promise<void>
  approve(prompt: string): Promise<boolean>
  writeDryrun(path: string, payload: DryrunPayload): void
  operatorTimezone(): string
}

export interface FrameworkLike {
  segments: Array<{
    id: string
    name: string
    priority: 'primary' | 'secondary' | 'exploratory'
    targetRoles: string[]
    keyDecisionMakers: string[]
  }>
}

// ─── Public constants ───────────────────────────────────────────────────────

export const APPROVAL_PROMPT =
  "Push contact + 12h task to HubSpot and send the Slack DM? Type 'approve' to proceed, anything else to abort."

export const SLA_HOURS = 12

// ─── Core algorithm ─────────────────────────────────────────────────────────

export function deriveSeniority(role: string): ResolvedPersona['seniority'] {
  if (/^(vp|svp|chief|head of)\b/i.test(role)) return 'executive'
  if (/^(director|manager|lead)\b/i.test(role)) return 'manager'
  return 'ic'
}

export function resolvePersona(role: string, framework: FrameworkLike): ResolvedPersona | null {
  const lower = role.toLowerCase()
  const tokens = lower
    .split(/\s+/)
    .filter((t) => !['at', 'of', 'the', 'a', 'an', 'for'].includes(t))

  const ordered = [...framework.segments].sort((a, b) => {
    const order = { primary: 0, secondary: 1, exploratory: 2 } as const
    return order[a.priority] - order[b.priority]
  })

  for (const seg of ordered) {
    const all = [...(seg.targetRoles ?? []), ...(seg.keyDecisionMakers ?? [])].map((s) =>
      s.toLowerCase(),
    )
    if (all.some((t) => t === lower)) {
      return { segment_id: seg.id, segment_name: seg.name, seniority: deriveSeniority(role) }
    }
  }

  let bestScore = 0
  let bestSeg: FrameworkLike['segments'][number] | null = null
  for (const seg of ordered) {
    const targetTokens = (seg.targetRoles ?? []).flatMap((r) => r.toLowerCase().split(/\s+/))
    const score = tokens.filter((t) => targetTokens.includes(t)).length
    if (score > bestScore) {
      bestScore = score
      bestSeg = seg
    }
  }
  if (bestScore === 0 || !bestSeg) return null
  return { segment_id: bestSeg.id, segment_name: bestSeg.name, seniority: deriveSeniority(role) }
}

export function validateOpener(opener: string): boolean {
  const rule = OUTBOUND_RULES.find((r) => r.id === 'no-dash-punctuation')
  if (!rule) return true
  return rule.check(opener)
}

/**
 * Map an ISO 3166-1 alpha-2 country code (or a permissive longer form
 * like `"United States"` / `"USA"`) to an IANA timezone we trust for
 * the prospect's business hours. Falls back to `America/New_York`.
 * Kept deliberately small: cover the ten regions that Agent 1 sees in
 * practice and trust the operator to pass a code when they have one.
 */
const COUNTRY_TO_TZ: Record<string, string> = {
  US: 'America/New_York',
  USA: 'America/New_York',
  'UNITED STATES': 'America/New_York',
  UK: 'Europe/London',
  GB: 'Europe/London',
  'UNITED KINGDOM': 'Europe/London',
  DE: 'Europe/Berlin',
  GERMANY: 'Europe/Berlin',
  FR: 'Europe/Paris',
  FRANCE: 'Europe/Paris',
  NL: 'Europe/Amsterdam',
  NETHERLANDS: 'Europe/Amsterdam',
  ES: 'Europe/Madrid',
  SPAIN: 'Europe/Madrid',
  IT: 'Europe/Rome',
  ITALY: 'Europe/Rome',
  SE: 'Europe/Stockholm',
  SWEDEN: 'Europe/Stockholm',
  CA: 'America/Toronto',
  CANADA: 'America/Toronto',
  AU: 'Australia/Sydney',
  AUSTRALIA: 'Australia/Sydney',
}

export function timezoneForCountry(code?: string | null): string {
  if (!code) return 'America/New_York'
  const key = code.trim().toUpperCase()
  return COUNTRY_TO_TZ[key] ?? 'America/New_York'
}

/**
 * Parts of a Date as observed in a target IANA timezone.
 */
interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number // 0 = Sun .. 6 = Sat
}

function partsInZone(d: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  })
  const parts = fmt.formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour: parseInt(get('hour'), 10) % 24,
    minute: parseInt(get('minute'), 10),
    weekday: weekdayMap[get('weekday')] ?? 0,
  }
}

/**
 * Convert local wall-clock components in `timeZone` to an absolute
 * Date (UTC instant). Iteratively refines for DST so callers never
 * need to know the offset themselves.
 */
function zonedDateToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // Start from a naive UTC instant for the same wall components.
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute))
  for (let i = 0; i < 3; i++) {
    const parts = partsInZone(guess, timeZone)
    const guessAsLocalUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute)
    const diff = targetAsUtc - guessAsLocalUtc
    if (diff === 0) break
    guess = new Date(guess.getTime() + diff)
  }
  return guess
}

/**
 * Compute the SLA `dueAt` in the prospect's local timezone. The 12-hour
 * cap is the baseline; we shift to the next business morning when the
 * cap would land outside working hours. Concretely:
 *
 *   - Signal arrives Mon-Fri 06:00-18:00 local: due = now + 12h.
 *   - Signal arrives Mon-Fri 18:00-21:00 local: due = min(now + 12h,
 *     next business day 09:00 local).
 *   - Signal arrives Mon-Fri 21:00-06:00 (overnight) or on a weekend:
 *     due = next business day 09:00 local. The 12-hour ceiling is
 *     informational only here; we trade a tighter cap for a humane
 *     working-hours target, because dispatching a call task at 03:00
 *     local helps nobody.
 *
 * Prospect timezone is derived from `prospectCountryCode` via
 * `timezoneForCountry`. Defaults to `America/New_York` when unknown.
 */
export function computeDueAt(
  now: Date,
  prospectCountryCode?: string | null,
): { iso: string; human: (tz: string) => string } {
  const tz = timezoneForCountry(prospectCountryCode ?? undefined)
  const twelveHourCeiling = new Date(now.getTime() + SLA_HOURS * 60 * 60 * 1000)
  const nextBizMorning = nextBusinessMorning(now, tz)

  const nowParts = partsInZone(now, tz)
  const isWeekend = (wd: number) => wd === 0 || wd === 6
  const inDaytime = nowParts.hour >= 6 && nowParts.hour < 18
  const inEvening = nowParts.hour >= 18 && nowParts.hour < 21

  let due: Date
  if (!isWeekend(nowParts.weekday) && inDaytime) {
    due = twelveHourCeiling
  } else if (!isWeekend(nowParts.weekday) && inEvening) {
    due = twelveHourCeiling.getTime() < nextBizMorning.getTime() ? twelveHourCeiling : nextBizMorning
  } else {
    // Overnight (21:00-06:00) or weekend: working-hours target wins.
    due = nextBizMorning
  }

  const iso = due.toISOString()
  return {
    iso,
    human: (humanTz: string) =>
      new Date(iso).toLocaleString('en-US', { timeZone: humanTz, dateStyle: 'medium', timeStyle: 'short' }),
  }
}

/**
 * The next Mon-to-Fri 09:00 in `tz`, strictly after `now`. Exported
 * for tests; the orchestrator routes through `computeDueAt`.
 */
export function nextBusinessMorning(now: Date, tz: string): Date {
  const isWeekend = (wd: number) => wd === 0 || wd === 6
  const nowParts = partsInZone(now, tz)
  // First candidate: today's 09:00 local.
  let candidate = zonedDateToUtc(tz, nowParts.year, nowParts.month, nowParts.day, 9, 0)
  for (let i = 0; i < 10; i++) {
    const cp = partsInZone(candidate, tz)
    if (!isWeekend(cp.weekday) && candidate.getTime() > now.getTime()) return candidate
    // Walk one calendar day forward in the prospect's tz, then realign
    // to 09:00 local. Add 25h to comfortably skip any DST boundary.
    const bump = new Date(candidate.getTime() + 25 * 60 * 60 * 1000)
    const bp = partsInZone(bump, tz)
    candidate = zonedDateToUtc(tz, bp.year, bp.month, bp.day, 9, 0)
  }
  return candidate
}

export function defaultDryrunPath(now: Date): string {
  const ts = now.toISOString().replace(/[:.]/g, '-')
  const dir = join(homedir(), '.gtm-os', 'signal-to-call')
  mkdirSync(dir, { recursive: true })
  return join(dir, `dryrun-${ts}.json`)
}

export function writeDryrunFile(path: string, payload: DryrunPayload): void {
  writeFileSync(path, JSON.stringify(payload, null, 2))
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class SkillHalt extends Error {
  readonly code: string
  constructor(code: string, message?: string) {
    super(message ?? code)
    this.code = code
    this.name = 'SkillHalt'
  }
}

// ─── The chain ──────────────────────────────────────────────────────────────

export async function runSignalToCall(input: SignalInput, deps: Deps): Promise<SkillResult> {
  const started = deps.now()
  const startedIso = started.toISOString()

  // Stage 2: qualify (dry run)
  const qualify = await deps.qualify(input)
  if (qualify.verdict === 'fail') {
    throw new SkillHalt('qualifier_off_icp', `Qualifier failed gate: ${qualify.failed_gate}`)
  }

  // Stage 3: persona
  const framework = await deps.loadFramework()
  const persona = resolvePersona(input.role, framework)
  if (!persona) {
    throw new SkillHalt('persona_unresolved', `No segment claims role ${input.role}`)
  }

  // Stage 4: Fiber search
  const companyName = humanizeDomain(input.company_domain)
  const search = await deps.peopleSearch({
    company_name: companyName,
    title: input.role,
    query: `${input.role} at ${companyName}`,
    limit: 5,
  })
  const top = (search.results ?? []).find((r) => r.linkedin_url && r.linkedin_url.length > 0)
  if (!top) {
    throw new SkillHalt('no_contact_found', `Fiber returned 0 usable results for ${input.role} at ${companyName}`)
  }

  // Stage 6: FullEnrich
  const enrich = await deps.peopleEnrich({
    contacts: [
      {
        firstname: top.firstname,
        lastname: top.lastname,
        company_name: top.company,
        linkedin_url: top.linkedin_url,
      },
    ],
  })
  const enriched = enrich.results?.[0]
  const email = enriched?.email ?? null
  const phone = enriched?.phone ?? null
  const emailStatus = enriched?.email_status ?? null
  const phoneUnavailableReason: 'fiber_eu_coverage_gap' | null = phone ? null : 'fiber_eu_coverage_gap'

  if (!email && !phone) {
    throw new SkillHalt('enrichment_failed', 'Both email and phone empty after FullEnrich')
  }

  // Stage 7: opener
  let opener = await deps.draftOpener({
    firstname: top.firstname,
    role: input.role,
    company: companyName,
    seniority: persona.seniority,
    sourceUrl: input.source_url,
    phoneAvailable: !!phone,
  })
  if (!validateOpener(opener)) {
    opener = await deps.draftOpener({
      firstname: top.firstname,
      role: input.role,
      company: companyName,
      seniority: persona.seniority,
      sourceUrl: input.source_url,
      phoneAvailable: !!phone,
    })
    if (!validateOpener(opener)) {
      throw new SkillHalt('opener_failed_validation', 'Opener contains dash punctuation after one regenerate')
    }
  }

  // Stage 8: dueAt (business-hours-aware in prospect tz, capped at 12h)
  const prospectCountry = extractCountryCode(top.location)
  const due = computeDueAt(started, prospectCountry)
  const tz = deps.operatorTimezone()

  // Stage 9a: dryrun payload
  const taskSubject = phone
    ? `Call ${top.firstname} re: ${input.role}`
    : `Email ${top.firstname} re: ${input.role}`
  const slackPreview = phone
    ? `${top.firstname} ${top.lastname} at ${top.company}. Verified mobile ready. Opener: ${opener}`
    : `${top.firstname} ${top.lastname} at ${top.company}. Phone gap: EU coverage unavailable. Email this contact instead. Opener: ${opener}`

  const dryrun: DryrunPayload = {
    signal: {
      source_url: input.source_url,
      company_domain: input.company_domain,
      role: input.role,
      posted_at: input.posted_at ?? null,
    },
    qualify: { verdict: 'pass', failed_gate: qualify.failed_gate ?? null },
    persona,
    contact: {
      firstname: top.firstname,
      lastname: top.lastname,
      company: top.company,
      linkedin_url: top.linkedin_url,
      email,
      email_status: emailStatus,
      phone,
      phone_unavailable_reason: phoneUnavailableReason,
    },
    opener,
    task: { subject: taskSubject, due_at_iso: due.iso, due_at_human: due.human(tz) },
    slack: { channel: 'operator-dm', preview: slackPreview },
    hubspot_calls_planned: [
      { capability: 'crm-contact-upsert', provider: 'hubspot' },
      { capability: 'crm-attach-note', provider: 'hubspot' },
      { capability: 'crm-associate-note-to-contact', provider: 'hubspot' },
      { capability: 'crm-create-task', provider: 'hubspot' },
    ],
    started_at_iso: startedIso,
  }

  const dryrunPath = defaultDryrunPath(started)
  deps.writeDryrun(dryrunPath, dryrun)

  // Stage 9b: hard approval
  const approved = await deps.approve(APPROVAL_PROMPT)
  if (!approved) {
    return {
      dryrunPath,
      dryrun,
      pushed: false,
      durationMs: deps.now().getTime() - started.getTime(),
    }
  }

  // Stage 9c: push (no silent retries)
  const { contactId } = await deps.contactUpsert({
    contact: {
      email,
      firstname: top.firstname,
      lastname: top.lastname,
      company: top.company,
      phone,
      jobtitle: input.role,
      linkedin_url: top.linkedin_url,
    },
  })

  const { noteId } = await deps.attachNote({
    contactId,
    body: `Signal: ${input.role} opened at ${input.company_domain} (${input.posted_at ?? 'date unknown'}). Source: ${input.source_url}.`,
    timestamp: startedIso,
  })

  // Associate the note to the contact timeline. The note-create call
  // returns a noteId but does NOT link it to the contact in HubSpot;
  // this second call writes the default `note_to_contact` association
  // so the activity surfaces on the contact record. If the association
  // fails, the note still exists; we surface a Slack DM telling the
  // operator to fix the link manually in HubSpot rather than halting.
  let noteAssociated = false
  try {
    const assoc = await deps.associateNoteToContact({ noteId, contactId })
    noteAssociated = assoc.associated === true
    if (!noteAssociated) {
      await deps.sendSlack({
        event: 'signal_to_call_note_association_failed',
        data: {
          leadName: `${top.firstname} ${top.lastname}`,
          contactId,
          noteId,
          reason: 'association_returned_false',
        },
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await deps.sendSlack({
      event: 'signal_to_call_note_association_failed',
      data: {
        leadName: `${top.firstname} ${top.lastname}`,
        contactId,
        noteId,
        reason: message,
      },
    })
  }

  const { taskId } = await deps.createTask({
    contactId,
    subject: taskSubject,
    body: opener,
    dueAt: due.iso,
  })

  await deps.sendSlack({
    event: 'signal_to_call_ready',
    data: {
      leadName: `${top.firstname} ${top.lastname}`,
      campaignTitle: `${top.company} - ${input.role}`,
      campaignId: contactId,
      replyPreview: opener,
      phoneUnavailableReason,
      noteAssociated,
    },
  })

  return {
    dryrunPath,
    dryrun,
    pushed: true,
    contactId,
    noteId,
    noteAssociated,
    taskId,
    durationMs: deps.now().getTime() - started.getTime(),
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function humanizeDomain(domain: string): string {
  const base = domain.replace(/^https?:\/\//, '').split('/')[0]
  const root = base.split('.')[0]
  return root.charAt(0).toUpperCase() + root.slice(1)
}

/**
 * Pull a country signal out of a free-form Fiber `location` string.
 * Recognizes trailing ISO 3166-1 alpha-2 codes ("San Francisco, US"),
 * common long forms ("Berlin, Germany"), and bare codes ("US"). Returns
 * `null` when nothing recognizable surfaces so `computeDueAt` falls
 * back to its US default.
 */
export function extractCountryCode(location?: string | null): string | null {
  if (!location) return null
  const trimmed = location.trim()
  if (!trimmed) return null
  // Try trailing token after the last comma first.
  const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean)
  const candidates: string[] = []
  if (parts.length > 0) candidates.push(parts[parts.length - 1])
  candidates.push(trimmed)
  const KNOWN = new Set([
    'US', 'USA', 'UNITED STATES',
    'UK', 'GB', 'UNITED KINGDOM',
    'DE', 'GERMANY',
    'FR', 'FRANCE',
    'NL', 'NETHERLANDS',
    'ES', 'SPAIN',
    'IT', 'ITALY',
    'SE', 'SWEDEN',
    'CA', 'CANADA',
    'AU', 'AUSTRALIA',
  ])
  for (const c of candidates) {
    const key = c.toUpperCase()
    if (KNOWN.has(key)) return key
  }
  return null
}
