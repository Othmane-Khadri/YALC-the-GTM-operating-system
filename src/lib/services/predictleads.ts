// Singleton service wrapping the PredictLeads REST API.
//
// Auth: two headers — X-Api-Key + X-Api-Token. Both required.
// Base URL: https://predictleads.com/api/v3
//
// Phase 1 (this file): pull-based enrichment for company-level signals.
// Phase 2 (future):    webhook receiver for real-time monitoring.

const BASE_URL = 'https://predictleads.com/api/v3'

/** Required env vars for the PredictLeads provider. */
export const envVarSchema = {
  PREDICTLEADS_API_KEY: { minLength: 10 },
  PREDICTLEADS_API_TOKEN: { minLength: 10 },
} as const

export type SignalType =
  | 'job_opening'
  | 'financing'
  | 'technology'
  | 'news'
  | 'similar_company'

export interface PredictLeadsResponse<T = unknown> {
  data: T
  included?: unknown[]
  meta?: Record<string, unknown>
}

interface ListOptions {
  limit?: number
  page?: number
  /** ISO date — only events on/after this date. */
  since?: string
}

function getHeaders(): Record<string, string> {
  const apiKey = process.env.PREDICTLEADS_API_KEY
  const apiToken = process.env.PREDICTLEADS_API_TOKEN
  if (!apiKey) throw new Error('PREDICTLEADS_API_KEY must be set')
  if (!apiToken) throw new Error('PREDICTLEADS_API_TOKEN must be set')
  return {
    'X-Api-Key': apiKey,
    'X-Api-Token': apiToken,
    'Content-Type': 'application/json',
  }
}

function buildQuery(opts: ListOptions | undefined): string {
  if (!opts) return ''
  const parts: string[] = []
  if (opts.limit) parts.push(`limit=${opts.limit}`)
  if (opts.page) parts.push(`page=${opts.page}`)
  if (opts.since) parts.push(`updated_at_from=${encodeURIComponent(opts.since)}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

async function getJson<T>(url: string): Promise<T> {
  let res = await fetch(url, { headers: getHeaders() })

  // Light retry: one retry on 429 with a 2-second backoff.
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000))
    res = await fetch(url, { headers: getHeaders() })
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PredictLeads ${url} failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<T>
}

export class PredictLeadsService {
  isAvailable(): boolean {
    return !!process.env.PREDICTLEADS_API_KEY && !!process.env.PREDICTLEADS_API_TOKEN
  }

  /** Auth probe + subscription check. Free, no result quota. */
  async getSubscription(): Promise<PredictLeadsResponse> {
    return getJson(`${BASE_URL}/api_subscription`)
  }

  async getCompany(domain: string): Promise<PredictLeadsResponse> {
    return getJson(`${BASE_URL}/companies/${encodeURIComponent(domain)}`)
  }

  async getJobOpenings(domain: string, opts?: ListOptions): Promise<PredictLeadsResponse> {
    return getJson(`${BASE_URL}/companies/${encodeURIComponent(domain)}/job_openings${buildQuery(opts)}`)
  }

  async getFinancingEvents(domain: string, opts?: ListOptions): Promise<PredictLeadsResponse> {
    return getJson(`${BASE_URL}/companies/${encodeURIComponent(domain)}/financing_events${buildQuery(opts)}`)
  }

  async getNewsEvents(domain: string, opts?: ListOptions): Promise<PredictLeadsResponse> {
    return getJson(`${BASE_URL}/companies/${encodeURIComponent(domain)}/news_events${buildQuery(opts)}`)
  }

  async getTechnologies(domain: string, opts?: ListOptions): Promise<PredictLeadsResponse> {
    return getJson(`${BASE_URL}/companies/${encodeURIComponent(domain)}/technology_detections${buildQuery(opts)}`)
  }

  async getSimilarCompanies(domain: string, opts?: ListOptions): Promise<PredictLeadsResponse> {
    return getJson(`${BASE_URL}/companies/${encodeURIComponent(domain)}/similar_companies${buildQuery(opts)}`)
  }
}

export const predictleadsService = new PredictLeadsService()
