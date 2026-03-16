import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'
import { notionService } from '@/lib/services/notion'

const EXPORT_COLUMNS: ColumnDef[] = [
  { key: 'exported', label: 'Exported', type: 'number' },
  { key: 'database_id', label: 'Database ID', type: 'text' },
  { key: 'status', label: 'Status', type: 'badge' },
]

export class NotionProvider implements StepExecutor {
  id = 'notion'
  name = 'Notion'
  description = 'Export leads to a Notion database. Batch creates pages with lead data.'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['export']

  isAvailable(): boolean {
    return notionService.isAvailable()
  }

  canExecute(step: WorkflowStepInput): boolean {
    if (step.provider === 'notion') return true
    return step.stepType === 'export' && !!step.config?.notionDatabaseId
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const databaseId = String(step.config?.notionDatabaseId ?? '')
    if (!databaseId) {
      throw new Error('notionDatabaseId is required in step config for Notion export')
    }

    const rows = context.previousStepRows ?? []
    if (rows.length === 0) {
      yield {
        rows: [{ exported: 0, database_id: databaseId, status: 'No rows to export' }],
        batchIndex: 0,
        totalSoFar: 1,
      }
      return
    }

    const titleField = step.config?.titleField ? String(step.config.titleField) : 'Name'
    const result = await notionService.bulkCreateLeads(databaseId, rows, titleField)

    yield {
      rows: [{
        exported: result.created,
        database_id: databaseId,
        status: result.failed > 0
          ? `${result.created} created, ${result.failed} failed`
          : `${result.created} leads exported`,
      }],
      batchIndex: 0,
      totalSoFar: 1,
    }
  }

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    return EXPORT_COLUMNS
  }
}
