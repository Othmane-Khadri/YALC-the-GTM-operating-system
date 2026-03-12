import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'
import { getOrthogonalToken } from './orthogonal-token'
import { SEARCH_COLUMNS } from '../../execution/columns'

const BASE_URL = 'https://api.orth.sh'

export interface OrthEndpoint {
  path: string
  method: string
  description?: string
  price: string
  score: number
}

export interface OrthSearchResult {
  slug: string
  name?: string
  endpoints: OrthEndpoint[]
}

export class OrthogonalProvider implements StepExecutor {
  id = 'orthogonal'
  name = 'Orthogonal'
  description = 'Universal API gateway — semantically searches 100+ APIs (Apollo, LinkedIn, Google, etc.) and executes the best match. Supports search and enrichment.'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['search', 'enrich']

  isAvailable(): boolean {
    return !!(process.env.ORTHOGONAL_API_KEY)
  }

  canExecute(step: WorkflowStepInput): boolean {
    if (step.provider === 'orthogonal') return true
    return step.stepType === 'search' || step.stepType === 'enrich'
  }

  async searchAPIs(prompt: string, limit = 5): Promise<OrthSearchResult[]> {
    const token = await getOrthogonalToken()
    const res = await fetch(`${BASE_URL}/v1/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ prompt, limit }),
    })
    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Orthogonal /v1/search failed (${res.status}): ${errText}`)
    }
    const data = await res.json() as { results?: OrthSearchResult[] }
    return data.results ?? []
  }

  async runAPI(
    slug: string,
    path: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const token = await getOrthogonalToken()

    // /v1/run expects: { api, path, body?, query? }
    // Use `body` for POST/PUT/PATCH, `query` for GET/DELETE
    const isBodyMethod = ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())
    const payload: Record<string, unknown> = { api: slug, path }
    if (isBodyMethod) {
      payload.body = params
    } else {
      payload.query = params
    }

    const res = await fetch(`${BASE_URL}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Orthogonal /v1/run failed (${res.status}): ${errText}`)
    }
    const data = await res.json() as { success?: boolean; data?: unknown }
    if (!data.success) {
      throw new Error(`Orthogonal run error: ${JSON.stringify(data)}`)
    }
    return data.data
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    // 1. Build a descriptive search prompt for Orthogonal's semantic search
    const query = step.config?.query ? String(step.config.query) : ''
    let searchPrompt: string

    if (step.stepType === 'search') {
      searchPrompt = query
        ? `find companies or people: ${query}`
        : step.description
    } else if (step.stepType === 'enrich') {
      searchPrompt = query
        ? `enrich leads: ${query}`
        : step.config?.url
          ? `scrape data from ${step.config.url}`
          : `enrich company or people data: ${step.description}`
    } else {
      searchPrompt = step.description
    }

    // 2. Find the best API via /v1/search
    const searchResults = await this.searchAPIs(searchPrompt, 5)
    if (searchResults.length === 0) {
      throw new Error(`Orthogonal found no APIs matching: "${searchPrompt}"`)
    }

    // Pick the best endpoint with the highest score
    const bestResult = searchResults[0]
    const bestEndpoint = bestResult.endpoints[0]
    if (!bestEndpoint) {
      throw new Error(`Orthogonal API "${bestResult.slug}" has no endpoints`)
    }

    console.log(`[Orthogonal] Matched: ${bestResult.slug} ${bestEndpoint.method} ${bestEndpoint.path} (score: ${bestEndpoint.score})`)

    // 3. Build params based on what the matched API likely expects
    //    Pass query/description as the main search param, plus limit
    const params: Record<string, unknown> = {}

    // Common search params — APIs typically accept q/query/keyword/search_query
    if (query) {
      params.q = query
      params.query = query
    }

    // Pass limit/count
    if (context.totalRequested) {
      params.limit = context.totalRequested
      params.per_page = context.totalRequested
    }

    // Pass any explicit config that looks like real API params (not our internal keys)
    const internalKeys = new Set(['query', 'targetCount', 'filters', 'url', 'enrichmentGoal', 'criteria'])
    if (step.config) {
      for (const [k, v] of Object.entries(step.config)) {
        if (!internalKeys.has(k) && v !== undefined) {
          params[k] = v
        }
      }
    }

    // If enriching with previous rows, pass them
    if (step.stepType === 'enrich' && context.previousStepRows?.length) {
      params.leads = context.previousStepRows
    }

    // If there's a URL, pass it as url param
    if (step.config?.url) {
      params.url = step.config.url
    }

    // 4. Execute the API call
    const rawData = await this.runAPI(bestResult.slug, bestEndpoint.path, bestEndpoint.method, params)

    // 5. Normalize into rows and flatten nested fields
    const rawRows = this.normalizeResponse(rawData)
    const rows = rawRows.map(row => this.flattenRow(row))

    if (rows.length === 0) {
      yield { rows: [], batchIndex: 0, totalSoFar: 0 }
      return
    }

    // 6. Yield in batches
    const batchSize = context.batchSize || 10
    const batches = Math.ceil(rows.length / batchSize)
    let totalSoFar = 0

    for (let i = 0; i < batches; i++) {
      const slice = rows.slice(i * batchSize, (i + 1) * batchSize)
      totalSoFar += slice.length
      yield {
        rows: slice,
        batchIndex: i,
        totalSoFar,
      }
    }
  }

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    // Orthogonal returns dynamic schemas — use generic search columns
    // The actual columns are inferred from the first batch of data
    return SEARCH_COLUMNS
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      const token = await getOrthogonalToken()
      // Simple search to verify connectivity
      const res = await fetch(`${BASE_URL}/v1/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt: 'test', limit: 1 }),
      })
      return res.ok
        ? { ok: true, message: 'Orthogonal connection OK' }
        : { ok: false, message: `Orthogonal auth failed: ${res.status}` }
    } catch (err) {
      return { ok: false, message: `Orthogonal unreachable: ${err}` }
    }
  }

  /** Flatten nested API response objects into table-friendly flat rows */
  private flattenRow(row: Record<string, unknown>): Record<string, unknown> {
    const flat: Record<string, unknown> = {}

    for (const [key, val] of Object.entries(row)) {
      if (val === null || val === undefined) continue

      if (Array.isArray(val)) {
        // Arrays of strings → join; arrays of objects → skip (too complex for table)
        if (val.length > 0 && typeof val[0] === 'string') {
          flat[key] = val.join(', ')
        } else if (val.length === 0) {
          flat[key] = ''
        }
      } else if (typeof val === 'object') {
        // Flatten simple numeric ranges (e.g. employee_count_consensus: { gte: 55, lte: 55 })
        const obj = val as Record<string, unknown>
        if ('gte' in obj && 'lte' in obj) {
          flat[key] = obj.gte === obj.lte ? obj.gte : `${obj.gte}–${obj.lte}`
        }
        // Skip other complex objects
      } else {
        flat[key] = val
      }
    }

    // Map common API field names to our standard column keys
    if (!flat.company_name) {
      flat.company_name = flat.name || flat.company || flat.organization_name || flat.linkedin_primary_slug || ''
    }
    if (!flat.website && flat.domains) {
      flat.website = String(flat.domains).split(',')[0]?.trim()
    }
    if (!flat.employee_count && flat.employee_count_consensus) {
      flat.employee_count = flat.employee_count_consensus
    }
    if (!flat.location) {
      flat.location = flat.headquarters || flat.country || flat.city || ''
    }

    return flat
  }

  /** Normalize any Orthogonal API response into flat rows */
  private normalizeResponse(data: unknown): Record<string, unknown>[] {
    if (Array.isArray(data)) return data as Record<string, unknown>[]

    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>

      // Check common data keys at any nesting level (handles data.output.data, data.results, etc.)
      const dataKeys = ['results', 'data', 'items', 'leads', 'people', 'companies', 'contacts', 'records', 'output']
      for (const key of dataKeys) {
        const val = obj[key]
        if (Array.isArray(val)) {
          return val as Record<string, unknown>[]
        }
        // Recurse one level into nested objects (e.g. output.data, data.results)
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const nested = val as Record<string, unknown>
          for (const innerKey of dataKeys) {
            if (Array.isArray(nested[innerKey])) {
              return nested[innerKey] as Record<string, unknown>[]
            }
          }
        }
      }

      // Single object — wrap in array
      return [obj]
    }

    return []
  }
}
