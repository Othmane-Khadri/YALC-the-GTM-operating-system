/**
 * TypeScript facade for the lemlist-campaign-from-icp 25-stage chain.
 *
 * Mirrors `.claude/skills/lemlist-campaign-from-icp/SKILL.md` 1:1 in
 * behaviour. The chain collapses cleanly into nine code phases:
 *
 *   Phase 1 :  Strategic foundation (stages 1-7, LLM atoms).
 *   Phase 2 :  Sourcing shape (stages 8-10, LLM atoms).
 *   Phase 3 :  Filter registry + people-database search (stage 11, MCP).
 *   Phase 4 :  Enrichment posture (stage 12, computed).
 *   Phase 5 :  Per-lead angles (stage 13, LLM atom).
 *   Phase 6 :  Campaign design (stages 14-15, LLM atoms).
 *   Phase 7 :  Seniority-routed copy (stages 16-20, LLM atoms).
 *   Phase 8 :  Quality gate (stages 21-23, LLM atoms + dash scan).
 *   Phase 9 :  Dryrun JSON, approval gate, MCP push (stages 24-25).
 *
 * Hard contract: never auto-starts the campaign.
 *   - `create_campaign_with_sequence` is the only state-changing call to the
 *     campaign object. The default Lemlist state for that endpoint is DRAFT.
 *   - `set_campaign_state` is never called by this module. The optional
 *     client method is present in the type so consumers can wire it for
 *     other flows; the facade itself does not invoke it.
 *   - The voice rail strips em-dashes and en-dashes from drafted copy and
 *     regenerates once on a failed dash scan; a second failure halts the
 *     push with `state: 'failed'` so a malformed sequence never ships.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

import type {
  DryrunLead,
  DryrunPayload,
  DryrunPersona,
  DryrunSequenceStep,
  LemlistCampaignFromIcpBrief,
  LemlistCampaignFromIcpInput,
  LemlistCampaignResult,
  LemlistMcpClient,
  LemlistSearchLead,
  LlmAtomName,
  LlmClient,
} from './types.js'

const DEFAULT_LEAD_CAP = 50
const MAX_LEAD_CAP = 100
const DEFAULT_TIMEZONE = 'Europe/Paris'
const DEFAULT_SENDER = 'sender@example.com'

const EM_DASH = '—'
const EN_DASH = '–'
const DASH_SCAN_RE = new RegExp(`[${EM_DASH}${EN_DASH}]`)
const CONCRETE_NUMBER_RE = /\d/
const QUESTION_END_RE = /\?\s*$/

const TIERS = ['VP+', 'Manager', 'IC'] as const
type Tier = (typeof TIERS)[number]

function getDryrunDir(): string {
  return path.join(homedir(), '.gtm-os', 'lemlist-campaign-from-icp')
}

function tsForFile(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-')
}

async function defaultWriteDryrun(targetPath: string, payload: DryrunPayload): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8')
}

/** Strict JSON extractor: tolerates a single code-fence wrap. */
function parseAtomJson<T>(raw: string, atom: LlmAtomName): T {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned) as T
  } catch (err) {
    throw new Error(
      `[lemlist-facade] atom '${atom}' returned non-JSON output: ${(err as Error).message}`,
    )
  }
}

async function callAtom<T>(
  llm: LlmClient,
  atom: LlmAtomName,
  input: Record<string, unknown>,
): Promise<T> {
  const { raw } = await llm.call(atom, input)
  return parseAtomJson<T>(raw, atom)
}

function splitName(fullName: string): { firstName: string; lastName?: string } {
  const idx = fullName.indexOf(' ')
  if (idx === -1) return { firstName: fullName }
  return { firstName: fullName.slice(0, idx), lastName: fullName.slice(idx + 1) }
}

function mapSeniority(s: string | undefined): 'VP+' | 'Manager' | 'IC' {
  if (!s) return 'IC'
  if (s === 'Executive Leadership' || s === 'Department Leadership') return 'VP+'
  if (s === 'People Management / Leadership') return 'Manager'
  return 'IC'
}

