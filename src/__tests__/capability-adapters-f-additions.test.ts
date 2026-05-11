import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const UNIPILE_ENV = {
  UNIPILE_API_KEY: 'test-unipile-key-1234567890',
  UNIPILE_DSN: 'https://api1.unipile.com:1234',
}

function withEnv(values: Record<string, string | undefined>): () => void {
  const prev: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(values)) {
    prev[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe('linkedin-content-fetch-unipile adapter', () => {
  let restore: () => void
  beforeEach(() => {
    restore = withEnv(UNIPILE_ENV)
  })
  afterEach(() => {
    restore()
    vi.restoreAllMocks()
  })

  it('loads, has the right capability/provider, fetches posts via competitorUrl', async () => {
    const { linkedinContentFetchUnipileAdapter, extractLinkedInSlug } = await import(
      '../lib/providers/adapters/linkedin-content-fetch-unipile'
    )
    expect(linkedinContentFetchUnipileAdapter.capabilityId).toBe('linkedin-content-fetch')
    expect(linkedinContentFetchUnipileAdapter.providerId).toBe('unipile')
    expect(extractLinkedInSlug('https://www.linkedin.com/in/joe-mole/')).toBe('joe-mole')

    const { unipileService } = await import('../lib/services/unipile')
    vi.spyOn(unipileService, 'getProfile').mockResolvedValue({ provider_id: 'urn:li:joe' } as never)
    vi.spyOn(unipileService, 'listUserPosts').mockResolvedValue({
      items: [{ post_id: 'p1', text: 'hello' }],
    } as never)

    const out = (await linkedinContentFetchUnipileAdapter.execute(
      { accountId: 'acct', competitorUrl: 'https://linkedin.com/in/joe-mole', limit: 5 },
      { executor: null, registry: null as never },
    )) as { posts: unknown[]; userId: string }
    expect(out.posts).toHaveLength(1)
    expect(out.userId).toBe('urn:li:joe')
  })
})

describe('linkedin-trending-content-unipile adapter', () => {
  let restore: () => void
  beforeEach(() => { restore = withEnv(UNIPILE_ENV) })
  afterEach(() => { restore(); vi.restoreAllMocks() })

  it('filters posts by minEngagement floor and sorts by engagement total', async () => {
    const { linkedinTrendingContentUnipileAdapter } = await import(
      '../lib/providers/adapters/linkedin-trending-content-unipile'
    )
    expect(linkedinTrendingContentUnipileAdapter.capabilityId).toBe('linkedin-trending-content')

    const { unipileService } = await import('../lib/services/unipile')
    vi.spyOn(unipileService, 'searchLinkedIn').mockResolvedValue([
      { post_id: 'big', text: 'big post', engagement: { likes: 200, comments: 50 } },
      { post_id: 'small', text: 'small post', engagement: { likes: 5, comments: 1 } },
      { post_id: 'medium', text: 'mid post', engagement: { likes: 80, comments: 20 } },
    ])

    const out = (await linkedinTrendingContentUnipileAdapter.execute(
      { accountId: 'acct', keyword: 'gtm', minEngagement: 50 },
      { executor: null, registry: null as never },
    )) as { posts: Array<{ post_id: string }> }
    expect(out.posts.map((p) => p.post_id)).toEqual(['big', 'medium'])
  })
})

describe('linkedin-campaign-create-unipile adapter', () => {
  let restore: () => void
  beforeEach(() => { restore = withEnv(UNIPILE_ENV) })
  afterEach(() => { restore(); vi.restoreAllMocks() })

  it('sends connection requests for every lead and reports successes/failures', async () => {
    const { linkedinCampaignCreateUnipileAdapter } = await import(
      '../lib/providers/adapters/linkedin-campaign-create-unipile'
    )
    expect(linkedinCampaignCreateUnipileAdapter.capabilityId).toBe('linkedin-campaign-create')

    const { unipileService } = await import('../lib/services/unipile')
    let callCount = 0
    vi.spyOn(unipileService, 'sendConnection').mockImplementation(async () => {
      callCount++
      if (callCount === 2) throw new Error('rate limited')
      return { ok: true } as never
    })

    const out = (await linkedinCampaignCreateUnipileAdapter.execute(
      {
        accountId: 'acct',
        campaignName: 'Series A FR',
        leads: [{ provider_id: 'a' }, { provider_id: 'b' }, { provider_id: 'c' }],
        sequence: [
          { kind: 'connection', body: 'Hi {{firstname}}', delay_days: 0 },
          { kind: 'dm', body: 'Following up', delay_days: 2 },
        ],
      },
      { executor: null, registry: null as never },
    )) as { campaignId: string; leadsSucceeded: number; leadsAttempted: number; failures: unknown[]; sequenceLength: number }
    expect(out.campaignId).toMatch(/^linkedin-acct-series-a-fr-/)
    expect(out.leadsAttempted).toBe(3)
    expect(out.leadsSucceeded).toBe(2)
    expect(out.failures).toHaveLength(1)
    expect(out.sequenceLength).toBe(2)
  })
})

describe('email-campaign-create-instantly adapter', () => {
  let restore: () => void
  beforeEach(() => {
    restore = withEnv({ INSTANTLY_API_KEY: 'test-instantly-key' })
  })
  afterEach(() => { restore(); vi.restoreAllMocks() })

  it('creates a campaign, attaches leads, and resumes it', async () => {
    const { emailCampaignCreateInstantlyAdapter } = await import(
      '../lib/providers/adapters/email-campaign-create-instantly'
    )
    expect(emailCampaignCreateInstantlyAdapter.capabilityId).toBe('email-campaign-create')

    const { instantlyService } = await import('../lib/services/instantly')
    vi.spyOn(instantlyService, 'createCampaign').mockResolvedValue({ id: 'camp_1', name: 'Q2', status: 0 } as never)
    const addSpy = vi.spyOn(instantlyService, 'addLeadsToCampaign').mockResolvedValue(undefined as never)
    const resumeSpy = vi.spyOn(instantlyService, 'resumeCampaign').mockResolvedValue(undefined as never)

    const out = (await emailCampaignCreateInstantlyAdapter.execute(
      {
        campaignName: 'Q2',
        leads: [{ email: 'jane@acme.com' }],
        sequence: [{ subject: 'Hi', body: 'Hello {{firstname}}', delay_days: 0 }],
      },
      { executor: null, registry: null as never },
    )) as { campaignId: string; leadsAdded: number; status: string }
    expect(out.campaignId).toBe('camp_1')
    expect(out.leadsAdded).toBe(1)
    expect(out.status).toBe('started')
    expect(addSpy).toHaveBeenCalledOnce()
    expect(resumeSpy).toHaveBeenCalledOnce()
  })
})

describe('asset-rendering-playwright adapter', () => {
  it('writes HTML on disk and falls back gracefully when Playwright is missing for pdf', async () => {
    const { assetRenderingPlaywrightAdapter } = await import(
      '../lib/providers/adapters/asset-rendering-playwright'
    )
    expect(assetRenderingPlaywrightAdapter.capabilityId).toBe('asset-rendering')
    expect(assetRenderingPlaywrightAdapter.providerId).toBe('playwright')

    const out = (await assetRenderingPlaywrightAdapter.execute(
      { content: '<h1>Hello</h1>', filename: 'test-asset.html', format: 'html', title: 'Hi' },
      { executor: null, registry: null as never },
    )) as { rendered: boolean; path: string; format: string }
    expect(out.rendered).toBe(true)
    expect(out.path).toMatch(/test-asset\.html$/)
    expect(out.format).toBe('html')

    // Empty input should produce a useful fallbackReason rather than crashing.
    const empty = (await assetRenderingPlaywrightAdapter.execute(
      { content: '' },
      { executor: null, registry: null as never },
    )) as { rendered: boolean; fallbackReason: string }
    expect(empty.rendered).toBe(false)
    expect(empty.fallbackReason).toMatch(/content/)
  })
})

// landing-page-deploy stub removed in 0.12.0 — replaced by the bundled
// declarative `landing-page-deploy-vercel.yaml` manifest. Stub coverage
// migrated to `src/lib/providers/declarative/__tests__/bundled-adapters.test.ts`.
