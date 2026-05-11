/**
 * Framework proposition system — type definitions.
 *
 * A "framework" is a pre-built playbook the user can install. It runs on
 * a schedule (via launchd / agent runner) and writes its output either
 * to Notion (when the user has NOTION_API_KEY) or to the local dashboard
 * (always available).
 *
 * The `requires` block decides whether the framework is *eligible* for a
 * given user (does the user have the providers + keys + context fields
 * the framework needs). The `recommended_when` block decides whether to
 * *recommend* it after eligibility passes (e.g. don't recommend a
 * competitor monitor if the user has no competitors set).
 */

/** Output destination supported by a framework. */
export type FrameworkOutputDestination = 'notion' | 'dashboard'

/** A `recommended_when` clause is one of a small fixed set of named checks. */
export interface RecommendedWhenClauses {
  has_competitors_in_context?: boolean
  has_provider?: string
  not_has_active_framework?: string
  has_icp_segments?: boolean
  has_target_communities?: boolean
  has_recent_linkedin_posts?: boolean
}

/** A single input slot the framework asks the user about during install. */
export interface FrameworkInput {
  name: string
  description: string
  /** Default value. May be a literal or a `$context.<path>` reference. */
  default?: string | number | string[] | null
}

/** Eligibility predicates: ALL must pass for the framework to be usable. */
export interface FrameworkRequires {
  /** Provider IDs that must be registered (e.g. ['firecrawl']). */
  providers?: string[]
  /** At least one of the listed env vars must be set. */
  any_of_keys?: string[]
  /** Dotted paths into company_context.yaml that must be non-empty. */
  context_fields?: string[]
}

/** A single step in the framework's execution pipeline. */
export interface FrameworkStep {
  skill: string
  input?: Record<string, unknown>
}

/** Surface used to render a human-gate prompt. */
export type GateSurface = 'ui-today' | 'ui-modal'

/**
 * A human-gate step: pauses the framework run and waits for a human to
 * approve, edit, or reject the previous step's output before continuing.
 *
 * The runner persists an `awaiting-gate.json` sentinel on disk and exits
 * with a special status code so the CLI / API can surface the pause.
 */
export interface FrameworkGateStep {
  gate: {
    id: string
    prompt: string
    surface: GateSurface
    /** Index of the step whose output becomes the gate's editable payload. */
    payload_from_step?: number
  }
}

/** Either a normal skill step or a human-gate step. */
export type FrameworkStepEntry = FrameworkStep | FrameworkGateStep

/** Type-guard: distinguish gate steps from skill steps. */
export function isGateStep(step: FrameworkStepEntry): step is FrameworkGateStep {
  return (
    typeof step === 'object' &&
    step !== null &&
    'gate' in step &&
    typeof (step as FrameworkGateStep).gate === 'object'
  )
}

/** Schedule (mirrors AgentSchedule but allows cron strings too). */
export interface FrameworkSchedule {
  cron?: string
  /** Falls back to UTC when omitted. May reference `$context.company.timezone`. */
  timezone?: string
}

/**
 * Execution mode:
 *   - `scheduled` — framework MUST have a `schedule.cron`; install creates
 *     the launchd job (current 0.7.0 / 0.8.0 behaviour, also the default).
 *   - `on-demand` — framework MUST NOT have a `schedule.cron`; install
 *     skips launchd, only `framework:run <name>` triggers execution.
 */
export type FrameworkMode = 'scheduled' | 'on-demand'

/** One destination option in the framework's output choice list. */
export interface FrameworkOutputOption {
  notion?: {
    /** Predicate that, when true, makes this option active. */
    when?: string
    page_template?: string
    target_db?: string
  }
  dashboard?: {
    when?: string
    route?: string
    view_template?: string
  }
}

/** Framework's output config — one of these options is picked at install. */
export interface FrameworkOutput {
  destination_choice: FrameworkOutputOption[]
}

/** Optional one-time backfill to populate initial state at install time. */
export interface FrameworkSeedRun {
  description?: string
  override_inputs?: Record<string, unknown>
}

/**
 * Optional starting visualization. After the install seed run completes,
 * the install hook generates this view via the `visualize` skill against
 * the framework's seed run JSON. The `/today` SPA links to it through the
 * per-framework "Visualize" link.
 */
export interface FrameworkDefaultVisualization {
  view_id: string
  intent: string
}

/**
 * The fully-parsed framework definition. Mirrors the YAML schema in
 * `configs/frameworks/<name>.yaml`. Required fields are validated at load
 * time — missing or malformed fields throw with file:line context.
 */
export interface FrameworkDefinition {
  name: string
  display_name: string
  description: string

  requires: FrameworkRequires
  recommended_when?: RecommendedWhenClauses

  inputs: FrameworkInput[]
  /**
   * Schedule. Required when `mode === 'scheduled'` (the default), forbidden
   * to contain a `cron:` when `mode === 'on-demand'`. Kept as the same shape
   * as before so 0.7.0/0.8.0 frameworks (no `mode:` key) install unchanged.
   */
  schedule: FrameworkSchedule
  /**
   * Execution mode. Optional in YAML; defaults to `scheduled` for
   * backward-compat with 0.7.0 / 0.8.0 frameworks that omit it entirely.
   */
  mode?: FrameworkMode
  /** Skill steps and (optional) human-gate pauses, in execution order. */
  steps: FrameworkStepEntry[]
  /**
   * Optional per-framework awaiting-gate timeout (hours). When a gate's
   * `created_at` exceeds this many hours and the gate is still awaiting
   * action, the runner auto-rejects it with reason
   * `"timeout: <N>h elapsed without action"`.
   *
   * Precedence: this field > `YALC_DEFAULT_GATE_TIMEOUT_HOURS` env > 72h default.
   */
  gate_timeout_hours?: number
  output: FrameworkOutput
  seed_run?: FrameworkSeedRun
  /**
   * Optional starting visualization. The install hook generates this view
   * after the seed run finishes; the SPA links to it from `/today`.
   */
  default_visualization?: FrameworkDefaultVisualization

  /** Path the definition was loaded from — useful for error messages. */
  _sourcePath?: string
}

/** Per-user runtime state for an installed framework. Stored on disk. */
export interface InstalledFrameworkConfig {
  name: string
  display_name: string
  description: string
  installed_at: string
  schedule: FrameworkSchedule
  output: {
    destination: FrameworkOutputDestination
    notion_parent_page?: string
    dashboard_route?: string
  }
  inputs: Record<string, unknown>
  /** Disabled means scheduled run is paused but config is preserved. */
  disabled?: boolean
}
