import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  UnipileProvider,
  extractVerifiedFields,
  resolveReadAccountId,
  normalizeSectionsConfig,
} from '../unipile-provider.js'
import type { ExecutionContext, WorkflowStepInput } from '../../types.js'

// ─── Mocks ────────────────────────────────────────────────────────────
vi.mock('../../../services/unipile', () => ({
  unipileService: {
    isAvailable: () => true,
    getAccounts: vi.fn(),
    getProfile: vi.fn(),
    searchLinkedIn: vi.fn(),
    sendConnection: vi.fn(),
    sendMessage: vi.fn(),
  },
}))

const { unipileService } = await import('../../../services/unipile')

// ─── Helpers ──────────────────────────────────────────────────────────
function baseContext(rows: Array<Record<string, unknown>>): ExecutionContext {
  return {
    frameworkContext: '',
    batchSize: 25,
    totalRequested: rows.length,
    previousStepRows: rows,
  }
}

function enrichStep(config?: Record<string, unknown>): WorkflowStepInput {
  return {
    stepIndex: 0,
    title: 'Enrich LinkedIn',
    stepType: 'enrich',
    provider: 'unipile',
    description: 'Enrich profiles via Unipile',
    config: config ?? {},
  }
}

async function drainAll(it: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const batch of it) out.push(batch)
  return out
}

// ─── extractVerifiedFields ────────────────────────────────────────────
describe('extractVerifiedFields', () => {
  it('extracts primary active role from work_experience (first active is primary)', () => {
    const profile = {
      headline: 'CRO at HeadcountHQ',
      work_experience: [
        // First active role — should be primary
        {
          position: 'Chief Revenue Officer',
          company: 'HeadcountHQ',
          industry: 'HR Software',
          start: '2024-03-01',
        },
        // Second active role — board seat / advisor
        {
          position: 'Board Advisor',
          company: 'StartupX',
          industry: 'SaaS',
          start: '2023-06-01',
        },
        // Ended role — prior company
        {
          position: 'VP Sales',
          company: 'OldCo',
          industry: 'HRIS',
          start: '2020-01-01',
          end: '2024-02-28',
        },
      ],
    }

    const v = extractVerifiedFields(profile, { experience: true })
    expect(v.headline).toBe('CRO at HeadcountHQ')
    expect(v.primary_company).toBe('HeadcountHQ')
    expect(v.primary_position).toBe('Chief Revenue Officer')
    expect(v.primary_company_industry).toBe('HR Software')
    expect(v.current_role_start_date).toBe('2024-03-01')
    expect(v.all_active_roles).toEqual([
      { position: 'Chief Revenue Officer', company: 'HeadcountHQ' },
      { position: 'Board Advisor', company: 'StartupX' },
    ])
    expect(v.throttled).toBe(false)
  })

  it('populates prior_companies from non-primary work_experience entries', () => {
    const profile = {
      headline: 'CEO at Acme',
      work_experience: [
        { position: 'CEO', company: 'Acme', industry: 'SaaS', start: '2024-01-01' }, // primary
        { position: 'VP', company: 'OldCo1', start: '2020', end: '2023' },
        { position: 'Director', company: 'OldCo2', start: '2018', end: '2020' },
        // entry with no company string — should be filtered out
        { position: 'Founder', start: '2017', end: '2018' },
      ],
    }
    const v = extractVerifiedFields(profile, { experience: true })
    expect(v.prior_companies).toEqual(['OldCo1', 'OldCo2'])
  })

  it('marks throttled=true when sections=experience requested but work_experience is empty', () => {
    const profile = { headline: 'Some Person', work_experience: [] }
    const v = extractVerifiedFields(profile, { experience: true })
    expect(v.throttled).toBe(true)
    expect(v.primary_company).toBeNull()
    expect(v.primary_position).toBeNull()
  })

  it('marks throttled=true when work_experience field is missing entirely', () => {
    const profile = { headline: 'Some Person' }
    const v = extractVerifiedFields(profile, { experience: true })
    expect(v.throttled).toBe(true)
    expect(v.prior_companies).toEqual([])
    expect(v.all_active_roles).toEqual([])
  })

  it('marks throttled=false when work_experience is present (even sparse)', () => {
    const profile = {
      headline: 'X',
      work_experience: [{ position: 'CEO', company: 'Acme' }],
    }
    const v = extractVerifiedFields(profile, { experience: true })
    expect(v.throttled).toBe(false)
  })

  it('marks throttled=false when sections=experience NOT requested even if work_experience empty', () => {
    const profile = { work_experience: [] }
    const v = extractVerifiedFields(profile, { experience: false })
    expect(v.throttled).toBe(false)
  })

  it('handles malformed profile (null) — returns sensible defaults', () => {
    const v = extractVerifiedFields(null, { experience: true })
    expect(v.headline).toBeNull()
    expect(v.primary_company).toBeNull()
    expect(v.primary_position).toBeNull()
    expect(v.primary_company_industry).toBeNull()
    expect(v.prior_companies).toEqual([])
    expect(v.current_role_start_date).toBeNull()
    expect(v.all_active_roles).toEqual([])
    expect(v.throttled).toBe(true) // experience requested + no data
  })

  it('handles malformed profile (undefined) — returns sensible defaults', () => {
    const v = extractVerifiedFields(undefined, { experience: false })
    expect(v.headline).toBeNull()
    expect(v.throttled).toBe(false)
  })

  it('handles malformed profile (non-object string) — returns sensible defaults', () => {
    const v = extractVerifiedFields('not-a-profile', { experience: false })
    expect(v.headline).toBeNull()
    expect(v.throttled).toBe(false)
  })
})

