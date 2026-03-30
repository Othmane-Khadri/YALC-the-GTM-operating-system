// Singleton service wrapping Crustdata REST API
// Auth: Authorization: Token ${CRUSTDATA_API_KEY}

const BASE_URL = 'https://api.crustdata.com'

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
  first_name: string
  last_name: string
  title: string
  company_name: string
  company_domain: string
  linkedin_url: string
  location: string
  seniority: string
}

interface SearchCompanyFilters {
  industry?: string
  employeeRange?: string
  location?: string
  keywords?: string
  limit?: number
}

interface SearchPeopleFilters {
  title?: string
  companyDomain?: string
  seniority?: string
  location?: string
  limit?: number
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

  async searchCompanies(filters: SearchCompanyFilters): Promise<CrustdataCompany[]> {
    const body: Record<string, unknown> = {}
    if (filters.industry) body.industry = filters.industry
    if (filters.employeeRange) body.employee_range = filters.employeeRange
    if (filters.location) body.location = filters.location
    if (filters.keywords) body.keywords = filters.keywords
    body.limit = filters.limit ?? 50

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

  async searchPeople(filters: SearchPeopleFilters): Promise<CrustdataPerson[]> {
    const body: Record<string, unknown> = {}
    if (filters.title) body.title = filters.title
    if (filters.companyDomain) body.company_domain = filters.companyDomain
    if (filters.seniority) body.seniority = filters.seniority
    if (filters.location) body.location = filters.location
    body.limit = filters.limit ?? 50

    const res = await fetch(`${BASE_URL}/v1/people/search`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Crustdata searchPeople failed (${res.status}): ${text}`)
    }

    const data = await res.json() as { results?: Record<string, unknown>[] }
    return (data.results ?? []).map(normalizePerson)
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
  return {
    first_name: String(raw.first_name ?? ''),
    last_name: String(raw.last_name ?? ''),
    title: String(raw.title ?? raw.job_title ?? ''),
    company_name: String(raw.company_name ?? ''),
    company_domain: String(raw.company_domain ?? raw.domain ?? ''),
    linkedin_url: String(raw.linkedin_url ?? ''),
    location: String(raw.location ?? ''),
    seniority: String(raw.seniority ?? ''),
  }
}

export const crustdataService = new CrustdataService()
