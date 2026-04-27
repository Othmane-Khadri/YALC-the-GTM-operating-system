import type { StepExecutor, RowBatch, ExecutionContext, WorkflowStepInput, ProviderCapability, ProviderHealthStatus } from '../types'
import type { ColumnDef } from '../../ai/types'
import { crustdataService } from '../../services/crustdata'
import { loadFramework } from '../../framework/context'
import { InsufficientCreditsError, EarlyStageSkipError } from '../errors'
import { DEFAULT_TENANT } from '../../tenant/index.js'
import { db } from '../../db/index.js'
import { signalsLog } from '../../db/schema'
import { randomUUID } from 'crypto'

const EARLY_STAGES = new Set<string>(['pre-seed', 'seed'])

async function logCrustdataDecision(
  tenantId: string,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(signalsLog).values({
      id: randomUUID(),
      tenantId,
      type,
      category: 'provider',
      data: JSON.stringify(data),
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[crustdata-provider] signals_log write failed (best-effort):', err)
  }
}

/**
 * Credit preflight gate. Throws InsufficientCreditsError if balance
 * is below estimate * 1.5. Matches the credit safeguard rule:
 *   "Mandatory pre-flight: check credits before paid searches."
 */
async function assertCreditsFor(
  tenantId: string,
  operation: string,
  estimate: number,
): Promise<void> {
  const check = await crustdataService.preflight(estimate)
  if (!check.ok) {
    await logCrustdataDecision(tenantId, 'crustdata.credits.blocked', {
      operation,
      balance: check.balance,
      estimate,
      message: check.message,
    })
    throw new InsufficientCreditsError('crustdata', check.balance, Math.ceil(estimate * 1.5))
  }
}

const SEARCH_COLUMNS: ColumnDef[] = [
  { key: 'company_name', label: 'Company Name', type: 'text' },
  { key: 'website', label: 'Website', type: 'url' },
  { key: 'industry', label: 'Industry', type: 'text' },
  { key: 'employee_count', label: 'Employee Count', type: 'number' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'description', label: 'Description', type: 'text' },
  { key: 'funding_stage', label: 'Funding Stage', type: 'badge' },
]

const ENRICH_COLUMNS: ColumnDef[] = [
  ...SEARCH_COLUMNS,
  { key: 'linkedin_url', label: 'LinkedIn URL', type: 'url' },
  { key: 'founded_year', label: 'Founded Year', type: 'number' },
]

const PEOPLE_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'company_name', label: 'Company', type: 'text' },
  { key: 'linkedin_url', label: 'LinkedIn URL', type: 'url' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'seniority', label: 'Seniority', type: 'badge' },
  { key: 'headline', label: 'Headline', type: 'text' },
  { key: 'company_domain', label: 'Company Domain', type: 'text' },
]

export class CrustdataProvider implements StepExecutor {
  id = 'crustdata'
  name = 'Crustdata'
  description = 'Company discovery, screening, and enrichment via Crustdata API'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['search', 'enrich']

  isAvailable(): boolean {
    return crustdataService.isAvailable()
  }

