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

export interface CompanyContextIcp {
  /** Free-form ICP description as given by the user (pre-synthesis). */
  segments_freeform: string
  pain_points: string[]
  competitors: string[]
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
}

/** Build an empty `CompanyContext` skeleton. */
export function emptyCompanyContext(): CompanyContext {
  const now = new Date().toISOString()
  return {
    company: { name: '', website: '', description: '' },
    founder: { name: '', linkedin: '' },
    icp: { segments_freeform: '', pain_points: [], competitors: [] },
    voice: { description: '', examples_path: '' },
    sources: {},
    meta: { captured_at: now, last_updated_at: now, version: '0.6.0' },
  }
}
