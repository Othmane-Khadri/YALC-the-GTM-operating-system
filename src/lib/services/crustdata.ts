// Singleton service wrapping Crustdata REST API
// Auth: Authorization: Token ${CRUSTDATA_API_KEY}
//
// CREDIT RULES (enforced — cannot be bypassed):
// 1. Always DB search first. Live search requires explicit opt-in.
// 2. Check credits before every paid call.
// 3. Track actual cost after every call.
// 4. Use autocomplete (FREE) to validate filters before paid search.
// 5. Stack filters server-side — don't fetch broad and filter locally.
// 6. Deduplicate before enrichment.
// 7. Maximize results per credit — use full limit (up to 1000 for DB).
// 8. Cached over realtime for enrichment (1 credit vs 4).

const BASE_URL = 'https://api.crustdata.com'

/** Required env vars for the Crustdata provider. */
export const envVarSchema = {
  CRUSTDATA_API_KEY: { minLength: 20 },
} as const

// Configurable default for `limit` on search calls when the caller doesn't
// override. Wired from `crustdata.max_results_per_query` in config.yaml via
// `setCrustdataDefaults`.
let _defaultMaxResults = 50

export function setCrustdataDefaults(opts: { maxResultsPerQuery?: number }): void {
  if (typeof opts.maxResultsPerQuery === 'number' && opts.maxResultsPerQuery > 0) {
    _defaultMaxResults = opts.maxResultsPerQuery
  }
}

export function getCrustdataDefaultMaxResults(): number {
  return _defaultMaxResults
}

// Credit cost reference table (from MCP tool descriptions + observed behavior)
export const CREDIT_COSTS = {
  company_identify: 0,
  company_search_db: 1,            // 1 per search
  company_search_live: 2,          // ~2 per search (documented)
  company_enrich_cached: 1,        // 1 per company
  company_enrich_realtime: 4,      // 4 per company
  people_search_db_per_100: 3,     // 3 per 100 results
  people_search_db_minimum: 3,     // min 3 even for 1 result
  people_search_live: 20,          // Conservative — documented "2" but observed ~17/call avg
  people_enrich_per_person: 3,     // midpoint of 2-5 range
  web_search_per_10: 1,            // 1 per 10 results
} as const

export type CreditOperation =
  | 'company_identify'
  | 'company_search_db'
  | 'company_search_live'
  | 'company_enrich'
  | 'people_search_db'
  | 'people_search_live'
  | 'people_enrich'
  | 'web_search'

export function estimateCost(
  operation: CreditOperation,
  params: { resultCount?: number; personCount?: number; realtime?: boolean },
): { credits: number; breakdown: string } {
  switch (operation) {
    case 'company_identify':
      return { credits: 0, breakdown: 'FREE — company identify' }
    case 'company_search_db':
      return { credits: CREDIT_COSTS.company_search_db, breakdown: '1 credit per DB search' }
    case 'company_search_live':
      return { credits: CREDIT_COSTS.company_search_live, breakdown: '~2 credits per live search' }
    case 'company_enrich': {
      const cost = params.realtime ? CREDIT_COSTS.company_enrich_realtime : CREDIT_COSTS.company_enrich_cached
      return { credits: cost, breakdown: `${cost} credit${cost > 1 ? 's' : ''} per company (${params.realtime ? 'realtime' : 'cached'})` }
    }
    case 'people_search_db': {
      const est = params.resultCount ?? 100
      const cost = Math.max(CREDIT_COSTS.people_search_db_minimum, Math.ceil(est / 100) * CREDIT_COSTS.people_search_db_per_100)
      return { credits: cost, breakdown: `3 credits per 100 results × ~${est} expected = ${cost} credits (min 3)` }
    }
    case 'people_search_live':
      return { credits: CREDIT_COSTS.people_search_live, breakdown: `~${CREDIT_COSTS.people_search_live} credits per live search (conservative estimate)` }
    case 'people_enrich': {
      const count = params.personCount ?? 1
      const cost = count * CREDIT_COSTS.people_enrich_per_person
      return { credits: cost, breakdown: `~3 credits per person × ${count} = ${cost} credits` }
    }
    case 'web_search': {
      const results = params.resultCount ?? 10
      const cost = Math.ceil(results / 10) * CREDIT_COSTS.web_search_per_10
      return { credits: cost, breakdown: `1 credit per 10 results × ${results} = ${cost} credits` }
    }
  }
}

