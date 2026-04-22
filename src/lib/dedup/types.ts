/**
 * Dedup Module Types
 */

// ─── Lead Record ────────────────────────────────────────────────────────────

export interface LeadRecord {
  id?: string
  email?: string
  linkedin_url?: string
  linkedinUrl?: string
  first_name?: string
  firstName?: string
  last_name?: string
  lastName?: string
  headline?: string
  title?: string
  company?: string
  company_name?: string
  provider_id?: string
  providerId?: string
  source?: string
  dedup_status?: DedupStatus
  [key: string]: unknown
}

// ─── Suppression Entry ──────────────────────────────────────────────────────

export interface SuppressionEntry {
  id: string
  email?: string
  linkedin_url?: string
  first_name?: string
  last_name?: string
  headline?: string
  company?: string
  source: SuppressionSource
  /** Campaign ID if from an active campaign */
  campaignId?: string
  /** Campaign title for display */
  campaignTitle?: string
  /** Lifecycle status if from campaign leads */
  lifecycleStatus?: string
}

export type SuppressionSource =
  | 'campaign_active'
  | 'campaign_replied'
  | 'crm'
  | 'blocklist'
  | 'notion'
  | 'csv'

// ─── Dedup Match ────────────────────────────────────────────────────────────

export type MatcherType = 'email' | 'linkedin' | 'fuzzy_name_company' | 'domain_title'

export interface DedupMatch {
  matcher: MatcherType
  confidence: number // 0-100
  leadField: string
  matchedField: string
  matchedSource: SuppressionSource
  matchedId: string
}

// ─── Dedup Result ───────────────────────────────────────────────────────────

export interface DedupResult {
  unique: LeadRecord[]
  duplicates: Array<{ lead: LeadRecord; match: DedupMatch }>
  pendingReview: Array<{ lead: LeadRecord; match: DedupMatch }>
}

// ─── Dedup Status ───────────────────────────────────────────────────────────

export type DedupStatus = 'unique' | 'duplicate' | 'pending_review' | 'merged' | 'kept_both'

// ─── Config ─────────────────────────────────────────────────────────────────

export interface DedupConfig {
  fuzzyNameThreshold: number     // Dice coefficient threshold (0-1), default 0.8
  domainTitleThreshold: number   // Domain+title similarity threshold, default 0.7
  slackConfirmRange: [number, number] // [low, high] confidence for Slack confirmation
  slackTimeoutMs: number         // Slack confirmation timeout
  enabledMatchers: MatcherType[]
}

// ─── Slack Confirmation ─────────────────────────────────────────────────────

export type SlackConfirmAction = 'merge' | 'keep_both' | 'skip' | 'timeout'

export interface SlackConfirmResult {
  leadId: string
  action: SlackConfirmAction
  respondedBy?: string
  respondedAt?: string
}
