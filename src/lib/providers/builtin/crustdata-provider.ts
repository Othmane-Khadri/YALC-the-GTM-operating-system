import type { StepExecutor, RowBatch, ExecutionContext, WorkflowStepInput, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'
import { crustdataService } from '@/lib/services/crustdata'

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

export class CrustdataProvider implements StepExecutor {
  id = 'crustdata'
  name = 'Crustdata'
  description = 'Company discovery, screening, and enrichment via Crustdata API'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['search', 'enrich']

  isAvailable(): boolean {
    return crustdataService.isAvailable()
  }

  canExecute(step: WorkflowStepInput): boolean {
    if (step.provider === 'crustdata') return true
    // Claim search/enrich steps that don't mention LinkedIn
    const desc = (step.description ?? '').toLowerCase()
    const isLinkedIn = desc.includes('linkedin')
    return !isLinkedIn && (step.stepType === 'search' || step.stepType === 'enrich')
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    if (step.stepType === 'search') {
      yield* this.executeSearch(step, context)
    } else if (step.stepType === 'enrich') {
      yield* this.executeEnrich(step, context)
    }
  }

  private async *executeSearch(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const config = step.config ?? {}
    const results = await crustdataService.searchCompanies({
      industry: config.industry as string | undefined,
      employeeRange: config.employeeRange as string | undefined,
      location: config.location as string | undefined,
      keywords: config.keywords as string | undefined,
      limit: context.totalRequested || 50,
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

  private async *executeEnrich(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const inputRows = context.previousStepRows ?? []
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
    return step.stepType === 'enrich' ? ENRICH_COLUMNS : SEARCH_COLUMNS
  }
}
