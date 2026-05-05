// Stable enum string for machine-readable analytics. DO NOT add new values without coordination.
export type DisqualifyReason =
  | 'industry_in_disqualifiers'
  | 'industry_not_in_target'
  | 'company_in_disqualifiers'

export interface VerifiedFields {
  headline: string | null
  primary_company: string | null
  primary_position: string | null
  primary_company_industry: string | null
  prior_companies: string[]
  current_role_start_date: string | null  // ISO date string
  all_active_roles: Array<{ position: string | null; company: string | null }>
  /** True when sections=experience was requested but Unipile returned empty work_experience (rate limit / scrape block). */
  throttled: boolean
}

export interface DriftFlags {
  title_mismatch: boolean
  ex_employer_in_headline: boolean
  recent_role_change: boolean
}

export interface DisqualifiedRecord {
  reason: DisqualifyReason
  detail: string
}

/**
 * The structured ICP for a client/tenant, as resolved at qualification plan time.
 * Source-agnostic: may come from `loadFramework(tenantId)` or from a `clients/<slug>.yml` fallback.
 */
export interface ClientICP {
  client_slug: string
  source: 'tenant_framework' | 'repo_yaml'
  primary_segment: {
    name: string
    target_roles: string[]
    target_industries: string[]
    target_company_sizes: string[]   // optional in source files but always present in normalized form (default [])
    target_geographies: string[]     // defined for v1, NOT enforced until later PR
    disqualifiers: string[]          // industries / company patterns to hard-reject
    pain_points: string[]
    voice?: string
    messaging?: string
  }
}
