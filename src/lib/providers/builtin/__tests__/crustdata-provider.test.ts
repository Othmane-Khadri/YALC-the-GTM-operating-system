import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CrustdataProvider } from '../crustdata-provider.js'
import { InsufficientCreditsError, EarlyStageSkipError } from '../../errors.js'
import type { ExecutionContext, WorkflowStepInput } from '../../types.js'

/**
 * Phase 2 / P2.4 — Crustdata provider safeguards.
 *
 * Covers:
 *   1. executePeopleSearch throws EarlyStageSkipError when the tenant
 *      framework targets pre-seed/seed segments.
 *   2. executeSearch throws InsufficientCreditsError when preflight fails.
 *   3. executeEnrich throws InsufficientCreditsError when preflight fails.
 *   4. executePeopleSearch runs normally when framework does not target
 *      early stages and credits are sufficient.
 */

// ─── Mocks ────────────────────────────────────────────────────────────
vi.mock('@/lib/services/crustdata', () => ({
  crustdataService: {
    isAvailable: () => true,
    preflight: vi.fn(),
    searchCompanies: vi.fn(),
    enrichCompany: vi.fn(),
    searchPeople: vi.fn(),
  },
}))
vi.mock('@/lib/framework/context', () => ({
  loadFramework: vi.fn(),
}))

const { crustdataService } = await import('@/lib/services/crustdata')
const { loadFramework } = await import('@/lib/framework/context')

function baseContext(tenantId = 'p24-test'): ExecutionContext {
  return {
    frameworkContext: '',
    batchSize: 25,
    totalRequested: 10,
    tenantId,
  }
}

function peopleStep(): WorkflowStepInput {
  return {
    stepIndex: 0,
    title: 'Find people',
    stepType: 'search',
    provider: 'crustdata',
    description: 'Find people at target companies',
    config: { titles: ['CEO'], companyNames: ['Acme'] },
  }
}

function companyStep(): WorkflowStepInput {
  return {
    stepIndex: 0,
    title: 'Find companies',
    stepType: 'search',
    provider: 'crustdata',
    description: 'Search companies in fintech',
    config: { industry: 'fintech' },
  }
}

async function drainFirstBatch(it: AsyncIterable<unknown>): Promise<unknown> {
  for await (const batch of it) return batch
  return null
}

describe('CrustdataProvider P2.4 safeguards', () => {
  const provider = new CrustdataProvider()

  beforeEach(() => {
    vi.mocked(crustdataService.preflight).mockReset()
    vi.mocked(crustdataService.searchCompanies).mockReset()
    vi.mocked(crustdataService.enrichCompany).mockReset()
    vi.mocked(crustdataService.searchPeople).mockReset()
    vi.mocked(loadFramework).mockReset()
  })

  it('skips people_search_db when framework targets pre-seed/seed segments', async () => {
    vi.mocked(loadFramework).mockResolvedValue({
      segments: [
        {
          id: 'seg-1',
          name: 'Early stage',
          description: 'pre-seed startups',
          priority: 'primary',
          targetRoles: ['CEO'],
          targetCompanySizes: ['1-10'],
          targetIndustries: ['fintech'],
          targetCompanyStages: ['pre-seed', 'seed'],
          keyDecisionMakers: [],
          painPoints: [],
          buyingTriggers: [],
          disqualifiers: [],
          voice: {} as any,
          messaging: {} as any,
          contentStrategy: {} as any,
        },
      ],
    } as any)

    const ctx = baseContext()
    await expect(async () => {
      const it = provider['executePeopleSearch'](peopleStep(), ctx)
      await drainFirstBatch(it)
    }).rejects.toThrow(EarlyStageSkipError)

    // searchPeople must NOT have been called — we short-circuited.
    expect(crustdataService.searchPeople).not.toHaveBeenCalled()
  })

  it('runs people_search_db normally when framework does not target early stages', async () => {
    vi.mocked(loadFramework).mockResolvedValue({
      segments: [
        {
          id: 'seg-growth',
          name: 'Growth',
          description: 'series-b+ enterprises',
          priority: 'primary',
          targetRoles: ['VP Eng'],
          targetCompanySizes: ['200+'],
          targetIndustries: ['fintech'],
          targetCompanyStages: ['series-b', 'growth'],
          keyDecisionMakers: [],
          painPoints: [],
          buyingTriggers: [],
          disqualifiers: [],
          voice: {} as any,
          messaging: {} as any,
          contentStrategy: {} as any,
        },
      ],
    } as any)
    vi.mocked(crustdataService.preflight).mockResolvedValue({
      ok: true,
      balance: 500,
      message: 'ok',
    })
    vi.mocked(crustdataService.searchPeople).mockResolvedValue({
      result: { people: [{ name: 'Jane', title: 'VP Eng', company_name: 'BigCo' }] },
      actualCost: 3,
      balanceBefore: 500,
      balanceAfter: 497,
    } as any)

    const it = provider['executePeopleSearch'](peopleStep(), baseContext())
    const batch: any = await drainFirstBatch(it)
    expect(batch).toBeDefined()
    expect(batch.rows).toHaveLength(1)
    expect(crustdataService.searchPeople).toHaveBeenCalledOnce()
  })

  it('throws InsufficientCreditsError when executeSearch preflight fails', async () => {
    vi.mocked(crustdataService.preflight).mockResolvedValue({
      ok: false,
      balance: 5,
      message: 'Insufficient credits: need ~50 (with 1.5x margin = 75) but only 5 available',
    })

    await expect(async () => {
      const it = provider['executeSearch'](companyStep(), baseContext())
      await drainFirstBatch(it)
    }).rejects.toThrow(InsufficientCreditsError)

    expect(crustdataService.searchCompanies).not.toHaveBeenCalled()
  })

  it('throws InsufficientCreditsError when executeEnrich preflight fails', async () => {
    vi.mocked(crustdataService.preflight).mockResolvedValue({
      ok: false,
      balance: 1,
      message: 'Insufficient credits',
    })

    const ctx: ExecutionContext = {
      ...baseContext(),
      previousStepRows: [{ website: 'https://acme.com' }],
    }
    const enrichStep: WorkflowStepInput = {
      stepIndex: 0,
      title: 'Enrich',
      stepType: 'enrich',
      provider: 'crustdata',
      description: 'enrich company',
    }

    await expect(async () => {
      const it = provider['executeEnrich'](enrichStep, ctx)
      await drainFirstBatch(it)
    }).rejects.toThrow(InsufficientCreditsError)

    expect(crustdataService.enrichCompany).not.toHaveBeenCalled()
  })
})
