export type WebResearchType = 'company' | 'person' | 'competitor' | 'trigger_event'

export type CacheContentType =
  | 'company_page'
  | 'blog_post'
  | 'job_posting'
  | 'press_release'
  | 'social_profile'
  | 'search_result'

export interface WebInsight {
  source: string
  content: string
  relevance: 'high' | 'medium' | 'low'
  extractedAt: string
}

export interface WebResearchRequest {
  targetType: WebResearchType
  targetIdentifier: string
  questions: string[]
  maxAge?: number
}

export interface WebResearchResult {
  insights: WebInsight[]
  sources: { url: string; fetchedAt: string }[]
  fromCache: boolean
}

export interface CachedPage {
  id: string
  url: string
  content: string
  contentType: CacheContentType
  extractedInsights: WebInsight[] | null
  fetchedAt: string
  expiresAt: string
}
