import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SpecStreamProvider } from '../specstream-provider.js'
import type { ExecutionContext, RowBatch, WorkflowStepInput } from '../../types.js'

/**
 * SpecStream provider — routing, search mapping, URL reading and the
 * company_research enrich path. The service is mocked; no network.
 */

// ─── Mocks ────────────────────────────────────────────────────────────
vi.mock('../../../services/specstream', () => ({
  specstreamService: {
    isAvailable: () => true,
    search: vi.fn(),
    scrape: vi.fn(),
  },
}))

const { specstreamService } = await import('../../../services/specstream')

function baseContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    frameworkContext: '',
    batchSize: 10,
    totalRequested: 5,
    ...overrides,
  }
}

function step(overrides: Partial<WorkflowStepInput> = {}): WorkflowStepInput {
  return {
    stepIndex: 0,
    title: 'Research',
    stepType: 'search',
    provider: 'specstream',
    description: 'fintech companies in Paris',
    ...overrides,
  }
}

async function collect(it: AsyncIterable<RowBatch>): Promise<RowBatch[]> {
  const out: RowBatch[] = []
  for await (const batch of it) out.push(batch)
  return out
}

describe('SpecStreamProvider', () => {
  const provider = new SpecStreamProvider()

  beforeEach(() => {
    vi.mocked(specstreamService.search).mockReset()
    vi.mocked(specstreamService.scrape).mockReset()
  })

  it('only claims steps that name it explicitly', () => {
    expect(provider.canExecute(step())).toBe(true)
    expect(provider.canExecute(step({ provider: 'firecrawl' }))).toBe(false)
    expect(provider.canExecute(step({ provider: '' }))).toBe(false)
  })

  it('maps search results onto search columns', async () => {
    vi.mocked(specstreamService.search).mockResolvedValue([
      { url: 'https://acme.example', title: 'Acme', content: 'Acme builds payments software.' },
    ])

    const batches = await collect(provider.execute(step(), baseContext()))

    expect(specstreamService.search).toHaveBeenCalledWith('fintech companies in Paris', 5)
    expect(batches).toHaveLength(1)
    expect(batches[0].rows[0]).toMatchObject({
      company_name: 'Acme',
      website: 'https://acme.example',
      description: 'Acme builds payments software.',
    })
  })

  it('yields an empty batch when search finds nothing', async () => {
    vi.mocked(specstreamService.search).mockResolvedValue([])

    const batches = await collect(provider.execute(step(), baseContext()))

    expect(batches).toEqual([{ rows: [], batchIndex: 0, totalSoFar: 0 }])
  })

  it('reads a URL when config.url is set', async () => {
    vi.mocked(specstreamService.scrape).mockResolvedValue('# Acme\nWe build payments software.')

    const batches = await collect(
      provider.execute(step({ config: { url: 'https://www.acme.example/about' } }), baseContext()),
    )

    expect(specstreamService.scrape).toHaveBeenCalledWith('https://www.acme.example/about')
    expect(batches[0].rows[0]).toMatchObject({
      company_name: 'acme.example',
      website: 'https://www.acme.example/about',
      description: '# Acme\nWe build payments software.',
    })
  })

  it('enriches company_research rows by website, then by name, and skips researched rows', async () => {
    vi.mocked(specstreamService.scrape).mockResolvedValue('Site text')
    vi.mocked(specstreamService.search).mockResolvedValue([
      { url: 'https://beta.example', title: 'Beta', content: 'Beta search text' },
    ])

    const rows = [
      { company_name: 'Acme', website: 'https://acme.example' },
      { company_name: 'Beta' },
      { company_name: 'Gamma', company_description: 'already done' },
    ]
    const batches = await collect(
      provider.execute(
        step({ stepType: 'enrich', config: { enrichmentType: 'company_research' } }),
        baseContext({ previousStepRows: rows }),
      ),
    )

    const out = batches.flatMap((b) => b.rows)
    expect(out[0]).toMatchObject({ company_description: 'Site text', company_research_source: 'https://acme.example' })
    expect(out[1]).toMatchObject({ company_description: 'Beta search text', company_research_source: 'https://beta.example' })
    expect(out[2]).toEqual(rows[2])
    expect(specstreamService.scrape).toHaveBeenCalledTimes(1)
    expect(specstreamService.search).toHaveBeenCalledWith('Beta', 1)
  })

  it('keeps the row unchanged when a lookup fails', async () => {
    vi.mocked(specstreamService.scrape).mockRejectedValue(new Error('SpecStream API error (500): boom'))

    const rows = [{ company_name: 'Acme', website: 'https://acme.example' }]
    const batches = await collect(
      provider.execute(step({ stepType: 'enrich' }), baseContext({ previousStepRows: rows })),
    )

    expect(batches[0].rows[0]).toEqual(rows[0])
  })

  it('adds research columns for company_research steps', () => {
    const keys = provider
      .getColumnDefinitions(step({ config: { enrichmentType: 'company_research' } }))
      .map((c) => c.key)
    expect(keys).toContain('company_description')
    expect(keys).toContain('company_research_source')
  })
})

describe('specstreamService', () => {
  it('sends a bearer GET to /v1/web-search and maps sources', async () => {
    const { specstreamService: real } = await vi.importActual<typeof import('../../../services/specstream')>(
      '../../../services/specstream',
    )
    const prev = process.env.SPECSTREAM_API_KEY
    process.env.SPECSTREAM_API_KEY = 'test-specstream-key'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          sources: [
            { url: 'https://acme.example', title: 'Acme', snippet: 'Payments', published: '2026-01-02' },
            { title: 'no url' },
          ],
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const results = await real.search('acme payments', 10)
      const [calledUrl, init] = fetchMock.mock.calls[0]
      expect(calledUrl).toBe('https://api.specstream.ai/v1/web-search?q=acme+payments')
      expect(init.method).toBe('GET')
      expect(init.headers.Authorization).toBe('Bearer test-specstream-key')
      expect(results).toEqual([
        { url: 'https://acme.example', title: 'Acme', content: 'Payments', published: '2026-01-02' },
      ])
    } finally {
      vi.unstubAllGlobals()
      if (prev === undefined) delete process.env.SPECSTREAM_API_KEY
      else process.env.SPECSTREAM_API_KEY = prev
    }
  })

  it('throws with the API error message on a non-2xx reply', async () => {
    const { specstreamService: real } = await vi.importActual<typeof import('../../../services/specstream')>(
      '../../../services/specstream',
    )
    const prev = process.env.SPECSTREAM_API_KEY
    process.env.SPECSTREAM_API_KEY = 'test-specstream-key'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'invalid key' } }),
    }))
    try {
      await expect(real.scrape('https://acme.example')).rejects.toThrow('SpecStream API error (401): invalid key')
    } finally {
      vi.unstubAllGlobals()
      if (prev === undefined) delete process.env.SPECSTREAM_API_KEY
      else process.env.SPECSTREAM_API_KEY = prev
    }
  })
})
