import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Tests for the PredictLeads service wrapper.
 *
 * Auth: PredictLeads requires both X-Api-Key and X-Api-Token headers.
 * Base URL: https://predictleads.com/api/v3
 *
 * fetch is mocked via globalThis.fetch so we can assert on URL + headers
 * without making real network calls.
 */

const BASE = 'https://predictleads.com/api/v3'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('PREDICTLEADS_API_KEY', 'test-key-1234567890abcdef')
  vi.stubEnv('PREDICTLEADS_API_TOKEN', 'test-token-1234567890abcdef')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function mockFetchOk(body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  )
}

describe('predictleads service', () => {
  it('exposes envVarSchema requiring both API key and token', async () => {
    const { envVarSchema } = await import('../lib/services/predictleads')
    expect(envVarSchema).toHaveProperty('PREDICTLEADS_API_KEY')
    expect(envVarSchema).toHaveProperty('PREDICTLEADS_API_TOKEN')
  })

  it('isAvailable() returns false when either env var missing', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('PREDICTLEADS_API_KEY', 'only-key')
    const { predictleadsService } = await import('../lib/services/predictleads')
    expect(predictleadsService.isAvailable()).toBe(false)
  })

  it('isAvailable() returns true when both env vars set', async () => {
    const { predictleadsService } = await import('../lib/services/predictleads')
    expect(predictleadsService.isAvailable()).toBe(true)
  })

  it('getCompany(domain) hits /companies/{domain} with auth headers', async () => {
    const fetchSpy = mockFetchOk({ data: { id: 'abc', type: 'company', attributes: { domain: 'hubspot.com' } } })
    const { predictleadsService } = await import('../lib/services/predictleads')

    await predictleadsService.getCompany('hubspot.com')

    expect(fetchSpy).toHaveBeenCalledOnce()
    const call = fetchSpy.mock.calls[0]
    expect(call[0]).toBe(`${BASE}/companies/hubspot.com`)
    const init = call[1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['X-Api-Key']).toBe('test-key-1234567890abcdef')
    expect(headers['X-Api-Token']).toBe('test-token-1234567890abcdef')
  })

  it('getJobOpenings(domain) hits /companies/{domain}/job_openings', async () => {
    const fetchSpy = mockFetchOk({ data: [], included: [] })
    const { predictleadsService } = await import('../lib/services/predictleads')

    await predictleadsService.getJobOpenings('hubspot.com')

    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/companies/hubspot.com/job_openings`)
  })

  it('getFinancingEvents(domain) hits /companies/{domain}/financing_events', async () => {
    const fetchSpy = mockFetchOk({ data: [] })
    const { predictleadsService } = await import('../lib/services/predictleads')

    await predictleadsService.getFinancingEvents('hubspot.com')

    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/companies/hubspot.com/financing_events`)
  })

  it('getNewsEvents(domain) hits /companies/{domain}/news_events', async () => {
    const fetchSpy = mockFetchOk({ data: [] })
    const { predictleadsService } = await import('../lib/services/predictleads')

    await predictleadsService.getNewsEvents('hubspot.com')

    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/companies/hubspot.com/news_events`)
  })

  it('getTechnologies(domain) hits /companies/{domain}/technology_detections', async () => {
    const fetchSpy = mockFetchOk({ data: [] })
    const { predictleadsService } = await import('../lib/services/predictleads')

    await predictleadsService.getTechnologies('hubspot.com')

    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/companies/hubspot.com/technology_detections`)
  })

  it('getSimilarCompanies(domain) hits /companies/{domain}/similar_companies', async () => {
    const fetchSpy = mockFetchOk({ data: [] })
    const { predictleadsService } = await import('../lib/services/predictleads')

    await predictleadsService.getSimilarCompanies('hubspot.com')

    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/companies/hubspot.com/similar_companies`)
  })

  it('throws with HTTP status on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Forbidden', { status: 403 }),
    )
    const { predictleadsService } = await import('../lib/services/predictleads')

    await expect(predictleadsService.getCompany('hubspot.com')).rejects.toThrow(/403/)
  })

  it('retries once on 429 then succeeds', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'x' } }), { status: 200 }))
    const { predictleadsService } = await import('../lib/services/predictleads')

    const result = await predictleadsService.getCompany('hubspot.com')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect((result as { data: { id: string } }).data.id).toBe('x')
  })

  it('throws when env vars are missing at request time', async () => {
    vi.unstubAllEnvs()
    const { predictleadsService } = await import('../lib/services/predictleads')

    await expect(predictleadsService.getCompany('hubspot.com')).rejects.toThrow(/PREDICTLEADS_API_KEY/)
  })
})