function pickRoutedSkill(tier: 'VP+' | 'Manager' | 'IC'): LlmAtomName {
  if (tier === 'VP+') return 'copywriting-vp-sequence'
  if (tier === 'Manager') return 'copywriting-manager-sequence'
  return 'copywriting-ic-sequence'
}

function defaultTitleFromBrief(brief: LemlistCampaignFromIcpBrief): string {
  const trimmed = brief.icp.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 80) return trimmed
  return trimmed.slice(0, 77) + '...'
}

function hasDash(text: string): boolean {
  return DASH_SCAN_RE.test(text)
}

function sequenceHasDash(steps: DryrunSequenceStep[]): boolean {
  return steps.some((s) => hasDash(s.body) || (s.subject != null && hasDash(s.subject)))
}

function bodyMissingNumber(body: string): boolean {
  return !CONCRETE_NUMBER_RE.test(body)
}

function bodyMissingQuestion(body: string): boolean {
  return !QUESTION_END_RE.test(body)
}

function sequenceMissingNumber(steps: DryrunSequenceStep[]): boolean {
  return steps.some((s) => bodyMissingNumber(s.body))
}

function sequenceMissingQuestion(steps: DryrunSequenceStep[]): boolean {
  return steps.some((s) => bodyMissingQuestion(s.body))
}

// ── Atom output contracts (the strict subset the facade depends on) ─────────

interface IcpOut {
  industries?: string[]
  geo?: string[]
  size_range_employees?: string[]
  active_signals?: string[]
}
interface PersonaOut {
  personas: Array<{
    title_patterns: string[]
    seniority_tier?: string
    pains_identified?: string[]
  }>
}
interface PainOut {
  pains?: string[]
}
interface ValuePropOut {
  value_props?: string[]
}
interface OfferOut {
  offer?: string
}
interface CompetitorOut {
  competitors?: Array<{ name: string; differentiation: string }>
}
interface TriggerOut {
  triggers?: string[]
}
interface CompanyFinderOut {
  firmographic_filters?: Array<{ filterId: string; in?: unknown[]; out?: unknown[] }>
}
interface ListBuilderOut {
  combined_filters?: Array<{ filterId: string; in?: unknown[]; out?: unknown[] }>
}
interface PeopleFinderOut {
  persona_filters?: Array<{ filterId: string; in?: unknown[]; out?: unknown[] }>
}
interface AngleOut {
  angle?: string
}
interface CampaignAngleOut {
  chosen_angle?: string
}
interface ArchitectOut {
  sequence_shape?: { steps: Array<{ delay_days: number; channel: 'email' | 'linkedin' }> }
}
interface CopyOut {
  emails: Array<{ subject: string; body: string }>
}
interface AnalyzerOut {
  score?: number | null
  improvement_notes?: string[]
}
interface ThinkerOut {
  weakest_assumption?: string
}

// ── Phases ──────────────────────────────────────────────────────────────────

interface StrategicFoundation {
  icp: IcpOut
  personas: PersonaOut['personas']
  pains: string[]
  valueProps: string[]
  offer: string
  competitors: Array<{ name: string; differentiation: string }>
  triggers: string[]
}

async function runStrategicFoundation(
  brief: LemlistCampaignFromIcpBrief,
  llm: LlmClient,
): Promise<StrategicFoundation> {
  const icp = await callAtom<IcpOut>(llm, 'icp-definer', { brief: brief.icp })
  const personaRaw = await callAtom<PersonaOut>(llm, 'persona-definer', { icp })
  const personas = (personaRaw.personas ?? []).map((p) => {
    const tier = (p.seniority_tier ?? '').trim()
    let normalized: 'VP+' | 'Manager' | 'IC'
    if (tier === 'VP+' || tier === 'Manager' || tier === 'IC') {
      normalized = tier
    } else {
      const heuristic = (p.title_patterns ?? []).join(' ').toLowerCase()
      if (/(vp|svp|chief|c[a-z]o)\b/.test(heuristic)) normalized = 'VP+'
      else if (/(manager|head of|director)/.test(heuristic)) normalized = 'Manager'
      else normalized = 'IC'
    }
    return { ...p, seniority_tier: normalized }
  })
  if (personas.length === 0) {
    throw new Error('[lemlist-facade] persona-definer returned zero personas')
  }
  const pains = (await callAtom<PainOut>(llm, 'pain-identifier', { personas })).pains ?? []
  const valueProps =
    (await callAtom<ValuePropOut>(llm, 'value-prop-lister', { icp, personas })).value_props ?? []
  const offerOut = await callAtom<OfferOut>(llm, 'offer-definer', { valueProps })
  const offer = offerOut.offer ?? valueProps[0] ?? ''
  const competitors =
    (await callAtom<CompetitorOut>(llm, 'competitor-finder', { icp, personas })).competitors ?? []
  const triggers = (await callAtom<TriggerOut>(llm, 'trigger-finder', { icp, personas })).triggers ?? []
  return { icp, personas, pains, valueProps, offer, competitors, triggers }
}

