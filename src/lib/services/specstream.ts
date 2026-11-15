// Singleton service wrapping the SpecStream REST API (api.specstream.ai)
// Web search (GET /v1/web-search) and page reading (POST /v1/extract).
// Auth: Authorization: Bearer ${SPECSTREAM_API_KEY}

const BASE_URL = 'https://api.specstream.ai'
const MAX_EXTRACT_URLS = 20

/** Required env vars for the SpecStream provider. */
export const envVarSchema = {
  SPECSTREAM_API_KEY: { minLength: 20 },
} as const

export interface SpecStreamSearchResult {
  url: string
  title: string
  content: string
  published?: string
}

export interface SpecStreamPage {
  url: string
  status: string
  title?: string
  text?: string
  published?: string
}

interface SpecStreamSource {
  url?: string
  title?: string
  snippet?: string
  published?: string
}

class SpecStreamService {
  private get apiKey(): string | undefined {
    return process.env.SPECSTREAM_API_KEY
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const apiKey = this.apiKey
    if (!apiKey) {
      throw new Error('SPECSTREAM_API_KEY must be set')
    }
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    let json: { data?: T; error?: { message?: string } } = {}
    try {
      json = (await res.json()) as typeof json
    } catch {
      // Non-JSON reply — reported by status below.
    }
    if (!res.ok || !json.data) {
      throw new Error(`SpecStream API error (${res.status}): ${json.error?.message ?? 'Unknown error'}`)
    }
    return json.data
  }

  async search(query: string, limit = 10): Promise<SpecStreamSearchResult[]> {
    const q = query.trim()
    if (!q) return []
    const params = new URLSearchParams({ q })
    const data = await this.request<{ sources?: SpecStreamSource[] }>('GET', `/v1/web-search?${params.toString()}`)
    return (data.sources ?? [])
      .filter((s) => s.url)
      .slice(0, limit)
      .map((s) => ({
        url: String(s.url),
        title: String(s.title ?? ''),
        content: String(s.snippet ?? ''),
        ...(s.published ? { published: s.published } : {}),
      }))
  }

  async extract(urls: string[]): Promise<SpecStreamPage[]> {
    const list = urls.map((u) => u.trim()).filter(Boolean).slice(0, MAX_EXTRACT_URLS)
    if (list.length === 0) return []
    const data = await this.request<{ results?: SpecStreamPage[] }>('POST', '/v1/extract', {
      urls: list,
      format: 'markdown',
    })
    return data.results ?? []
  }

  async scrape(url: string): Promise<string> {
    const [page] = await this.extract([url])
    if (!page || page.status !== 'ok') return ''
    return page.text ?? ''
  }
}

export const specstreamService = new SpecStreamService()
