// Singleton service wrapping FullEnrich REST API
// Auth: Authorization: Bearer ${FULLENRICH_API_KEY}

const BASE_URL = 'https://api.fullenrich.com'

/** Required env vars for the FullEnrich provider. */
export const envVarSchema = {
  FULLENRICH_API_KEY: { minLength: 20 },
} as const

export interface FullEnrichContact {
  firstname: string
  lastname: string
  domain?: string
  company_name?: string
  linkedin_url?: string
}

export interface FullEnrichResult {
  firstname: string
  lastname: string
  email?: string
  phone?: string
  email_status?: string
  linkedin_url?: string
}

function getHeaders(): Record<string, string> {
  const apiKey = process.env.FULLENRICH_API_KEY
  if (!apiKey) throw new Error('FULLENRICH_API_KEY must be set')
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

export class FullEnrichService {
  isAvailable(): boolean {
    return !!process.env.FULLENRICH_API_KEY
  }

  async enrichBulk(contacts: FullEnrichContact[]): Promise<string> {
    const res = await fetch(`${BASE_URL}/contact/enrich/bulk`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ contacts }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`FullEnrich enrichBulk failed (${res.status}): ${text}`)
    }

    const data = await res.json() as { enrichment_id: string }
    return data.enrichment_id
  }

  async pollResults(enrichmentId: string): Promise<FullEnrichResult[]> {
    const maxWait = 300_000 // 5 minutes
    let interval = 1000
    const start = Date.now()

    while (Date.now() - start < maxWait) {
      const res = await fetch(`${BASE_URL}/bulk/${encodeURIComponent(enrichmentId)}`, {
        headers: getHeaders(),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`FullEnrich pollResults failed (${res.status}): ${text}`)
      }

      const data = await res.json() as { status: string; results?: Record<string, unknown>[] }

      if (data.status === 'completed' && data.results) {
        return data.results.map(normalizeResult)
      }

      if (data.status === 'failed') {
        throw new Error('FullEnrich bulk enrichment failed')
      }

      // Exponential backoff: 1s, 2s, 4s, 8s... max 30s
      await new Promise(resolve => setTimeout(resolve, interval))
      interval = Math.min(interval * 2, 30_000)
    }

    throw new Error('FullEnrich pollResults timed out after 5 minutes')
  }

  async enrichSingle(contact: FullEnrichContact): Promise<FullEnrichResult> {
    const enrichmentId = await this.enrichBulk([contact])
    const results = await this.pollResults(enrichmentId)
    if (results.length === 0) {
      return {
        firstname: contact.firstname,
        lastname: contact.lastname,
        linkedin_url: contact.linkedin_url,
      }
    }
    return results[0]
  }
}

function normalizeResult(raw: Record<string, unknown>): FullEnrichResult {
  return {
    firstname: String(raw.firstname ?? raw.first_name ?? ''),
    lastname: String(raw.lastname ?? raw.last_name ?? ''),
    email: raw.email ? String(raw.email) : undefined,
    phone: raw.phone ? String(raw.phone) : undefined,
    email_status: raw.email_status ? String(raw.email_status) : undefined,
    linkedin_url: raw.linkedin_url ? String(raw.linkedin_url) : undefined,
  }
}

export const fullenrichService = new FullEnrichService()
