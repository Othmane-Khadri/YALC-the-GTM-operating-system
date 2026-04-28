import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Adapter unit tests for the seven capabilities added in 0.8.C.
// Same shape as src/__tests__/capability-adapters.test.ts (0.8.B).

describe('funding-feed crustdata adapter', () => {
  const prev = { CRUSTDATA_API_KEY: process.env.CRUSTDATA_API_KEY }
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    process.env.CRUSTDATA_API_KEY = prev.CRUSTDATA_API_KEY
    vi.restoreAllMocks()
  })

  it('throws MissingApiKeyError without CRUSTDATA_API_KEY', async () => {
    delete process.env.CRUSTDATA_API_KEY
    const { fundingFeedCrustdataAdapter } = await import(
      '../lib/providers/adapters/funding-feed-crustdata'
    )
    await expect(
      fundingFeedCrustdataAdapter.execute({}, { executor: null, registry: null as never }),
    ).rejects.toThrow(/CRUSTDATA_API_KEY/)
  })

  it('single-company mode returns a delta against the baseline', async () => {
    process.env.CRUSTDATA_API_KEY = 'test-key-1234567890123456789012345'
    const { crustdataService } = await import('../lib/services/crustdata')
    vi.spyOn(crustdataService, 'enrichCompany').mockResolvedValue({
      name: 'Acme',
      website: 'acme.com',
      industry: 'SaaS',
      employee_count: 100,
      location: 'US',
      description: 'Test',
      funding_stage: 'Series B',
      // The adapter reads `total_funding_usd` off the raw record.
      total_funding_usd: 25_000_000,
    } as unknown as Awaited<ReturnType<typeof crustdataService.enrichCompany>>)
    const { fundingFeedCrustdataAdapter } = await import(
      '../lib/providers/adapters/funding-feed-crustdata'
    )
    const out = (await fundingFeedCrustdataAdapter.execute(
      { companyDomain: 'acme.com', baselineFundingTotal: 10_000_000 },
      { executor: null, registry: null as never },
    )) as { changed: boolean; data: { delta: number } }
    expect(out.changed).toBe(true)
    expect(out.data.delta).toBe(15_000_000)
  })
})

describe('hiring-signal crustdata adapter', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('fires when delta exceeds threshold', async () => {
    process.env.CRUSTDATA_API_KEY = 'test-key-1234567890123456789012345'
    const { crustdataService } = await import('../lib/services/crustdata')
    vi.spyOn(crustdataService, 'enrichCompany').mockResolvedValue({
      name: 'Acme',
      website: 'acme.com',
      industry: 'SaaS',
      employee_count: 100,
      location: 'US',
      description: 'Test',
      funding_stage: 'Series A',
      job_postings_count: 23,
    } as unknown as Awaited<ReturnType<typeof crustdataService.enrichCompany>>)
    const { hiringSignalCrustdataAdapter } = await import(
      '../lib/providers/adapters/hiring-signal-crustdata'
    )
    const out = (await hiringSignalCrustdataAdapter.execute(
      { companyDomain: 'acme.com', baselineJobCount: 8, threshold: 5 },
      { executor: null, registry: null as never },
    )) as { changed: boolean; data: { delta: number } }
    expect(out.changed).toBe(true)
    expect(out.data.delta).toBe(15)
  })
})

describe('person-job-change-signal crustdata adapter', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('throws when personLinkedinUrl is missing', async () => {
    process.env.CRUSTDATA_API_KEY = 'test-key-1234567890123456789012345'
    const { personJobChangeSignalCrustdataAdapter } = await import(
      '../lib/providers/adapters/person-job-change-signal-crustdata'
    )
    await expect(
      personJobChangeSignalCrustdataAdapter.execute(
        { baselineTitle: 'VP', baselineCompany: 'Acme' },
        { executor: null, registry: null as never },
      ),
    ).rejects.toThrow(/personLinkedinUrl/)
  })
})

describe('news-feed firecrawl adapter', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('returns ranked news items', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-key-1234567890123456789012345'
    const { firecrawlService } = await import('../lib/services/firecrawl')
    vi.spyOn(firecrawlService, 'search').mockResolvedValue([
      { url: 'https://acme.com/blog/launch', title: 'Acme launches X', content: 'snippet body content here' },
      { url: 'https://acme.com/blog/series-b', title: 'Acme Series B', content: 'series b raise' },
    ])
    const { newsFeedFirecrawlAdapter } = await import(
      '../lib/providers/adapters/news-feed-firecrawl'
    )
    const out = (await newsFeedFirecrawlAdapter.execute(
      { companyDomain: 'acme.com', limit: 5 },
      { executor: null, registry: null as never },
    )) as { items: Array<{ url: string }> }
    expect(out.items).toHaveLength(2)
    expect(out.items[0].url).toContain('acme.com')
  })
})

