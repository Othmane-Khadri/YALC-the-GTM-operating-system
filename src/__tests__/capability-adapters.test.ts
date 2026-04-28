import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { CapabilityAdapter } from '../lib/providers/capabilities'

describe('icp-company-search adapters', () => {
  let prevEnv: Record<string, string | undefined>

  beforeEach(() => {
    prevEnv = {
      CRUSTDATA_API_KEY: process.env.CRUSTDATA_API_KEY,
    }
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.env.CRUSTDATA_API_KEY = prevEnv.CRUSTDATA_API_KEY
    vi.restoreAllMocks()
  })

  it('crustdata adapter calls autocomplete_filter BEFORE company_search_db', async () => {
    process.env.CRUSTDATA_API_KEY = 'test-key-1234567890123456789012345'
    const callOrder: string[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url
      if (u.includes('autocomplete')) {
        callOrder.push('autocomplete')
        return new Response(JSON.stringify({ fields: ['industry', 'region', 'headcount', 'keywords'] }), { status: 200 })
      }
      if (u.includes('/v1/companies/search')) {
        callOrder.push('search')
        return new Response(JSON.stringify({ results: [{ name: 'Acme', website: 'acme.com' }] }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${u}`)
    })
    const { icpCompanySearchCrustdataAdapter } = await import('../lib/providers/adapters/icp-company-search-crustdata')
    const out = (await icpCompanySearchCrustdataAdapter.execute(
      { industry: 'SaaS', limit: 5 },
      { executor: null, registry: null as never },
    )) as { companies: Array<{ name: string }> }
    expect(out.companies).toHaveLength(1)
    expect(out.companies[0].name).toBe('Acme')
    expect(callOrder).toEqual(['autocomplete', 'search'])
    fetchSpy.mockRestore()
  })

  it('crustdata adapter only forwards filter fields confirmed by autocomplete', async () => {
    const { buildValidatedCompanyFilter } = await import('../lib/providers/adapters/icp-company-search-crustdata')
    const allowed = new Set(['industry', 'region'])
    const filter = await buildValidatedCompanyFilter(
      { industry: 'SaaS', employeeRange: '11-50', location: 'US', keywords: 'AI' },
      async () => allowed,
    )
    // employeeRange (canonical: headcount) and keywords are NOT in the allowed
    // set, so they must be dropped. Only industry + region (location) survive.
    expect(filter).toEqual({ industry: 'SaaS', region: 'US' })
    expect('headcount' in filter).toBe(false)
    expect('keywords' in filter).toBe(false)
  })

  it('crustdata adapter throws MissingApiKeyError when CRUSTDATA_API_KEY is unset', async () => {
    delete process.env.CRUSTDATA_API_KEY
    const { icpCompanySearchCrustdataAdapter } = await import('../lib/providers/adapters/icp-company-search-crustdata')
    await expect(
      icpCompanySearchCrustdataAdapter.execute({ industry: 'SaaS' }, { executor: null, registry: null as never }),
    ).rejects.toThrow(/CRUSTDATA_API_KEY/)
  })

  it('apollo adapter throws when no executor is registered', async () => {
    const { icpCompanySearchApolloAdapter } = await import('../lib/providers/adapters/icp-company-search-apollo')
    await expect(
      icpCompanySearchApolloAdapter.execute({}, { executor: null, registry: null as never }),
    ).rejects.toThrow(/Apollo provider not registered/)
  })

  it('apollo adapter executes a step against the provided executor', async () => {
    const calls: unknown[] = []
    const fakeExecutor = {
      id: 'apollo',
      name: 'Apollo',
      description: '',
      type: 'mcp' as const,
      capabilities: ['search' as const],
      isAvailable: () => true,
      canExecute: () => true,
      async *execute(step: unknown) {
        calls.push(step)
        yield { rows: [{ name: 'CompanyA' }, { name: 'CompanyB' }], batchIndex: 0, totalSoFar: 2 }
      },
      getColumnDefinitions: () => [],
    }
    const { icpCompanySearchApolloAdapter } = await import('../lib/providers/adapters/icp-company-search-apollo')
    const out = (await icpCompanySearchApolloAdapter.execute(
      { industry: 'SaaS', limit: 25 },
      { executor: fakeExecutor as never, registry: null as never },
    )) as { companies: unknown[] }
    expect(out.companies).toHaveLength(2)
    expect(calls).toHaveLength(1)
  })
})

describe('people-enrich adapters', () => {
  let prevEnv: Record<string, string | undefined>

  beforeEach(() => {
    prevEnv = {
      FULLENRICH_API_KEY: process.env.FULLENRICH_API_KEY,
      CRUSTDATA_API_KEY: process.env.CRUSTDATA_API_KEY,
    }
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.env.FULLENRICH_API_KEY = prevEnv.FULLENRICH_API_KEY
    process.env.CRUSTDATA_API_KEY = prevEnv.CRUSTDATA_API_KEY
    vi.restoreAllMocks()
  })

  it('fullenrich adapter throws MissingApiKeyError without FULLENRICH_API_KEY', async () => {
    delete process.env.FULLENRICH_API_KEY
    const { peopleEnrichFullenrichAdapter } = await import('../lib/providers/adapters/people-enrich-fullenrich')
    await expect(
      peopleEnrichFullenrichAdapter.execute(
        { contacts: [{ firstname: 'Jane', lastname: 'Doe' }] },
        { executor: null, registry: null as never },
      ),
    ).rejects.toThrow(/FULLENRICH_API_KEY/)
  })

  it('fullenrich adapter returns enriched results for valid contacts', async () => {
    process.env.FULLENRICH_API_KEY = 'test-key-1234567890123456789012345'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url
      if (u.endsWith('/contact/enrich/bulk')) {
        return new Response(JSON.stringify({ enrichment_id: 'enr-1' }), { status: 200 })
      }
      if (u.includes('/bulk/')) {
        return new Response(
          JSON.stringify({
            status: 'completed',
            results: [{ firstname: 'Jane', lastname: 'Doe', email: 'jane@acme.com' }],
          }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected fetch: ${u}`)
    })
    const { peopleEnrichFullenrichAdapter } = await import('../lib/providers/adapters/people-enrich-fullenrich')
    const out = (await peopleEnrichFullenrichAdapter.execute(
      { contacts: [{ firstname: 'Jane', lastname: 'Doe', domain: 'acme.com' }] },
      { executor: null, registry: null as never },
    )) as { results: Array<{ email: string }> }
    expect(out.results).toHaveLength(1)
    expect(out.results[0].email).toBe('jane@acme.com')
    fetchSpy.mockRestore()
  })

  it('crustdata people-enrich adapter throws without CRUSTDATA_API_KEY', async () => {
    delete process.env.CRUSTDATA_API_KEY
    const { peopleEnrichCrustdataAdapter } = await import('../lib/providers/adapters/people-enrich-crustdata')
    await expect(
      peopleEnrichCrustdataAdapter.execute(
        { contacts: [{ firstname: 'Jane', lastname: 'Doe', domain: 'acme.com' }] },
        { executor: null, registry: null as never },
      ),
    ).rejects.toThrow(/CRUSTDATA_API_KEY/)
  })

  it('crustdata people-enrich adapter returns normalized results', async () => {
    process.env.CRUSTDATA_API_KEY = 'test-key-1234567890123456789012345'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ first_name: 'Jane', last_name: 'Doe', email: 'jane@acme.com', email_status: 'valid' }),
        { status: 200 },
      ),
    )
    const { peopleEnrichCrustdataAdapter } = await import('../lib/providers/adapters/people-enrich-crustdata')
    const out = (await peopleEnrichCrustdataAdapter.execute(
      { contacts: [{ firstname: 'Jane', lastname: 'Doe', domain: 'acme.com' }] },
      { executor: null, registry: null as never },
    )) as { results: Array<{ email: string; email_status: string }> }
    expect(out.results).toHaveLength(1)
    expect(out.results[0].email).toBe('jane@acme.com')
    expect(out.results[0].email_status).toBe('valid')
    fetchSpy.mockRestore()
  })
})