// ─── normalizeSectionsConfig ──────────────────────────────────────────
describe('normalizeSectionsConfig', () => {
  it('returns [] for undefined', () => {
    expect(normalizeSectionsConfig(undefined)).toEqual([])
  })
  it('wraps string in array', () => {
    expect(normalizeSectionsConfig('experience')).toEqual(['experience'])
  })
  it('passes array through', () => {
    expect(normalizeSectionsConfig(['experience', 'education'])).toEqual(['experience', 'education'])
  })
  it('expands "*" to all sections', () => {
    const all = normalizeSectionsConfig('*')
    expect(all).toContain('experience')
    expect(all).toContain('education')
    expect(all).toContain('languages')
    expect(all).toContain('skills')
    expect(all).toContain('certifications')
    expect(all).toContain('about')
  })
})

// ─── Account routing ──────────────────────────────────────────────────
describe('resolveReadAccountId — account routing', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env.UNIPILE_READ_ACCOUNT_ID
    delete process.env.UNIPILE_READ_ACCOUNT_ID
    vi.mocked(unipileService.getAccounts).mockReset()
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.UNIPILE_READ_ACCOUNT_ID
    } else {
      process.env.UNIPILE_READ_ACCOUNT_ID = originalEnv
    }
  })

  it('prefers UNIPILE_READ_ACCOUNT_ID env over getAccounts()[0]', async () => {
    process.env.UNIPILE_READ_ACCOUNT_ID = 'doug-id'
    vi.mocked(unipileService.getAccounts).mockResolvedValue({
      items: [{ id: 'first-id' }],
    } as any)

    const id = await resolveReadAccountId()
    expect(id).toBe('doug-id')
    // env wins; getAccounts may or may not be called — but should NOT determine result
  })

  it('falls back to getAccounts()[0] when env unset', async () => {
    vi.mocked(unipileService.getAccounts).mockResolvedValue({
      items: [{ id: 'first-id' }, { id: 'second-id' }],
    } as any)

    const id = await resolveReadAccountId()
    expect(id).toBe('first-id')
  })

  it('throws when env unset and no accounts connected', async () => {
    vi.mocked(unipileService.getAccounts).mockResolvedValue({ items: [] } as any)
    await expect(resolveReadAccountId()).rejects.toThrow(/No LinkedIn account connected/)
  })
})