  /**
   * Hits Crustdata's credit-check endpoint — cheapest authenticated call.
   * 401/403 → fail (key invalid). 5xx → warn. Network failure → fail.
   */
  async selfHealthCheck(): Promise<ProviderHealthStatus> {
    if (!process.env.CRUSTDATA_API_KEY) {
      return { status: 'warn', detail: 'CRUSTDATA_API_KEY not set' }
    }
    try {
      const resp = await fetch('https://api.crustdata.com/screener/credit_check/', {
        method: 'GET',
        headers: {
          Authorization: `Token ${process.env.CRUSTDATA_API_KEY}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      })
      if (resp.ok) return { status: 'ok', detail: 'credit_check endpoint reachable' }
      if (resp.status === 401 || resp.status === 403) {
        return { status: 'fail', detail: `auth failed (HTTP ${resp.status})` }
      }
      if (resp.status >= 500) return { status: 'warn', detail: `HTTP ${resp.status}` }
      return { status: 'warn', detail: `HTTP ${resp.status}` }
    } catch (err) {
      return {
        status: 'fail',
        detail: `connection failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  canExecute(step: WorkflowStepInput): boolean {
    if (step.provider === 'crustdata') return true
    const desc = (step.description ?? '').toLowerCase()
    const isLinkedIn = desc.includes('linkedin')
    if (isLinkedIn) return false
    const isPeopleSearch = desc.includes('people') || desc.includes('person') || desc.includes('contact')
    return step.stepType === 'search' || step.stepType === 'enrich' || isPeopleSearch
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const desc = (step.description ?? '').toLowerCase()
    const isPeopleSearch = desc.includes('people') || desc.includes('person') || desc.includes('contact')

    if (isPeopleSearch && step.stepType === 'search') {
      yield* this.executePeopleSearch(step, context)
    } else if (step.stepType === 'search') {
      yield* this.executeSearch(step, context)
    } else if (step.stepType === 'enrich') {
      yield* this.executeEnrich(step, context)
    }
  }

  private async *executeSearch(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const tenantId = context.tenantId ?? DEFAULT_TENANT
    const config = step.config ?? {}
    const limit = context.totalRequested || 50
    // P2.4 credit safeguard — rough cost is 1 credit per company in db search.
    await assertCreditsFor(tenantId, 'searchCompanies', Math.max(limit, 1))

    const results = await crustdataService.searchCompanies({
      industry: config.industry as string | undefined,
      employeeRange: config.employeeRange as string | undefined,
      location: config.location as string | undefined,
      keywords: config.keywords as string | undefined,
      limit,
    })

    const rows = results.map(c => ({
      company_name: c.name,
      website: c.website,
      industry: c.industry,
      employee_count: c.employee_count,
      location: c.location,
      description: c.description,
      funding_stage: c.funding_stage,
    }))

    // Yield in batches
    const batchSize = context.batchSize || 25
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      yield {
        rows: batch,
        batchIndex: Math.floor(i / batchSize),
        totalSoFar: Math.min(i + batchSize, rows.length),
      }
    }
  }

  private async *executePeopleSearch(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const tenantId = context.tenantId ?? DEFAULT_TENANT
    const config = step.config ?? {}
    const limit = context.totalRequested || 100

    // P2.4 early-stage skip — if the tenant framework targets pre-seed/seed
    // companies, Crustdata's people_search_db has very thin coverage and
    // burns credits for near-zero yield. Best practice:
    //   "skip Crustdata people_search_db for early-stage startups; use
    //    Unipile profile lookup when LinkedIn slugs known."
    const framework = await loadFramework(tenantId)
    if (framework) {
      const earlyStages: string[] = []
      for (const seg of framework.segments ?? []) {
        for (const s of seg.targetCompanyStages ?? []) {
          if (EARLY_STAGES.has(s)) earlyStages.push(s)
        }
      }
      if (earlyStages.length > 0) {
        await logCrustdataDecision(tenantId, 'crustdata.people_search.skipped.early_stage', {
          stages: earlyStages,
          routeTo: 'unipile',
          config,
        })
        // eslint-disable-next-line no-console
        console.warn(
          `[crustdata-provider] Early-stage segment detected (${earlyStages.join(', ')}). Skipping people_search_db — route to Unipile profile lookup instead.`,
        )
        throw new EarlyStageSkipError('crustdata', 'unipile', earlyStages)
      }
    }

    // Credit preflight — people_search_db charges roughly 3 credits per 100 results.
    const estimate = Math.max(Math.ceil((limit / 100) * 3), 1)
    await assertCreditsFor(tenantId, 'searchPeople', estimate)

    const tracked = await crustdataService.searchPeople({
      companyNames: config.companyNames as string[] | undefined,
      titles: config.titles as string[] | undefined,
      seniorityLevels: config.seniorityLevels as string[] | undefined,
      location: config.location as string | undefined,
      limit,
    })

    const rows = tracked.result.people.map(p => ({
      name: p.name,
      title: p.title,
      company_name: p.company_name,
      company_domain: p.company_domain,
      linkedin_url: p.linkedin_url,
      location: p.location,
      seniority: p.seniority,
      headline: p.headline,
    }))

    const batchSize = context.batchSize || 25
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      yield {
        rows: batch,
        batchIndex: Math.floor(i / batchSize),
        totalSoFar: Math.min(i + batchSize, rows.length),
      }
    }
  }

  private async *executeEnrich(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const tenantId = context.tenantId ?? DEFAULT_TENANT
    const inputRows = context.previousStepRows ?? []

    // P2.4 credit preflight — enrich charges ~1-4 credits/company depending on fields.
    if (inputRows.length > 0) {
      const estimate = Math.max(inputRows.length * 2, 1)
      await assertCreditsFor(tenantId, 'enrichCompany', estimate)
    }

    const enrichedRows: Record<string, unknown>[] = []

    for (const row of inputRows) {
      const website = String(row.website ?? row.domain ?? '')
      if (!website) {
        enrichedRows.push(row)
        continue
      }

      try {
        const domain = website.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
        const enriched = await crustdataService.enrichCompany(domain)
        enrichedRows.push({
          ...row,
          company_name: enriched.name || row.company_name,
          industry: enriched.industry || row.industry,
          employee_count: enriched.employee_count || row.employee_count,
          location: enriched.location || row.location,
          description: enriched.description || row.description,
          funding_stage: enriched.funding_stage || row.funding_stage,
          linkedin_url: enriched.linkedin_url || row.linkedin_url,
          founded_year: enriched.founded_year || row.founded_year,
        })
      } catch {
        enrichedRows.push(row)
      }
    }

    const batchSize = context.batchSize || 25
    for (let i = 0; i < enrichedRows.length; i += batchSize) {
      const batch = enrichedRows.slice(i, i + batchSize)
      yield {
        rows: batch,
        batchIndex: Math.floor(i / batchSize),
        totalSoFar: Math.min(i + batchSize, enrichedRows.length),
      }
    }
  }

  getColumnDefinitions(step: WorkflowStepInput): ColumnDef[] {
    const desc = (step.description ?? '').toLowerCase()
    const isPeople = desc.includes('people') || desc.includes('person') || desc.includes('contact')
    if (isPeople) return PEOPLE_COLUMNS
    return step.stepType === 'enrich' ? ENRICH_COLUMNS : SEARCH_COLUMNS
  }
}