describe('linkedin-engager-fetch adapter', () => {
  let prevEnv: Record<string, string | undefined>

  beforeEach(() => {
    prevEnv = {
      UNIPILE_API_KEY: process.env.UNIPILE_API_KEY,
      UNIPILE_DSN: process.env.UNIPILE_DSN,
    }
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.env.UNIPILE_API_KEY = prevEnv.UNIPILE_API_KEY
    process.env.UNIPILE_DSN = prevEnv.UNIPILE_DSN
    vi.restoreAllMocks()
  })

  it('throws MissingApiKeyError without UNIPILE_API_KEY', async () => {
    delete process.env.UNIPILE_API_KEY
    delete process.env.UNIPILE_DSN
    const { linkedinEngagerFetchUnipileAdapter } = await import('../lib/providers/adapters/linkedin-engager-fetch-unipile')
    await expect(
      linkedinEngagerFetchUnipileAdapter.execute(
        { accountId: 'a1', postId: 'p1' },
        { executor: null, registry: null as never },
      ),
    ).rejects.toThrow(/UNIPILE_API_KEY/)
  })

  it('returns reactions+comments tagged by type', async () => {
    process.env.UNIPILE_API_KEY = 'test-key-1234567890'
    process.env.UNIPILE_DSN = 'https://api1.unipile.com:1234'
    const { unipileService } = await import('../lib/services/unipile')
    vi.spyOn(unipileService, 'listPostReactions').mockResolvedValue([{ id: 'react-1' }])
    vi.spyOn(unipileService, 'listPostComments').mockResolvedValue([{ id: 'cmt-1' }])
    const { linkedinEngagerFetchUnipileAdapter } = await import('../lib/providers/adapters/linkedin-engager-fetch-unipile')
    const out = (await linkedinEngagerFetchUnipileAdapter.execute(
      { accountId: 'a1', postId: 'p1' },
      { executor: null, registry: null as never },
    )) as { engagers: Array<{ type: string }> }
    expect(out.engagers).toHaveLength(2)
    const types = out.engagers.map((e) => e.type).sort()
    expect(types).toEqual(['comment', 'reaction'])
  })
})