export interface CreditTrackResult<T> {
  result: T
  actualCost: number
  balanceBefore: number
  balanceAfter: number
}

export interface CrustdataCompany {
  name: string
  website: string
  industry: string
  employee_count: number
  location: string
  description: string
  funding_stage: string
  linkedin_url?: string
  founded_year?: number
}

export interface CrustdataPerson {
  name: string
  headline: string
  title: string
  company_name: string
  company_domain: string
  linkedin_url: string
  location: string
  seniority: string
}

export interface PeopleSearchResult {
  people: CrustdataPerson[]
  totalCount: number
  nextCursor: string | null
}

interface SearchCompanyFilters {
  industry?: string
  employeeRange?: string
  location?: string
  keywords?: string
  limit?: number
}

export interface SearchPeopleFilters {
  companyNames?: string[]
  companyDomains?: string[]
  titles?: string[]
  seniorityLevels?: string[]
  location?: string
  limit?: number
  cursor?: string | null
}

function getHeaders(): Record<string, string> {
  const apiKey = process.env.CRUSTDATA_API_KEY
  if (!apiKey) throw new Error('CRUSTDATA_API_KEY must be set')
  return {
    'Authorization': `Token ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

export class CrustdataService {
  isAvailable(): boolean {
    return !!process.env.CRUSTDATA_API_KEY
  }

  async checkCredits(): Promise<number> {
    const res = await fetch(`${BASE_URL}/user/credits`, {
      headers: getHeaders(),
    })
    if (!res.ok) return -1
    const data = await res.json() as { credits?: number }
    return data.credits ?? 0
  }

  async preflight(estimatedCost: number): Promise<{ ok: boolean; balance: number; message: string }> {
    const balance = await this.checkCredits()
    const needed = Math.ceil(estimatedCost * 1.5) // 1.5x safety margin
    if (balance < 0) {
      return { ok: false, balance, message: 'Unable to check credit balance' }
    }
    if (balance < needed) {
      return { ok: false, balance, message: `Insufficient credits: need ~${estimatedCost} (with 1.5x margin = ${needed}) but only ${balance} available` }
    }
    return { ok: true, balance, message: `OK — estimated ${estimatedCost} credits, balance ${balance}` }
  }

  async executeWithTracking<T>(
    operationName: string,
    estimatedCost: number,
    fn: () => Promise<T>,
  ): Promise<CreditTrackResult<T>> {
    const balanceBefore = await this.checkCredits()
    const result = await fn()
    const balanceAfter = await this.checkCredits()
    const actualCost = balanceBefore - balanceAfter

    const ratio = estimatedCost > 0 ? Math.round(actualCost / estimatedCost) : 0
    const level = actualCost > estimatedCost * 3 ? 'WARN' : 'INFO'
    console.log(
      `[crustdata:${level}] ${operationName}: estimated=${estimatedCost} actual=${actualCost} (${ratio}x) balance=${balanceAfter}`,
    )

    return { result, actualCost, balanceBefore, balanceAfter }
  }

  async searchCompanies(filters: SearchCompanyFilters): Promise<CrustdataCompany[]> {
    const body: Record<string, unknown> = {}
    if (filters.industry) body.industry = filters.industry
    if (filters.employeeRange) body.employee_range = filters.employeeRange
    if (filters.location) body.location = filters.location
    if (filters.keywords) body.keywords = filters.keywords
    body.limit = filters.limit ?? _defaultMaxResults

    const res = await fetch(`${BASE_URL}/v1/companies/search`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Crustdata searchCompanies failed (${res.status}): ${text}`)
    }

    const data = await res.json() as { results?: Record<string, unknown>[] }
    return (data.results ?? []).map(normalizeCompany)
  }

  async enrichCompany(domain: string): Promise<CrustdataCompany> {
    const res = await fetch(`${BASE_URL}/v1/companies/enrich?domain=${encodeURIComponent(domain)}`, {
      headers: getHeaders(),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Crustdata enrichCompany failed (${res.status}): ${text}`)
    }

    const data = await res.json() as Record<string, unknown>
    return normalizeCompany(data)
  }

  async searchPeople(filters: SearchPeopleFilters): Promise<CreditTrackResult<PeopleSearchResult>> {
    const effectiveLimit = filters.limit ?? _defaultMaxResults
    const estimate = estimateCost('people_search_db', { resultCount: effectiveLimit })
    const check = await this.preflight(estimate.credits)
    if (!check.ok) {
      throw new Error(`[crustdata] Preflight failed: ${check.message}`)
    }

    return this.executeWithTracking('searchPeople', estimate.credits, () => this._searchPeopleRaw(filters))
  }

  private async _searchPeopleRaw(filters: SearchPeopleFilters): Promise<PeopleSearchResult> {
    const conditions: Record<string, unknown>[] = []

    if (filters.companyNames?.length) {
      if (filters.companyNames.length === 1) {
        conditions.push({ column: 'current_employers.name', type: '[.]', value: filters.companyNames[0] })
      } else {
        conditions.push({
          op: 'or',
          conditions: filters.companyNames.map(name => ({
            column: 'current_employers.name', type: '[.]', value: name,
          })),
        })
      }
    }

    if (filters.companyDomains?.length) {
      conditions.push({
        column: 'current_employers.company_website_domain', type: 'in', value: filters.companyDomains,
      })
    }

    if (filters.titles?.length) {
      if (filters.titles.length === 1) {
        conditions.push({ column: 'current_employers.title', type: '[.]', value: filters.titles[0] })
      } else {
        conditions.push({
          op: 'or',
          conditions: filters.titles.map(title => ({
            column: 'current_employers.title', type: '[.]', value: title,
          })),
        })
      }
    }

    if (filters.seniorityLevels?.length) {
      conditions.push({
        column: 'current_employers.seniority_level', type: 'in', value: filters.seniorityLevels,
      })
    }

    if (filters.location) {
      conditions.push({ column: 'region', type: '[.]', value: filters.location })
    }

    const filterObj = conditions.length === 1
      ? conditions[0]
      : { op: 'and', conditions }

    const body: Record<string, unknown> = {
      filters: filterObj,
      limit: Math.min(filters.limit ?? _defaultMaxResults, 1000),
    }
    if (filters.cursor) {
      body.cursor = filters.cursor
    }

    const res = await fetch(`${BASE_URL}/screener/persondb/search/`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Crustdata searchPeople failed (${res.status}): ${text}`)
    }

    const data = await res.json() as {
      profiles?: Record<string, unknown>[]
      total_count?: number
      next_cursor?: string | null
    }

    return {
      people: (data.profiles ?? []).map(normalizePerson),
      totalCount: data.total_count ?? 0,
      nextCursor: data.next_cursor ?? null,
    }
  }
}

