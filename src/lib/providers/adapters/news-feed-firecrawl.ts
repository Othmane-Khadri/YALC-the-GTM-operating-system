import type { CapabilityAdapter } from '../capabilities.js'
import { firecrawlService } from '../../services/firecrawl.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface NewsFeedInput {
  companyDomain?: string
  lastCheckDate?: string
  query?: string
  limit?: number
  /** Snake-case aliases. */
  company_domain?: string
  last_check_date?: string
}

interface NewsItem {
  url: string
  title: string
  snippet: string
}

/**
 * Firecrawl news-feed adapter.
 *
 * Runs a Firecrawl web search scoped to a company domain (or free-form
 * query) and returns the top N results. Date filtering happens client-side
 * — Firecrawl doesn't expose a `since` parameter, so consumers should
 * post-filter against `last_check_date` if needed.
 */
export const newsFeedFirecrawlAdapter: CapabilityAdapter = {
  capabilityId: 'news-feed',
  providerId: 'firecrawl',
  isAvailable: () => !!process.env.FIRECRAWL_API_KEY,
  async execute(input) {
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new MissingApiKeyError('firecrawl', 'FIRECRAWL_API_KEY')
    }
    const raw = (input ?? {}) as NewsFeedInput
    const companyDomain = raw.companyDomain ?? raw.company_domain ?? ''
    const explicitQuery = raw.query
    const query = explicitQuery && explicitQuery.length > 0
      ? explicitQuery
      : companyDomain
        ? `news ${companyDomain}`
        : ''
    if (query === '') {
      throw new ProviderApiError(
        'firecrawl',
        'query or companyDomain (company_domain) is required',
      )
    }
    try {
      const results = await firecrawlService.search(query, raw.limit ?? 10)
      const items: NewsItem[] = results.map((r) => ({
        url: r.url,
        title: r.title,
        snippet: r.content.slice(0, 500),
      }))
      return { items, query, companyDomain, lastCheckDate: raw.lastCheckDate ?? raw.last_check_date }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('firecrawl', message)
    }
  },
}