describe('reasoning adapters', () => {
  let prevEnv: Record<string, string | undefined>

  beforeEach(() => {
    prevEnv = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    }
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = prevEnv.ANTHROPIC_API_KEY
    process.env.OPENAI_API_KEY = prevEnv.OPENAI_API_KEY
    vi.restoreAllMocks()
  })

  it('anthropic adapter throws MissingApiKeyError without ANTHROPIC_API_KEY', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { reasoningAnthropicAdapter } = await import('../lib/providers/adapters/reasoning-anthropic')
    await expect(
      reasoningAnthropicAdapter.execute({ prompt: 'hello' }, { executor: null, registry: null as never }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/)
  })

  it('anthropic adapter isAvailable() reflects the env var', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { reasoningAnthropicAdapter } = await import('../lib/providers/adapters/reasoning-anthropic')
    expect(reasoningAnthropicAdapter.isAvailable!()).toBe(false)
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    expect(reasoningAnthropicAdapter.isAvailable!()).toBe(true)
  })

  it('openai adapter throws MissingApiKeyError without OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY
    const { reasoningOpenAIAdapter } = await import('../lib/providers/adapters/reasoning-openai')
    await expect(
      reasoningOpenAIAdapter.execute({ prompt: 'hi' }, { executor: null, registry: null as never }),
    ).rejects.toThrow(/OPENAI_API_KEY/)
  })

  it('openai adapter calls /v1/chat/completions and returns assistant text', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-1234567890'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'hello there' } }] }),
        { status: 200 },
      ),
    )
    const { reasoningOpenAIAdapter } = await import('../lib/providers/adapters/reasoning-openai')
    const out = (await reasoningOpenAIAdapter.execute(
      { prompt: 'hi' },
      { executor: null, registry: null as never },
    )) as { text: string }
    expect(out.text).toBe('hello there')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    fetchSpy.mockRestore()
  })

  it('openai adapter throws on non-200 with status code', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-1234567890'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    )
    const { reasoningOpenAIAdapter } = await import('../lib/providers/adapters/reasoning-openai')
    await expect(
      reasoningOpenAIAdapter.execute({ prompt: 'hi' }, { executor: null, registry: null as never }),
    ).rejects.toThrow(/chat\/completions failed/)
    fetchSpy.mockRestore()
  })
})
