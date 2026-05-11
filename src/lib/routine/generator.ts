/**
 * Routine Generator — deterministic, rule-based proposal pipeline.
 *
 * Inputs (all already known at the end of `yalc-gtm start`):
 *   - capabilitiesAvailable: provider IDs that are registered + active
 *     (e.g. ['unipile', 'instantly']). The generator never makes network
 *     calls — caller resolves availability up front.
 *   - envHasAnthropic: whether `ANTHROPIC_API_KEY` is set in the live env.
 *     We only ask the boolean (not the key) so the generator stays pure.
 *   - archetype: the user's pinned archetype preference from
 *     `~/.gtm-os/config.yaml.archetype` (a/b/c/d), or null when absent.
 *     Used as a tie-breaker for the default dashboard pick.
 *   - context: parsed `~/.gtm-os/company_context.yaml`, or null.
 *   - hypothesisLocked: true when an outbound hypothesis has been captured
 *     (a sidecar at `~/.gtm-os/frameworks/installed/<name>.hypothesis.json`).
 *
 * Output: a Routine object — frameworks list + default dashboard + notes.
 *
 * Rules (per spec §4):
 *   - Per-framework `canRun*` predicates (predicate true = framework
 *     becomes a Routine entry).
 *   - Schedule defaults from each framework yaml's `schedule.cron`. Empty
 *     for `mode: on-demand` (D, C).
 *   - Default dashboard = primary archetype's framework route, primary
 *     picked A > B > C > D unless the user has pinned an archetype.
 *   - Conflict resolution: C without a hypothesis → entry is `deferred`.
 *
 * The generator never throws, never writes to disk, never reads the
 * network. Same inputs → same routine, every time.
 */

import { findFramework } from '../frameworks/loader.js'
import { ARCHETYPES, type ArchetypeId } from '../frameworks/archetypes.js'
import type { CompanyContext } from '../framework/context-types.js'
import type { Routine, RoutineFrameworkEntry } from './types.js'

/** Inputs each per-framework predicate accepts. */
export interface PredicateInput {
  capabilitiesAvailable: string[]
  envHasAnthropic: boolean
  context: CompanyContext | null
}

/** Top-level generator input. */
export interface RoutineGeneratorInput {
  capabilitiesAvailable: string[]
  envHasAnthropic: boolean
  /** User-pinned archetype preference (read separately from `~/.gtm-os/config.yaml`). */
  archetype: ArchetypeId | null
  context: CompanyContext | null
  /** True when an outbound hypothesis sidecar exists for outreach-campaign-builder. */
  hypothesisLocked?: boolean
}

// ─── Per-framework predicates (spec §4.1) ──────────────────────────────────

/**
 * Archetype A — competitor-audience-mining (LinkedIn engagement-driven).
 * Requires: `unipile`, `ANTHROPIC_API_KEY`, at least one competitor entry,
 * and a captured `linkedin_account_id` (without it the cron job warns and
 * the seed run fails — exclude rather than ship a broken install).
 */
export function canRunCompetitorAudienceMining(input: PredicateInput): boolean {
  if (!input.envHasAnthropic) return false
  if (!input.capabilitiesAvailable.includes('unipile')) return false
  const ctx = input.context
  if (!ctx) return false
  const competitorsCount = ctx.icp?.competitors?.length ?? 0
  const detailCount = ctx.icp?.competitors_detail?.length ?? 0
  if (competitorsCount === 0 && detailCount === 0) return false
  if (!ctx.sources?.linkedin_account_id) return false
  return true
}

/**
 * Archetype B — content-calendar-builder.
 * Requires: `ANTHROPIC_API_KEY` AND at least one of (a) `unipile`
 * (LinkedIn trending search) OR (b) non-empty `signals.monitoringKeywords`
 * (so `detect-news` has something to query). Without either the framework
 * runs but produces empty drafts — exclude.
 */
export function canRunContentCalendarBuilder(input: PredicateInput): boolean {
  if (!input.envHasAnthropic) return false
  const hasUnipile = input.capabilitiesAvailable.includes('unipile')
  const monitoringKw = input.context?.signals?.monitoringKeywords ?? []
  if (!hasUnipile && monitoringKw.length === 0) return false
  return true
}