describe('web-fetch firecrawl adapter', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('single-URL mode returns extracted markdown', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-key-1234567890123456789012345'
    const { firecrawlService } = await import('../lib/services/firecrawl')
    vi.spyOn(firecrawlService, 'scrape').mockResolvedValue('# Acme\n\nWelcome to Acme.')
    const { webFetchFirecrawlAdapter } = await import(
      '../lib/providers/adapters/web-fetch-firecrawl'
    )
    const out = (await webFetchFirecrawlAdapter.execute(
      { url: 'https://acme.com' },
      { executor: null, registry: null as never },
    )) as { url: string; markdown: string }
    expect(out.url).toBe('https://acme.com')
    expect(out.markdown).toMatch(/Acme/)
  })

  it('search mode returns ranked results', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-key-1234567890123456789012345'
    const { firecrawlService } = await import('../lib/services/firecrawl')
    vi.spyOn(firecrawlService, 'search').mockResolvedValue([
      { url: 'https://reddit.com/r/saas/x', title: 'Title X', content: 'body x'.repeat(100) },
    ])
    const { webFetchFirecrawlAdapter } = await import(
      '../lib/providers/adapters/web-fetch-firecrawl'
    )
    const out = (await webFetchFirecrawlAdapter.execute(
      { query: 'saas onboarding pain points', limit: 1 },
      { executor: null, registry: null as never },
    )) as { results: Array<{ snippet: string }> }
    expect(out.results).toHaveLength(1)
    expect(out.results[0].snippet.length).toBeLessThanOrEqual(1000)
  })

  it('throws when neither url nor query is provided', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-key-1234567890123456789012345'
    const { webFetchFirecrawlAdapter } = await import(
      '../lib/providers/adapters/web-fetch-firecrawl'
    )
    await expect(
      webFetchFirecrawlAdapter.execute({}, { executor: null, registry: null as never }),
    ).rejects.toThrow(/url.*or.*query/)
  })
})

describe('inbox-replies-fetch instantly adapter', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('throws without INSTANTLY_API_KEY', async () => {
    delete process.env.INSTANTLY_API_KEY
    const { inboxRepliesFetchInstantlyAdapter } = await import(
      '../lib/providers/adapters/inbox-replies-fetch-instantly'
    )
    await expect(
      inboxRepliesFetchInstantlyAdapter.execute(
        { lookbackHours: 24 },
        { executor: null, registry: null as never },
      ),
    ).rejects.toThrow(/INSTANTLY_API_KEY/)
  })

  it('returns replies from the unibox endpoint', async () => {
    process.env.INSTANTLY_API_KEY = 'test-key-1234567890123456789012345'
    const { instantlyService } = await import('../lib/services/instantly')
    vi.spyOn(instantlyService, 'listInboxReplies').mockResolvedValue([
      { id: 'r1', from_email: 'jane@acme.com', subject: 'Re: hi' },
    ])
    const { inboxRepliesFetchInstantlyAdapter } = await import(
      '../lib/providers/adapters/inbox-replies-fetch-instantly'
    )
    const out = (await inboxRepliesFetchInstantlyAdapter.execute(
      { lookbackHours: 24 },
      { executor: null, registry: null as never },
    )) as { replies: Array<{ id?: string }> }
    expect(out.replies).toHaveLength(1)
    expect(out.replies[0].id).toBe('r1')
  })
})

describe('linkedin-user-posts-fetch unipile adapter', () => {
  const prev = { UNIPILE_API_KEY: process.env.UNIPILE_API_KEY, UNIPILE_DSN: process.env.UNIPILE_DSN }
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => {
    process.env.UNIPILE_API_KEY = prev.UNIPILE_API_KEY
    process.env.UNIPILE_DSN = prev.UNIPILE_DSN
    vi.restoreAllMocks()
  })

  it('throws without UNIPILE_API_KEY/DSN', async () => {
    delete process.env.UNIPILE_API_KEY
    delete process.env.UNIPILE_DSN
    const { linkedinUserPostsFetchUnipileAdapter } = await import(
      '../lib/providers/adapters/linkedin-user-posts-fetch-unipile'
    )
    await expect(
      linkedinUserPostsFetchUnipileAdapter.execute(
        { accountId: 'a1' },
        { executor: null, registry: null as never },
      ),
    ).rejects.toThrow(/UNIPILE_API_KEY/)
  })

  it('returns posts from listUserPosts', async () => {
    process.env.UNIPILE_API_KEY = 'test-key-1234567890'
    process.env.UNIPILE_DSN = 'https://api1.unipile.com:1234'
    const { unipileService } = await import('../lib/services/unipile')
    vi.spyOn(unipileService, 'listUserPosts').mockResolvedValue({
      items: [{ id: 'post-1', text: 'hello' }],
      cursor: null,
    } as unknown as ReturnType<typeof unipileService.listUserPosts>)
    const { linkedinUserPostsFetchUnipileAdapter } = await import(
      '../lib/providers/adapters/linkedin-user-posts-fetch-unipile'
    )
    const out = (await linkedinUserPostsFetchUnipileAdapter.execute(
      { accountId: 'a1', limit: 5 },
      { executor: null, registry: null as never },
    )) as { posts: Array<{ id?: string }> }
    expect(out.posts).toHaveLength(1)
    expect(out.posts[0].id).toBe('post-1')
  })
})
