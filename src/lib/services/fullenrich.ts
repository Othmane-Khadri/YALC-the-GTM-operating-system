// Singleton service wrapping FullEnrich REST API
// Auth: Authorization: Bearer ${FULLENRICH_API_KEY}

const BASE_URL = 'https://app.fullenrich.com/api/v1'

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

  async enrichBulk(
    contacts: FullEnrichContact[],
    name = 'GTM-OS enrichment',
    enrichFields: string[] = ['contact.emails', 'contact.phones'],
  ): Promise<string> {
    // FullEnrich's bulk endpoint expects the contact array under `datas` (not
    // `contacts`, which returns 400 error.enrichment.data.empty), a non-empty
    // `name` (else error.enrichment.name.empty), and a per-contact
    // `enrich_fields` list whose values must be one of contact.emails,
    // contact.work_emails, contact.personal_emails, contact.phones.
    const datas = contacts.map((c) => ({ ...c, enrich_fields: enrichFields }))
    const res = await fetch(`${BASE_URL}/contact/enrich/bulk`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, datas }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`FullEnrich enrichBulk failed (${res.status}): ${text}`)
    }

    const data = await res.json() as { enrichment_id: string }
    return data.enrichment_id
  }

  async pollResults(enrichmentId: string): Promise<FullEnrichResult[]> {
    const maxWait = 600_000 // 10 minutes; FullEnrich often takes several
    let interval = 1000
    const start = Date.now()

    while (Date.now() - start < maxWait) {
      const res = await fetch(`${BASE_URL}/contact/enrich/bulk/${encodeURIComponent(enrichmentId)}`, {
        headers: getHeaders(),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`FullEnrich pollResults failed (${res.status}): ${text}`)
      }

      // FullEnrich reports completion as status "FINISHED" and returns the
      // enriched rows under `datas` (each wrapped in a `contact` object), not
      // "completed"/`results`. Terminal failure states end in FAILED/CANCELED.
      const data = await res.json() as { status?: string; datas?: Record<string, unknown>[] }
      const status = (data.status ?? '').toUpperCase()

      if (status === 'FINISHED') {
        return (data.datas ?? []).map(normalizeResult)
      }

      if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED' || status === 'ERROR') {
        throw new Error(`FullEnrich bulk enrichment ${data.status}`)
      }

      // Exponential backoff: 1s, 2s, 4s, 8s... max 30s
      await new Promise(resolve => setTimeout(resolve, interval))
      interval = Math.min(interval * 2, 30_000)
    }

    throw new Error('FullEnrich pollResults timed out after 10 minutes')
  }

  async enrichSingle(contact: FullEnrichContact): Promise<FullEnrichResult> {
    const label = [contact.firstname, contact.lastname].filter(Boolean).join(' ') || 'GTM-OS enrichment'
    const enrichmentId = await this.enrichBulk([contact], label)
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

function normalizeResult(row: Record<string, unknown>): FullEnrichResult {
  // Each FullEnrich row wraps the enriched data in a `contact` object. Email
  // and phone come back as a "most probable" scalar plus parallel arrays.
  const contact = ((row.contact as Record<string, unknown>) ?? row) as Record<string, unknown>
  const profile = (contact.profile as Record<string, unknown>) ?? {}
  const emails = Array.isArray(contact.emails) ? (contact.emails as Record<string, unknown>[]) : []
  const phones = Array.isArray(contact.phones) ? (contact.phones as Record<string, unknown>[]) : []

  const email =
    (contact.most_probable_email as string) ||
    (contact.most_probable_personal_email as string) ||
    (emails[0]?.email as string) ||
    undefined
  const phone =
    (contact.most_probable_phone as string) ||
    (phones[0]?.number as string) ||
    undefined
  const emailStatus =
    (contact.most_probable_email_status as string) ||
    (emails[0]?.status as string) ||
    undefined

  return {
    firstname: String(contact.firstname ?? ''),
    lastname: String(contact.lastname ?? ''),
    email: email ? String(email) : undefined,
    phone: phone ? String(phone) : undefined,
    email_status: emailStatus ? String(emailStatus) : undefined,
    linkedin_url: profile.linkedin_url
      ? String(profile.linkedin_url)
      : contact.linkedin_url
        ? String(contact.linkedin_url)
        : undefined,
  }
}

export const fullenrichService = new FullEnrichService()