/**
 * Archetype C — outreach-campaign-builder.
 * Requires: `ANTHROPIC_API_KEY` AND at least one outbound channel
 * (`unipile` for LinkedIn OR `instantly` for email). The hypothesis-lock
 * gate is enforced at the *Routine assembly* level (deferred entry) — not
 * here — so the framework still surfaces in matrix combinations and the
 * SPA can route the user to Step 10's wizard.
 */
export function canRunOutreachCampaignBuilder(input: PredicateInput): boolean {
  if (!input.envHasAnthropic) return false
  const hasOutbound =
    input.capabilitiesAvailable.includes('unipile') ||
    input.capabilitiesAvailable.includes('instantly')
  if (!hasOutbound) return false
  return true
}

/**
 * Archetype D — lead-magnet-builder.
 * Requires: `ANTHROPIC_API_KEY` only. Always eligible when the key is set.
 */
export function canRunLeadMagnetBuilder(input: PredicateInput): boolean {
  return input.envHasAnthropic
}

// ─── Generator ────────────────────────────────────────────────────────────

/** Build a routine entry by merging schedule + rationale onto a framework. */
function buildEntry(
  framework: string,
  rationale: string,
  options: { deferred?: boolean; inputs?: Record<string, unknown> } = {},
): RoutineFrameworkEntry {
  const fw = findFramework(framework)
  const entry: RoutineFrameworkEntry = {
    framework,
    rationale,
  }
  if (fw && fw.mode !== 'on-demand' && fw.schedule?.cron) {
    entry.schedule = {
      cron: fw.schedule.cron,
      ...(fw.schedule.timezone ? { timezone: fw.schedule.timezone } : {}),
    }
  }
  if (options.deferred) entry.deferred = true
  if (options.inputs) entry.inputs = options.inputs
  return entry
}

/**
 * Pick the default dashboard route for a routine. Spec §4.3:
 *   1. If the user pinned an archetype AND that archetype's framework was
 *      installed by this routine, use it.
 *   2. Otherwise primary = A > B > C > D, picking the first eligible one.
 *   3. Empty routine → `/frameworks` (index view) + a note.
 */
function pickDefaultDashboard(
  installedArchetypes: Set<ArchetypeId>,
  pinned: ArchetypeId | null,
): { route: string; primary: ArchetypeId | null } {
  if (pinned && installedArchetypes.has(pinned)) {
    const a = ARCHETYPES.find((x) => x.id === pinned)!
    return { route: `/frameworks/${a.framework}`, primary: pinned }
  }
  for (const id of ['a', 'b', 'c', 'd'] as const) {
    if (installedArchetypes.has(id)) {
      const a = ARCHETYPES.find((x) => x.id === id)!
      return { route: `/frameworks/${a.framework}`, primary: id }
    }
  }
  return { route: '/frameworks', primary: null }
}

/**
 * Detect schedule collisions among entries. Per spec §4.2: when two
 * scheduled frameworks land within ±5 minutes of each other on the
 * cron's HH:MM slot, nudge the second by +15 minutes to spread launchd
 * load. We only inspect "minute hour * * *" patterns — anything more
 * exotic stays untouched (the user pinned a complex schedule on purpose).
 */
function nudgeColliding(entries: RoutineFrameworkEntry[]): string[] {
  const notes: string[] = []
  const seen: Array<{ idx: number; minute: number; hour: number }> = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (!e.schedule?.cron) continue
    const parts = e.schedule.cron.split(/\s+/)
    if (parts.length !== 5) continue
    const minute = Number(parts[0])
    const hour = Number(parts[1])
    if (Number.isNaN(minute) || Number.isNaN(hour)) continue
    const collide = seen.find((s) => s.hour === hour && Math.abs(s.minute - minute) <= 5)
    if (collide) {
      const newMinute = (minute + 15) % 60
      const newHour = (hour + Math.floor((minute + 15) / 60)) % 24
      const nudged = [String(newMinute), String(newHour), parts[2], parts[3], parts[4]].join(' ')
      e.schedule = { ...e.schedule, cron: nudged }
      notes.push(
        `Nudged ${e.framework} from "${parts.join(' ')}" to "${nudged}" to avoid collision with ${entries[collide.idx].framework}.`,
      )
      seen.push({ idx: i, minute: newMinute, hour: newHour })
    } else {
      seen.push({ idx: i, minute, hour })
    }
  }
  return notes
}