function normalizeCompany(raw: Record<string, unknown>): CrustdataCompany {
  return {
    name: String(raw.name ?? raw.company_name ?? ''),
    website: String(raw.website ?? raw.domain ?? ''),
    industry: String(raw.industry ?? ''),
    employee_count: Number(raw.employee_count ?? raw.employees ?? 0),
    location: String(raw.location ?? raw.headquarters ?? ''),
    description: String(raw.description ?? raw.summary ?? ''),
    funding_stage: String(raw.funding_stage ?? raw.last_funding_round ?? ''),
    linkedin_url: raw.linkedin_url ? String(raw.linkedin_url) : undefined,
    founded_year: raw.founded_year ? Number(raw.founded_year) : undefined,
  }
}

function normalizePerson(raw: Record<string, unknown>): CrustdataPerson {
  const employers = raw.current_employers as Record<string, unknown>[] | undefined
  const current = employers?.[0]
  return {
    name: String(raw.name ?? ''),
    headline: String(raw.headline ?? ''),
    title: String(current?.title ?? ''),
    company_name: String(current?.name ?? ''),
    company_domain: String(current?.company_website_domain ?? ''),
    linkedin_url: String(raw.linkedin_profile_url ?? ''),
    location: String(raw.region ?? ''),
    seniority: String(current?.seniority_level ?? ''),
  }
}

export const crustdataService = new CrustdataService()
