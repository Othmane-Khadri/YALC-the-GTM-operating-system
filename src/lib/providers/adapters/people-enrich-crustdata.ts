import type { CapabilityAdapter } from '../capabilities.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface PeopleEnrichInput {
  contacts: Array<{
    firstname?: string
    lastname?: string
    domain?: string
    company_name?: string
    linkedin_url?: string
  }>
}

interface CrustdataEnrichResult {
  firstname: string
  lastname: string
  email?: string
  phone?: string
  email_status?: string
  linkedin_url?: string
}

const BASE_URL = 'https://api.crustdata.com'

export const peopleEnrichCrustdataAdapter: CapabilityAdapter = {
  capabilityId: 'people-enrich',
  providerId: 'crustdata',
  async execute(input) {
    const apiKey = process.env.CRUSTDATA_API_KEY
    if (!apiKey) {
      throw new MissingApiKeyError('crustdata', 'CRUSTDATA_API_KEY')
    }
    const { contacts } = (input ?? {}) as PeopleEnrichInput
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return { results: [] }
    }
    const results: CrustdataEnrichResult[] = []
    for (const c of contacts) {
      const params = new URLSearchParams()
      if (c.linkedin_url) params.set('linkedin_url', c.linkedin_url)
      else if (c.firstname && c.lastname && (c.domain || c.company_name)) {
        params.set('first_name', c.firstname)
        params.set('last_name', c.lastname)
        if (c.domain) params.set('domain', c.domain)
        else if (c.company_name) params.set('company_name', c.company_name)
      } else {
        continue
      }
      const res = await fetch(`${BASE_URL}/screener/person/enrich/?${params}`, {
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
      })
      if (!res.ok) {
        const text = await res.text()
        throw new ProviderApiError('crustdata', `people enrich failed: ${text}`, res.status)
      }
      const data = (await res.json()) as Record<string, unknown>
      results.push({
        firstname: String(data.first_name ?? c.firstname ?? ''),
        lastname: String(data.last_name ?? c.lastname ?? ''),
        email: data.email ? String(data.email) : undefined,
        phone: data.phone ? String(data.phone) : undefined,
        email_status: data.email_status ? String(data.email_status) : undefined,
        linkedin_url: data.linkedin_url ? String(data.linkedin_url) : c.linkedin_url,
      })
    }
    return { results }
  },
}
