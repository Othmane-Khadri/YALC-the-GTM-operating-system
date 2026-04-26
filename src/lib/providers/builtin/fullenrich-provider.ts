import type { StepExecutor, RowBatch, ExecutionContext, WorkflowStepInput, ProviderCapability } from '../types'
import type { ColumnDef } from '../../ai/types'
import { fullenrichService } from '../../services/fullenrich'
import type { FullEnrichContact } from '../../services/fullenrich'

const ENRICH_COLUMNS: ColumnDef[] = [
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'email_status', label: 'Email Status', type: 'badge' },
]

export class FullEnrichProvider implements StepExecutor {
  id = 'fullenrich'
  name = 'FullEnrich'
  description = 'Contact email and phone enrichment via FullEnrich API'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['enrich']

  isAvailable(): boolean {
    return fullenrichService.isAvailable()
  }

  canExecute(step: WorkflowStepInput): boolean {
    if (step.provider === 'fullenrich') return true
    // Claim enrich steps that request email/phone data
    const desc = (step.description ?? '').toLowerCase()
    return step.stepType === 'enrich' && (desc.includes('email') || desc.includes('phone') || desc.includes('contact'))
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const inputRows = context.previousStepRows ?? []
    if (inputRows.length === 0) return

    // Build contacts from input rows
    const contacts: FullEnrichContact[] = inputRows.map(row => ({
      firstname: String(row.first_name ?? row.firstName ?? ''),
      lastname: String(row.last_name ?? row.lastName ?? ''),
      domain: String(row.website ?? row.domain ?? row.company_domain ?? ''),
      company_name: String(row.company_name ?? row.company ?? ''),
      linkedin_url: row.linkedin_url ? String(row.linkedin_url) : undefined,
    }))

    // Enrich in bulk
    const enrichmentId = await fullenrichService.enrichBulk(contacts)

    // Poll for results with progress events
    const results = await fullenrichService.pollResults(enrichmentId)

    // Merge enriched data back into rows
    const enrichedRows = inputRows.map((row, i) => {
      const result = results[i]
      if (!result) return row
      return {
        ...row,
        email: result.email ?? row.email,
        phone: result.phone ?? row.phone,
        email_status: result.email_status ?? row.email_status,
      }
    })

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

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    return ENRICH_COLUMNS
  }
}
