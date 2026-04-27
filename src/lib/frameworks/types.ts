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

/** Schedule (mirrors AgentSchedule but allows cron strings too). */
export interface FrameworkSchedule {
  cron?: string
  /** Falls back to UTC when omitted. May reference `$context.company.timezone`. */
  timezone?: string
}

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
  schedule: FrameworkSchedule
  steps: FrameworkStep[]
  output: FrameworkOutput
  seed_run?: FrameworkSeedRun

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
