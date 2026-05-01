/**
 * Canonical schema for `~/.gtm-os/company_context.yaml` — the captured
 * answers about the user's company, ICP, voice, and the raw sources they
 * came from. Promoted to a first-class file in 0.6.0 so derivation steps
 * read structured input instead of mining a framework preamble.
 */

export interface CompanyContextCompany {
  name: string
  website: string
  description: string
  industry?: string
  stage?: string
  team_size?: string
}

export interface CompanyContextFounder {
  name: string
  linkedin: string
}

/**
 * Rich competitor record produced by `buildRichCompanyProfile()` during the
 * flag-capture step. Mirrors `profile-builder.ts`'s `build_framework`
 * tool-use schema so the SPA review surface gets weaknesses + battlecard
 * notes on the first pass — without waiting for `framework:derive`.
 */
export interface CompanyContextCompetitorDetail {
  name: string
  website: string
  positioning: string
  weaknesses: string[]
  battlecardNotes: string
}

/**
 * Rich segment record produced by `buildRichCompanyProfile()`. Same intent
 * as `CompanyContextCompetitorDetail` — get the LLM's structured segment
 * understanding (decision makers, buying triggers, disqualifiers, target
 * roles) into `company_context.yaml` immediately so review never starts
 * from a thin shell.
 */
export interface CompanyContextSegmentDetail {
  id: string
  name: string
  description: string
  priority: 'primary' | 'secondary' | 'exploratory'
  targetRoles: string[]
  targetCompanySizes: string[]
  targetIndustries: string[]
  keyDecisionMakers: string[]
  painPoints: string[]
  buyingTriggers: string[]
  disqualifiers: string[]
}

export interface CompanyContextIcp {
  /** Free-form ICP description as given by the user (pre-synthesis). */
  segments_freeform: string
  pain_points: string[]
  competitors: string[]
  /**
   * Subreddits where this audience hangs out (lowercase, no `r/` prefix).
   * Synthesized at onboarding from the ICP prompt; defaults to [] until
   * captured. Resolved via `$context.icp.subreddits`.
   */
  subreddits: string[]
  /**
   * Slack / LinkedIn / community names where this audience hangs out.
   * Synthesized at onboarding alongside `subreddits`. Resolved via
   * `$context.icp.target_communities`.
   */
  target_communities: string[]
  /**
   * Rich competitor records (mirrors profile-builder tool-use schema).
   * Populated when an Anthropic key was available at capture time; absent
   * otherwise. The thin `competitors` string array stays as the
   * back-compatible fallback for older consumers.
   */
  competitors_detail?: CompanyContextCompetitorDetail[]
  /**
   * Rich ICP segment records (mirrors profile-builder tool-use schema).
   * Populated alongside `competitors_detail`.
   */
  segments_detail?: CompanyContextSegmentDetail[]
}

/** Buying-intent + monitoring keyword catalog produced by rich synthesis. */
export interface CompanyContextSignals {
  buyingIntentSignals: string[]
  monitoringKeywords: string[]
  triggerEvents: string[]
}

export interface CompanyContextVoice {
  description: string
  /** Path the user pointed to (or the synthesized excerpt path). */
  examples_path: string
}

export interface CompanyContextSources {
  /** URL scraped (if any) and ISO timestamp on which it was fetched. */
  website?: string
  website_fetched_at?: string
  linkedin?: string
  linkedin_fetched_at?: string
  /**
   * Unipile account id whose LinkedIn engagement is harvested. Populated
   * when the user runs `yalc-gtm provider:add unipile` or sets
   * UNIPILE_DEFAULT_ACCOUNT_ID. Resolved via
   * `$context.sources.linkedin_account_id` from framework yamls. The
   * doctor command emits a WARN when it's missing on a tenant that has
   * an installed framework which requires a LinkedIn account.
   */
  linkedin_account_id?: string
  /** Local doc folder roots / file paths read at capture. */
  docs?: string[]
  /** Voice samples file path used for tone extraction. */
  voice?: string
}

export interface CompanyContextMeta {
  captured_at: string
  last_updated_at: string
  /** Set when the file was produced by `yalc-gtm migrate`. */
  migrated_from?: string
  /** YALC version that authored the file. */
  version?: string
}

export interface CompanyContext {
  company: CompanyContextCompany
  founder: CompanyContextFounder
  icp: CompanyContextIcp
  voice: CompanyContextVoice
  sources: CompanyContextSources
  meta: CompanyContextMeta
  /**
   * Buying-intent / monitoring catalog. Populated by
   * `buildRichCompanyProfile()` during flag-capture when an Anthropic key
   * is set. Optional so older yamls (and stub captures without an LLM)
   * stay valid — readers should treat `undefined` as "no signal data yet".
   */
  signals?: CompanyContextSignals
}

/** Build an empty `CompanyContext` skeleton. */
export function emptyCompanyContext(): CompanyContext {
  const now = new Date().toISOString()
  return {
    company: { name: '', website: '', description: '' },
    founder: { name: '', linkedin: '' },
    icp: { segments_freeform: '', pain_points: [], competitors: [], subreddits: [], target_communities: [] },
    voice: { description: '', examples_path: '' },
    sources: {},
    meta: { captured_at: now, last_updated_at: now, version: '0.6.0' },
  }
}
