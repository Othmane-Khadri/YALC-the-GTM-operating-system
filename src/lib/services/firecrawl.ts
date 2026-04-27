import FirecrawlApp from '@mendable/firecrawl-js'

/** Required env vars for the Firecrawl provider. */
export const envVarSchema = {
  FIRECRAWL_API_KEY: { minLength: 20 },
} as const

let app: FirecrawlApp | null = null

function getApp(): FirecrawlApp {
  if (!app) {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      throw new Error('FIRECRAWL_API_KEY must be set')
    }
    app = new FirecrawlApp({ apiKey })
  }
  return app
}

export class FirecrawlService {
  isAvailable(): boolean {
    return !!process.env.FIRECRAWL_API_KEY
  }

  async scrape(url: string): Promise<string> {
    const fc = getApp()
    const result = await fc.scrapeUrl(url, { formats: ['markdown'] })
    if ('error' in result && result.error) {
      throw new Error(`Firecrawl scrape failed: ${result.error}`)
    }
    if ('markdown' in result && result.markdown) {
      return result.markdown
    }
    return ''
  }

  async search(query: string, limit = 10): Promise<{ url: string; title: string; content: string }[]> {
    const fc = getApp()
    const result = await fc.search(query, { limit })
    if ('error' in result && result.error) {
      throw new Error(`Firecrawl search failed: ${result.error}`)
    }
    if ('data' in result && Array.isArray(result.data)) {
      return result.data.map((item) => ({
        url: String(item.url ?? ''),
        title: String(item.title ?? ''),
        content: String(item.markdown ?? item.description ?? ''),
      }))
    }
    return []
  }

  async extract(urls: string[], schema?: Record<string, unknown>): Promise<unknown> {
    const fc = getApp()
    const params: Record<string, unknown> = {}
    if (schema) {
      params.schema = schema
    }
    const result = await fc.extract(urls, params)
    if ('error' in result && result.error) {
      throw new Error(`Firecrawl extract failed: ${result.error}`)
    }
    if ('data' in result) {
      return result.data
    }
    return null
  }

  async map(url: string, limit = 100): Promise<string[]> {
    const fc = getApp()
    const result = await fc.mapUrl(url, { limit })
    if ('error' in result && result.error) {
      throw new Error(`Firecrawl map failed: ${result.error}`)
    }
    if ('links' in result && Array.isArray(result.links)) {
      return result.links as string[]
    }
    return []
  }
}

export const firecrawlService = new FirecrawlService()