// ─── Sections plumbing through enrich step ────────────────────────────
describe('UnipileProvider enrich — sections plumbing + verified extraction', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env.UNIPILE_READ_ACCOUNT_ID
    delete process.env.UNIPILE_READ_ACCOUNT_ID
    vi.mocked(unipileService.getAccounts).mockReset()
    vi.mocked(unipileService.getProfile).mockReset()
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.UNIPILE_READ_ACCOUNT_ID
    } else {
      process.env.UNIPILE_READ_ACCOUNT_ID = originalEnv
    }
  })

  it('passes sections=experience through to getProfile when configured', async () => {
    vi.mocked(unipileService.getAccounts).mockResolvedValue({
      items: [{ id: 'first-id' }],
    } as any)
    vi.mocked(unipileService.getProfile).mockResolvedValue({
      headline: 'CEO at Acme',
      work_experience: [{ position: 'CEO', company: 'Acme', start: '2024-01-01' }],
    } as any)

    const provider = new UnipileProvider()
    const ctx = baseContext([{ linkedin_url: 'https://linkedin.com/in/jane-doe' }])
    const step = enrichStep({ sections: 'experience' })

    await drainAll(provider.execute(step, ctx))

    expect(unipileService.getProfile).toHaveBeenCalledOnce()
    const call = vi.mocked(unipileService.getProfile).mock.calls[0]
    expect(call[0]).toBe('first-id')
    expect(call[1]).toBe('https://linkedin.com/in/jane-doe')
    expect(call[2]).toBe('experience')
  })

  it('omits sections argument when no sections configured (backward compat)', async () => {
    vi.mocked(unipileService.getAccounts).mockResolvedValue({
      items: [{ id: 'first-id' }],
    } as any)
    vi.mocked(unipileService.getProfile).mockResolvedValue({} as any)

    const provider = new UnipileProvider()
    const ctx = baseContext([{ linkedin_url: 'https://linkedin.com/in/jane-doe' }])
    const step = enrichStep() // no sections

    await drainAll(provider.execute(step, ctx))

    expect(unipileService.getProfile).toHaveBeenCalledOnce()
    const call = vi.mocked(unipileService.getProfile).mock.calls[0]
    expect(call.length).toBe(2) // accountId + url, no third arg
    expect(call[0]).toBe('first-id')
    expect(call[1]).toBe('https://linkedin.com/in/jane-doe')
  })

  it('uses UNIPILE_READ_ACCOUNT_ID env for enrich account when set', async () => {
    process.env.UNIPILE_READ_ACCOUNT_ID = 'doug-id'
    vi.mocked(unipileService.getAccounts).mockResolvedValue({
      items: [{ id: 'first-id' }],
    } as any)
    vi.mocked(unipileService.getProfile).mockResolvedValue({} as any)

    const provider = new UnipileProvider()
    const ctx = baseContext([{ linkedin_url: 'https://linkedin.com/in/jane' }])

    await drainAll(provider.execute(enrichStep(), ctx))

    expect(unipileService.getProfile).toHaveBeenCalledWith(
      'doug-id',
      'https://linkedin.com/in/jane',
    )
  })

  it('falls back to getAccounts()[0] for enrich when env unset', async () => {
    vi.mocked(unipileService.getAccounts).mockResolvedValue({
      items: [{ id: 'first-id' }],
    } as any)
    vi.mocked(unipileService.getProfile).mockResolvedValue({} as any)

    const provider = new UnipileProvider()
    const ctx = baseContext([{ linkedin_url: 'https://linkedin.com/in/jane' }])

    await drainAll(provider.execute(enrichStep(), ctx))

    expect(unipileService.getProfile).toHaveBeenCalledWith(
      'first-id',
      'https://linkedin.com/in/jane',
    )
  })

  it('attaches verified field to row when sections=experience requested', async () => {
    vi.mocked(unipileService.getAccounts).mockResolvedValue({
      items: [{ id: 'first-id' }],
    } as any)
    vi.mocked(unipileService.getProfile).mockResolvedValue({
      headline: 'CRO at HeadcountHQ',
      work_experience: [
        {
          position: 'Chief Revenue Officer',
          company: 'HeadcountHQ',
          industry: 'HR Software',
          start: '2024-03-01',
        },
      ],
    } as any)

    const provider = new UnipileProvider()
    const ctx = baseContext([{ linkedin_url: 'https://linkedin.com/in/x' }])
    const batches = await drainAll(provider.execute(enrichStep({ sections: 'experience' }), ctx))

    const firstBatch = batches[0] as { rows: Array<Record<string, unknown>> }
    expect(firstBatch.rows.length).toBe(1)
    const row = firstBatch.rows[0]
    expect(row.verified).toBeDefined()
    const verified = row.verified as Record<string, unknown>
    expect(verified.primary_company).toBe('HeadcountHQ')
    expect(verified.primary_position).toBe('Chief Revenue Officer')
    expect(verified.throttled).toBe(false)
  })

  it('does NOT attach verified field when sections not requested (backward compat)', async () => {
    vi.mocked(unipileService.getAccounts).mockResolvedValue({
      items: [{ id: 'first-id' }],
    } as any)
    vi.mocked(unipileService.getProfile).mockResolvedValue({
      headline: 'X',
      work_experience: [{ position: 'CEO', company: 'Acme' }],
    } as any)

    const provider = new UnipileProvider()
    const ctx = baseContext([{ linkedin_url: 'https://linkedin.com/in/x' }])
    const batches = await drainAll(provider.execute(enrichStep(), ctx))

    const firstBatch = batches[0] as { rows: Array<Record<string, unknown>> }
    const row = firstBatch.rows[0]
    expect(row.verified).toBeUndefined()
  })

  it('attaches verified with throttled=true when work_experience empty despite sections requested', async () => {
    vi.mocked(unipileService.getAccounts).mockResolvedValue({
      items: [{ id: 'first-id' }],
    } as any)
    vi.mocked(unipileService.getProfile).mockResolvedValue({
      headline: 'Maybe rate-limited',
      work_experience: [],
    } as any)

    const provider = new UnipileProvider()
    const ctx = baseContext([{ linkedin_url: 'https://linkedin.com/in/y' }])
    const batches = await drainAll(provider.execute(enrichStep({ sections: 'experience' }), ctx))

    const firstBatch = batches[0] as { rows: Array<Record<string, unknown>> }
    const row = firstBatch.rows[0]
    const verified = row.verified as Record<string, unknown>
    expect(verified.throttled).toBe(true)
    expect(verified.primary_company).toBeNull()
  })
})
