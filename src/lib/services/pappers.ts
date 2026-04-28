// Singleton service wrapping the Pappers REST API.
// Auth: api_token query param (OR `Authorization: Bearer ${PAPPERS_API_KEY}`
// depending on the endpoint — the Pappers docs are inconsistent; we pass
// both so each endpoint accepts the key it expects).
//
// SCOPE NOTE: this stub exists to back the icp-company-search-pappers
// adapter declared in the provider knowledge base. The full Pappers
// surface (entreprise search, filings, dirigeants, etc.) lands in a
// later phase — for 0.8.E we only commit the type contract + an
// `isAvailable()` gate.

const BASE_URL = 'https://api.pappers.fr'

/** Required env vars for the Pappers provider. */
export const envVarSchema = {
  PAPPERS_API_KEY: { minLength: 8 },
} as const

export interface PappersCompany {
  siren?: string
  name?: string
  industry?: string
  employee_count?: number
  location?: string
  description?: string
  website?: string
}

export interface PappersSearchInput {
  industry?: string
  employeeRange?: string
  location?: string
  keywords?: string
  segments?: string
  limit?: number
}

export class PappersService {
  isAvailable(): boolean {
    return !!process.env.PAPPERS_API_KEY
  }

  /**
   * Search the Pappers entreprise database. Stub for 0.8.E — throws a
   * deliberate `not yet implemented` so callers know the provider was
   * resolved (not silently misrouted) but the wire-up has not landed.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async searchCompanies(_input: PappersSearchInput): Promise<PappersCompany[]> {
    throw new Error(
      'PappersService.searchCompanies is not yet implemented. The Pappers icp-company-search adapter ships as a stub in 0.8.0; full wire-up is tracked for a later phase.',
    )
  }

  /** Lazy URL builder kept for the future implementation. */
  buildSearchUrl(query: Record<string, string | number | undefined>): string {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue
      params.set(k, String(v))
    }
    return `${BASE_URL}/v2/recherche?${params.toString()}`
  }
}

export const pappersService = new PappersService()
