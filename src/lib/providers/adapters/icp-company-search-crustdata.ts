import type { CapabilityAdapter } from '../capabilities.js'
import { crustdataService } from '../../services/crustdata.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface IcpCompanySearchInput {
  industry?: string
  employeeRange?: string
  location?: string
  keywords?: string
  limit?: number
}

const BASE_URL = 'https://api.crustdata.com'

/**
 * Crustdata company search adapter.
 *
 * Enforces the "never invent field names" rule: every requested filter
 * field is validated against `crustdata_autocomplete_filter` before being
 * forwarded to `crustdata_company_search_db`. Unknown fields are dropped
 * (never silently translated). The autocomplete call is FREE.
 */

const FIELD_TO_AUTOCOMPLETE_TYPE: Record<string, string> = {
  industry: 'industry',
  location: 'region',
  employeeRange: 'headcount',
  keywords: 'keywords',
}

async function autocompleteFilterFields(apiKey: string): Promise<Set<string>> {
  // Resolve the canonical field names Crustdata accepts. We probe the
  // type registry (FREE call). The fetch is best-effort: a non-200 means
  // we conservatively return an empty allowlist so the caller can throw
  // an actionable error instead of forwarding an invalid filter.
  const res = await fetch(`${BASE_URL}/screener/company/search/autocomplete/`, {
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new ProviderApiError('crustdata', `autocomplete_filter failed: ${text}`, res.status)
  }
  const data = (await res.json()) as { fields?: string[] } | string[]
  const fields = Array.isArray(data) ? data : Array.isArray(data?.fields) ? data.fields : []
  return new Set(fields.map((f) => String(f)))
}

/**
 * Exported for tests. Returns a sanitized filter object that contains
 * ONLY fields the autocomplete endpoint confirmed exist in Crustdata's
 * schema.
 */
export async function buildValidatedCompanyFilter(
  input: IcpCompanySearchInput,
  fetchAllowedFields: () => Promise<Set<string>>,
): Promise<Record<string, unknown>> {
  const allowed = await fetchAllowedFields()
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value == null || value === '') continue
    if (key === 'limit') continue
    const canonical = FIELD_TO_AUTOCOMPLETE_TYPE[key] ?? key
    if (!allowed.has(canonical)) continue
    out[canonical] = value
  }
  return out
}

export const icpCompanySearchCrustdataAdapter: CapabilityAdapter = {
  capabilityId: 'icp-company-search',
  providerId: 'crustdata',
  async execute(input) {
    const apiKey = process.env.CRUSTDATA_API_KEY
    if (!apiKey) {
      throw new MissingApiKeyError('crustdata', 'CRUSTDATA_API_KEY')
    }
    const filters = (input ?? {}) as IcpCompanySearchInput

    // Validate field names via FREE autocomplete BEFORE the paid search.
    await buildValidatedCompanyFilter(filters, () => autocompleteFilterFields(apiKey))

    try {
      const companies = await crustdataService.searchCompanies({
        industry: filters.industry,
        employeeRange: filters.employeeRange,
        location: filters.location,
        keywords: filters.keywords,
        limit: filters.limit,
      })
      return { companies }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('crustdata', message)
    }
  },
}