interface SourcingShape {
  filters: Array<{ filterId: string; in?: unknown[]; out?: unknown[] }>
}

async function runSourcingShape(
  foundation: StrategicFoundation,
  llm: LlmClient,
): Promise<SourcingShape> {
  const company = await callAtom<CompanyFinderOut>(llm, 'company-finder', { icp: foundation.icp })
  const combined = await callAtom<ListBuilderOut>(llm, 'list-builder', {
    firmographic_filters: company.firmographic_filters ?? [],
    triggers: foundation.triggers,
  })
  const people = await callAtom<PeopleFinderOut>(llm, 'people-finder', {
    personas: foundation.personas,
  })
  const merged = [...(combined.combined_filters ?? []), ...(people.persona_filters ?? [])]
  return { filters: merged }
}

async function runSearch(
  client: LemlistMcpClient,
  shape: SourcingShape,
  cap: number,
): Promise<LemlistSearchLead[]> {
  // 11a: fetch the active filter registry. The facade does not need to keep
  // the full registry payload around :  the call exists so the orchestrator
  // can fail loudly when the MCP transport rejects the operator's API key.
  await client.getLemleadsFilters()
  // 11b: people-database search, deduped by linkedin_url + email.
  const res = await client.lemleadsSearch({
    mode: 'people',
    filters: shape.filters,
    size: cap,
    excludes: [
      'experiences',
      'interests',
      'languages',
      'inferred_skills',
      'lead_logo_url',
      'company_description',
      'techno_used_array',
    ],
  })
  const seenLinkedin = new Set<string>()
  const seenEmail = new Set<string>()
  const deduped: LemlistSearchLead[] = []
  for (const lead of res.leads) {
    const li = lead.lead_linkedin_url ?? ''
    const em = lead.potential_email ?? ''
    if (li && seenLinkedin.has(li)) continue
    if (em && seenEmail.has(em)) continue
    if (li) seenLinkedin.add(li)
    if (em) seenEmail.add(em)
    deduped.push(lead)
    if (deduped.length >= cap) break
  }
  return deduped
}

async function runPerLeadAngles(
  leads: LemlistSearchLead[],
  foundation: StrategicFoundation,
  llm: LlmClient,
): Promise<Map<string, string>> {
  const byKey = new Map<string, string>()
  for (const lead of leads) {
    const key = lead.lead_linkedin_url ?? lead.potential_email ?? lead.full_name
    if (!key) continue
    const out = await callAtom<AngleOut>(llm, 'linkedin-outbound-angle', {
      lead,
      offer: foundation.offer,
      triggers: foundation.triggers,
    })
    byKey.set(key, out.angle ?? foundation.offer)
  }
  return byKey
}

interface CampaignDesign {
  chosenAngle: string
  sequenceShape: Array<{ delay_days: number; channel: 'email' | 'linkedin' }>
}

async function runCampaignDesign(
  foundation: StrategicFoundation,
  brief: LemlistCampaignFromIcpBrief,
  llm: LlmClient,
): Promise<CampaignDesign> {
  const angleOut = await callAtom<CampaignAngleOut>(llm, 'campaign-angle-finder', {
    foundation,
  })
  const chosenAngle = angleOut.chosen_angle ?? foundation.offer
  const architect = await callAtom<ArchitectOut>(llm, 'outbound-campaign-architect', {
    foundation,
    steps: brief.steps,
  })
  let shape = architect.sequence_shape?.steps
  if (!shape || shape.length === 0) {
    shape = Array.from({ length: brief.steps }, (_, i) => ({
      delay_days: i === 0 ? 0 : i * 3,
      channel: 'email' as const,
    }))
  }
  return { chosenAngle, sequenceShape: shape }
}

