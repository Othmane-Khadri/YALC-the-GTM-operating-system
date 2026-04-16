// Singleton service wrapping Orthogonal REST API (api.orth.sh)
// Universal API gateway — discover and call 100+ APIs via a single key.
// Auth: Authorization: Bearer ${ORTHOGONAL_API_KEY}

const BASE_URL = 'https://api.orth.sh'

export interface OrthSearchEndpoint {
  path: string
  description: string
  price: string
  verified: boolean
  score: number
}

export interface OrthSearchResult {
  slug: string
  name: string
  baseUrl?: string
  description?: string
  endpoints: OrthSearchEndpoint[]
}

export interface OrthSearchResponse {
  results: OrthSearchResult[]
  count: number
  apisCount: number
}

export interface OrthRunResponse {
  success: boolean
  data: Record<string, unknown>
  price: string
  priceCents: number
  requestId: string
  paymentMethod: string
}

export interface OrthDetailsResponse {
  api: { slug: string; name: string }
  endpoint: { path: string; method: string; params: { name: string; type: string; required: boolean; description?: string }[] }
}

export interface OrthBalanceResponse {
  balance: string
  currency: string
}

export interface OrthListResponse {
  results: OrthSearchResult[]
  count: number
  totalEndpoints: number
  pagination: { hasMore: boolean }
}

class OrthogonalService {
  private get apiKey(): string | undefined {
    return process.env.ORTHOGONAL_API_KEY
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: this.headers(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const json = await res.json()
    if (!res.ok) {
      const msg = (json as { error?: string }).error ?? 'Unknown error'
      throw new Error(`Orthogonal API error (${res.status}): ${msg}`)
    }
    return json as T
  }

  async search(prompt: string, limit = 10): Promise<OrthSearchResponse> {
    return this.request<OrthSearchResponse>('POST', '/v1/search', { prompt, limit })
  }

  async run(api: string, path: string, body?: Record<string, unknown>, query?: Record<string, unknown>): Promise<OrthRunResponse> {
    return this.request<OrthRunResponse>('POST', '/v1/run', { api, path, body, query })
  }

  async getDetails(api: string, path: string): Promise<OrthDetailsResponse> {
    return this.request<OrthDetailsResponse>('POST', '/v1/details', { api, path })
  }

  async getBalance(): Promise<OrthBalanceResponse> {
    return this.request<OrthBalanceResponse>('GET', '/v1/balance')
  }

  async listEndpoints(limit = 100, offset = 0): Promise<OrthListResponse> {
    return this.request<OrthListResponse>('GET', `/v1/list-endpoints?limit=${limit}&offset=${offset}`)
  }
}

export const orthogonalService = new OrthogonalService()
