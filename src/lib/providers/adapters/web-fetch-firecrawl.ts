import type { CapabilityAdapter } from '../capabilities.js'
import { firecrawlService } from '../../services/firecrawl.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface WebFetchInput {
  /** Single URL to scrape (the common case). */
  url?: string
  /** Free-text search query — when set, runs a search instead of a fetch. */
  query?: string
  /** Result cap when running in search mode. */
  limit?: number
  /** Snake-case aliases. */
  company_url?: string
}

/**
 * Firecrawl web-fetch adapter.
 *
 * Two operating modes:
 * 1. Single-URL fetch (`url` or `company_url`): scrape one page and return
 *    the readability-extracted markdown.
 * 2. Search mode (`query`): run a Firecrawl search and return ranked URL +
 *    snippet results. Used by `scrape-community-feed` and
 *    `scrape-reddit-keyword`.
 */
export const webFetchFirecrawlAdapter: CapabilityAdapter = {
  capabilityId: 'web-fetch',
  providerId: 'firecrawl',
  isAvailable: () => !!process.env.FIRECRAWL_API_KEY,
  async execute(input) {
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new MissingApiKeyError('firecrawl', 'FIRECRAWL_API_KEY')
    }
    const raw = (input ?? {}) as WebFetchInput
    const url = raw.url ?? raw.company_url
    const query = raw.query

    if (url) {
      try {
        const markdown = await firecrawlService.scrape(url)
        return { url, markdown }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new ProviderApiError('firecrawl', message)
      }
    }

    if (query && query.trim() !== '') {
      try {
        const results = await firecrawlService.search(query, raw.limit ?? 10)
        return {
          query,
          results: results.map((r) => ({
            url: r.url,
            title: r.title,
            snippet: r.content.slice(0, 1000),
          })),
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new ProviderApiError('firecrawl', message)
      }
    }

    throw new ProviderApiError(
      'firecrawl',
      'web-fetch requires either `url` (or `company_url`) for single-page scrape, or `query` for search',
    )
  },
}