interface CopyDraft {
  steps: DryrunSequenceStep[]
}

async function runCopyForTier(
  tier: 'VP+' | 'Manager' | 'IC',
  foundation: StrategicFoundation,
  design: CampaignDesign,
  llm: LlmClient,
): Promise<CopyDraft> {
  const routedSkill = pickRoutedSkill(tier)
  const routed = await callAtom<CopyOut>(llm, routedSkill, {
    foundation,
    angle: design.chosenAngle,
    seniority: tier,
    steps: design.sequenceShape.length,
  })
  if (!routed.emails || routed.emails.length === 0) {
    throw new Error(`[lemlist-facade] ${routedSkill} returned zero emails`)
  }
  const firstTouch = await callAtom<CopyOut>(llm, 'copywriting-first-touch', {
    emails: routed.emails,
    angle: design.chosenAngle,
  })
  const followUps = await callAtom<CopyOut>(llm, 'copywriting-follow-up', {
    emails: firstTouch.emails,
    pains: foundation.pains,
    triggers: foundation.triggers,
  })
  const withCta = await callAtom<CopyOut>(llm, 'cta-designer', {
    emails: followUps.emails,
    offer: foundation.offer,
  })
  const refined = await callAtom<CopyOut>(llm, 'copywriting-refiner', {
    emails: withCta.emails,
  })
  const steps: DryrunSequenceStep[] = refined.emails.map((e, i) => ({
    step: i + 1,
    channel: design.sequenceShape[i]?.channel ?? 'email',
    delayDays: design.sequenceShape[i]?.delay_days ?? (i === 0 ? 0 : i * 3),
    subject: i === 0 ? e.subject : undefined,
    body: e.body,
  }))
  return { steps }
}

async function runQualityGate(
  copy: CopyDraft,
  llm: LlmClient,
): Promise<{ score: number | null; notes: string[]; weakestAssumption: string | null }> {
  const analyzed = await callAtom<AnalyzerOut>(llm, 'copywriting-analyzer', {
    emails: copy.steps.map((s) => ({ subject: s.subject, body: s.body })),
  })
  const thinker = await callAtom<ThinkerOut>(llm, 'gtm-action-thinker', {
    emails: copy.steps.map((s) => ({ subject: s.subject, body: s.body })),
  })
  return {
    score: typeof analyzed.score === 'number' ? analyzed.score : null,
    notes: analyzed.improvement_notes ?? [],
    weakestAssumption: thinker.weakest_assumption ?? null,
  }
}

interface VoiceRail {
  /** Stable name for the failure reason. */
  name: 'dash_scan' | 'concrete_number' | 'forward_looking_question'
  /** Inspects a sequence, returns true when the rail fails. */
  failed: (steps: DryrunSequenceStep[]) => boolean
  /** Stricter prompt constraint shipped to the refiner on retry. */
  constraint: string
  /** Failure reason emitted when the retry still fails. */
  errorReason: string
}

const DASH_RAIL: VoiceRail = {
  name: 'dash_scan',
  failed: sequenceHasDash,
  constraint:
    'NO em-dashes (U+2014) and NO en-dashes (U+2013). Use commas, colons, or new sentences instead.',
  errorReason: 'Dash scan failed twice; refiner could not produce dash-free copy.',
}

const NUMBER_RAIL: VoiceRail = {
  name: 'concrete_number',
  failed: sequenceMissingNumber,
  constraint:
    'your last draft had no concrete number; this draft MUST include at least one specific number or quantity.',
  errorReason: 'no_concrete_number_in_message',
}

const QUESTION_RAIL: VoiceRail = {
  name: 'forward_looking_question',
  failed: sequenceMissingQuestion,
  constraint:
    'your last draft did not end with a question; every body in this draft MUST end with a forward-looking question mark.',
  errorReason: 'no_forward_looking_question_in_message',
}