/**
 * Run the rule pipeline and return the proposed Routine.
 *
 * Pure function — no I/O, no globals. The caller is responsible for
 * resolving providers, env keys, and reading `company_context.yaml`.
 */
export function generateRoutine(input: RoutineGeneratorInput): Routine {
  const notes: string[] = []
  const frameworks: RoutineFrameworkEntry[] = []
  const installed = new Set<ArchetypeId>()

  const predInput: PredicateInput = {
    capabilitiesAvailable: input.capabilitiesAvailable,
    envHasAnthropic: input.envHasAnthropic,
    context: input.context,
  }

  // Edge case: no Anthropic. Spec §4.5 — empty routine + helpful note.
  if (!input.envHasAnthropic) {
    notes.push(
      'No reasoning provider — set ANTHROPIC_API_KEY (or add an MCP reasoning provider) and re-run routine:propose.',
    )
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      archetypes: [],
      frameworks: [],
      defaultDashboard: '/frameworks',
      notes,
    }
  }

  // A — competitor-audience-mining
  if (canRunCompetitorAudienceMining(predInput)) {
    frameworks.push(
      buildEntry(
        'competitor-audience-mining',
        'Unipile + Anthropic + competitors + linkedin_account_id all set — daily LinkedIn engager mining.',
      ),
    )
    installed.add('a')
  }

  // B — content-calendar-builder
  if (canRunContentCalendarBuilder(predInput)) {
    const reason = input.capabilitiesAvailable.includes('unipile')
      ? 'Unipile + Anthropic available — weekly LinkedIn-trending content drafts.'
      : 'Anthropic + monitoringKeywords captured — weekly news-driven content drafts.'
    frameworks.push(buildEntry('content-calendar-builder', reason))
    installed.add('b')
  }

  // C — outreach-campaign-builder
  if (canRunOutreachCampaignBuilder(predInput)) {
    const channel = input.capabilitiesAvailable.includes('unipile') ? 'LinkedIn' : 'email'
    if (input.hypothesisLocked) {
      frameworks.push(
        buildEntry(
          'outreach-campaign-builder',
          `Outbound hypothesis already locked — ready to draft ${channel} sequence.`,
        ),
      )
    } else {
      frameworks.push(
        buildEntry(
          'outreach-campaign-builder',
          'Awaiting hypothesis — install will pause at Step 10 of setup.',
          { deferred: true, inputs: { hypothesis: '<deferred>' } },
        ),
      )
    }
    installed.add('c')
  }

  // D — lead-magnet-builder
  if (canRunLeadMagnetBuilder(predInput)) {
    frameworks.push(
      buildEntry(
        'lead-magnet-builder',
        'Anthropic available — on-demand lead-magnet wizard ready when you are.',
      ),
    )
    installed.add('d')
  }

  // §4.4 — note when both B and C are eligible (no real schedule conflict;
  // C is on-demand so the Monday LinkedIn slot stays for content drafting).
  if (installed.has('b') && installed.has('c')) {
    notes.push(
      'Monday 09:00 LinkedIn slot is owned by content-calendar-builder; outreach-campaign-builder runs at your pace.',
    )
  }

  // Nudge schedule collisions (none expected with default fixtures, but
  // future framework yaml additions might collide).
  const nudgeNotes = nudgeColliding(frameworks)
  notes.push(...nudgeNotes)

  // Edge case: only D available (no providers). Recommend provider:add.
  if (installed.size === 1 && installed.has('d')) {
    notes.push(
      'Run `yalc-gtm provider:add unipile` (or instantly) to unlock A/B/C archetypes.',
    )
  }

  // Default dashboard
  const { route: defaultDashboard, primary } = pickDefaultDashboard(installed, input.archetype)
  if (frameworks.length === 0) {
    notes.push(
      'No frameworks matched the rule predicates — falling back to /frameworks. Re-run after adding providers or rich context.',
    )
  } else if (primary === null) {
    notes.push('No archetype matched a primary slot — landing on /frameworks index.')
  }

  // Surface ordered, deduplicated archetype list (uppercase letters).
  const orderedArchetypes: Array<'A' | 'B' | 'C' | 'D'> = []
  for (const id of ['a', 'b', 'c', 'd'] as const) {
    if (installed.has(id)) orderedArchetypes.push(id.toUpperCase() as 'A' | 'B' | 'C' | 'D')
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    archetypes: orderedArchetypes,
    frameworks,
    defaultDashboard,
    notes,
  }
}