/**
 * Generic voice rail: a single retry through `copywriting-refiner` with a
 * stricter constraint. A second failure returns null and the caller halts
 * the push with `state: 'failed'`.
 */
async function runVoiceRail(
  rail: VoiceRail,
  copy: CopyDraft,
  llm: LlmClient,
): Promise<CopyDraft | null> {
  if (!rail.failed(copy.steps)) return copy
  const retry = await callAtom<CopyOut>(llm, 'copywriting-refiner', {
    emails: copy.steps.map((s) => ({ subject: s.subject, body: s.body })),
    constraint: rail.constraint,
  })
  const rebuilt: DryrunSequenceStep[] = retry.emails.map((e, i) => ({
    step: i + 1,
    channel: copy.steps[i]?.channel ?? 'email',
    delayDays: copy.steps[i]?.delayDays ?? (i === 0 ? 0 : i * 3),
    subject: i === 0 ? e.subject : undefined,
    body: e.body,
  }))
  if (rail.failed(rebuilt)) return null
  return { steps: rebuilt }
}

/**
 * Runs dash-scan, concrete-number, then forward-looking-question rails in
 * that order. Returns either the rail-cleaned copy or the rail name that
 * halted the chain (so the caller can surface the matching errorReason).
 */
async function runAllVoiceRails(
  copy: CopyDraft,
  llm: LlmClient,
): Promise<{ ok: true; copy: CopyDraft } | { ok: false; rail: VoiceRail }> {
  let cur = copy
  for (const rail of [DASH_RAIL, NUMBER_RAIL, QUESTION_RAIL]) {
    const out = await runVoiceRail(rail, cur, llm)
    if (out === null) return { ok: false, rail }
    cur = out
  }
  return { ok: true, copy: cur }
}

// ── Facade entry point ──────────────────────────────────────────────────────

export async function runLemlistCampaignFromIcp(
  input: LemlistCampaignFromIcpInput,
): Promise<LemlistCampaignResult> {
  const log = input.log ?? (() => {})
  const now = input.now ?? (() => new Date())
  const write = input.writeDryrunJson ?? defaultWriteDryrun
  const writtenAt = now()
  const runId = `run_${writtenAt.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

  const brief: LemlistCampaignFromIcpBrief = { ...input.brief }
  const requestedCap = brief.leadCap ?? DEFAULT_LEAD_CAP
  const cap = Math.min(Math.max(1, requestedCap), MAX_LEAD_CAP)
  brief.leadCap = cap

  try {
    log(`[lemlist-facade] ${runId}: phase 1 strategic foundation`)
    const foundation = await runStrategicFoundation(brief, input.llm)

    // Lead-injection seam: when the caller supplies pre-sourced leads (e.g.
    // closed-won lookalikes already enriched via FullEnrich), use them and skip
    // the internal Lemlist people-database sourcing entirely.
    let sourcedLeads: LemlistSearchLead[]
    if (input.leads && input.leads.length > 0) {
      log(`[lemlist-facade] ${runId}: phase 2-3 SKIPPED — using ${input.leads.length} injected leads (cap=${cap})`)
      sourcedLeads = input.leads.slice(0, cap)
    } else {
      log(`[lemlist-facade] ${runId}: phase 2 sourcing shape`)
      const sourcing = await runSourcingShape(foundation, input.llm)
      log(`[lemlist-facade] ${runId}: phase 3 lemleads search (cap=${cap})`)
      sourcedLeads = await runSearch(input.lemlistClient, sourcing, cap)
    }

    log(`[lemlist-facade] ${runId}: phase 4 enrichment posture`)
    const withEmail = sourcedLeads.filter((l) => !!l.potential_email).length
    const emailCoveragePercent =
      sourcedLeads.length === 0 ? 0 : Math.round((withEmail / sourcedLeads.length) * 100)

    log(`[lemlist-facade] ${runId}: phase 5 per-lead angles`)
    const angles = await runPerLeadAngles(sourcedLeads, foundation, input.llm)

    log(`[lemlist-facade] ${runId}: phase 6 campaign design`)
    const design = await runCampaignDesign(foundation, brief, input.llm)

    log(`[lemlist-facade] ${runId}: phase 7 routed copy per persona`)
    // Bucket leads by tier. Each non-empty bucket gets its own routed copy run.
    // The Lemlist sequence ships ONE Liquid-templated body shape and the
    // per-lead `customVariables.persona_body_stepN` carries the tier-specific
    // body. The dryrun preview keeps showing the dominant tier so the Block
    // Kit limit holds; per_persona_bodies captures every bucket for audit.
    const tierCounts = new Map<Tier, number>()
    for (const l of sourcedLeads) {
      const t = mapSeniority(l.seniority)
      tierCounts.set(t, (tierCounts.get(t) ?? 0) + 1)
    }
    let dominantTier: Tier = 'IC'
    let dominantCount = -1
    for (const [t, c] of tierCounts.entries()) {
      if (c > dominantCount) {
        dominantTier = t
        dominantCount = c
      }
    }
    if (dominantCount === -1) {
      // No leads scored a seniority; fall back to the first persona's tier.
      dominantTier = (foundation.personas[0]?.seniority_tier as Tier) ?? 'IC'
    }

    const nonEmptyTiers: Tier[] = TIERS.filter((t) => (tierCounts.get(t) ?? 0) > 0)
    const generationTiers: Tier[] = nonEmptyTiers.length > 0 ? nonEmptyTiers : [dominantTier]
    const singlePersonaFallback = generationTiers.length <= 1

    const perTierCopy = new Map<Tier, CopyDraft>()
    for (const tier of generationTiers) {
      log(`[lemlist-facade] ${runId}: phase 7 generating copy for ${tier}`)
      const drafted = await runCopyForTier(tier, foundation, design, input.llm)
      log(`[lemlist-facade] ${runId}: phase 8 voice rails for ${tier}`)
      const railed = await runAllVoiceRails(drafted, input.llm)
      if (!railed.ok) {
        return {
          ok: false,
          state: 'failed',
          errorReason: railed.rail.errorReason,
        }
      }
      perTierCopy.set(tier, railed.copy)
    }

    const dominantCopy = perTierCopy.get(dominantTier) ?? perTierCopy.values().next().value
    if (!dominantCopy) {
      return { ok: false, state: 'failed', errorReason: 'no_copy_drafted' }
    }

    log(`[lemlist-facade] ${runId}: phase 8 quality gate (dominant tier)`)
    const quality = await runQualityGate(dominantCopy, input.llm)

    log(`[lemlist-facade] ${runId}: phase 9 dryrun + approval gate`)
    const personas: DryrunPersona[] = foundation.personas.map((p) => ({
      titlePattern: p.title_patterns?.[0] ?? 'unknown',
      seniorityTier: p.seniority_tier as Tier,
      routedSequenceSkill: pickRoutedSkill(p.seniority_tier as Tier),
    }))

    const leads: DryrunLead[] = sourcedLeads.map((l) => {
      const { firstName, lastName } = splitName(l.full_name)
      const personaTier = mapSeniority(l.seniority)
      const angleKey = l.lead_linkedin_url ?? l.potential_email ?? l.full_name
      return {
        email: l.potential_email ?? null,
        firstName,
        lastName,
        linkedinUrl: l.lead_linkedin_url,
        companyName: l.current_exp_company_name,
        headline: l.headline,
        country: l.country,
        angle: angles.get(angleKey) ?? foundation.offer,
        personaTier,
      }
    })

    const dryrunFileName = `dryrun-${tsForFile(writtenAt)}.json`
    const dryrunFilePath = path.join(getDryrunDir(), dryrunFileName)

    const perPersonaBodies: Partial<Record<Tier, DryrunSequenceStep[]>> = {}
    for (const [tier, c] of perTierCopy.entries()) {
      perPersonaBodies[tier] = c.steps
    }
    const personaBucketCounts: Partial<Record<Tier, number>> = {}
    for (const [tier, c] of tierCounts.entries()) {
      if (c > 0) personaBucketCounts[tier] = c
    }

    const payload: DryrunPayload = {
      runId,
      campaignTitle: brief.campaignTitle ?? defaultTitleFromBrief(brief),
      senderEmail: brief.senderEmail ?? DEFAULT_SENDER,
      audienceCount: leads.length,
      emailCoveragePercent,
      personas,
      leads,
      sequence: dominantCopy.steps,
      copyScore: quality.score,
      leadCap: cap,
      estimatedLemlistCredits: { sourcing: leads.length, enrichment: 0 },
      dryrunFilePath,
      per_persona_bodies: perPersonaBodies,
      single_persona_fallback: singlePersonaFallback,
      personaBucketCounts,
    }

    await write(dryrunFilePath, payload)

    const approved = await input.approveCallback(payload)
    if (!approved) {
      log(`[lemlist-facade] ${runId}: approval rejected`)
      return { ok: false, state: 'rejected', dryrunFilePath }
    }

    log(`[lemlist-facade] ${runId}: pushing DRAFT campaign to Lemlist`)
    // 25a :  create_campaign_with_sequence with Liquid placeholders. The
    // actual tier-specific body lives in customVariables per lead.
    const firstStep = dominantCopy.steps[0]
    if (!firstStep) {
      return { ok: false, state: 'failed', errorReason: 'Empty sequence; nothing to push.' }
    }
    const liquidBody = (stepIndex: number) => `{{custom.persona_body_step${stepIndex + 1}}}`
    const created = await input.lemlistClient.createCampaignWithSequence({
      name: payload.campaignTitle,
      subject: firstStep.subject ?? payload.campaignTitle,
      body: liquidBody(0),
      timezone: brief.timezone ?? DEFAULT_TIMEZONE,
    })

    // 25b/25c :  add_sequence_step for each remaining step (same placeholder).
    for (let i = 1; i < dominantCopy.steps.length; i++) {
      const s = dominantCopy.steps[i]
      await input.lemlistClient.addSequenceStep({
        campaignId: created.campaignId,
        sequenceId: created.sequenceId,
        type: 'email',
        delay: s.delayDays,
        delayType: 'within',
        message: liquidBody(i),
        subject: s.subject,
        userConfirmed: true,
      })
    }

    // 25d :  add_lead_to_campaign per lead, injecting the tier-specific body
    // for each step into customVariables. Buckets with zero leads were never
    // generated, so we never ship empty placeholders.
    for (const lead of leads) {
      const tierCopy = perTierCopy.get(lead.personaTier) ?? dominantCopy
      const customVariables: Record<string, string | undefined> = {
        angle: lead.angle,
        persona_tier: lead.personaTier,
        headline: lead.headline,
        country: lead.country,
      }
      tierCopy.steps.forEach((s, i) => {
        customVariables[`persona_body_step${i + 1}`] = s.body
      })
      await input.lemlistClient.addLeadToCampaign({
        campaignId: created.campaignId,
        email: lead.email,
        firstName: lead.firstName,
        lastName: lead.lastName,
        linkedinUrl: lead.linkedinUrl,
        companyName: lead.companyName,
        customVariables,
        deduplicate: true,
      })
    }

    // 25e :  validate readiness (advisory; not a fail gate from the facade's view).
    await input.lemlistClient.validateCampaignReadiness({ campaignId: created.campaignId })

    // 25f :  return the campaign URL. Facade NEVER calls set_campaign_state.
    return {
      ok: true,
      state: 'shipped',
      campaignId: created.campaignId,
      campaignUrl: `https://app.lemlist.com/campaigns/${created.campaignId}`,
      dryrunFilePath,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`[lemlist-facade] ${runId}: failed: ${msg}`)
    return { ok: false, state: 'failed', errorReason: msg }
  }
}

// Re-exports so consumers can pull the types from a single entry point.
export type {
  DryrunPayload,
  DryrunLead,
  DryrunPersona,
  DryrunSequenceStep,
  LemlistCampaignFromIcpBrief,
  LemlistCampaignFromIcpInput,
  LemlistCampaignResult,
  LemlistMcpClient,
  LemlistSearchLead,
  LlmAtomName,
  LlmClient,
} from './types.js'
