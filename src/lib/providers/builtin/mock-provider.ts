import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../types'
import { generateMockLeads } from '../../execution/mock-engine'
import { SEARCH_COLUMNS, ENRICH_COLUMNS, QUALIFY_COLUMNS } from '../../execution/columns'
import type { ColumnDef } from '@/lib/ai/types'

export class MockProvider implements StepExecutor {
  id = 'mock'
  name = 'Mock Provider'
  description = 'Generates realistic mock data via Claude for any step type. Fallback provider.'
  type = 'mock' as const
  capabilities: ProviderCapability[] = [
    'search',
    'enrich',
    'qualify',
    'filter',
    'export',
    'custom',
    'email_send',
    'linkedin_send',
  ]

  isAvailable(): boolean {
    return true // always available
  }

  canExecute(_step: WorkflowStepInput): boolean {
    return true // fallback — can handle anything
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const columns = this.getColumnDefinitions(step)
    const batchSize = context.batchSize || 10
    const targetRows = Math.min(step.estimatedRows || context.totalRequested, context.totalRequested)
    const batches = Math.ceil(targetRows / batchSize)
    let totalSoFar = 0

    for (let i = 0; i < batches; i++) {
      const currentBatchSize = Math.min(batchSize, targetRows - (i * batchSize))

      const leads = await generateMockLeads({
        workflowTitle: step.title || 'Workflow Step',
        workflowDescription: step.description || '',
        columns,
        batchSize: currentBatchSize,
        batchIndex: i,
        totalRequested: targetRows,
        frameworkContext: context.frameworkContext,
        knowledgeContext: context.knowledgeContext,
        provider: step.provider,
      })

      totalSoFar += leads.length

      yield {
        rows: leads,
        batchIndex: i,
        totalSoFar,
      }
    }
  }

  getColumnDefinitions(step: WorkflowStepInput): ColumnDef[] {
    switch (step.stepType) {
      case 'search':
        return SEARCH_COLUMNS
      case 'enrich':
        return ENRICH_COLUMNS[step.provider] ?? SEARCH_COLUMNS
      case 'qualify':
        return QUALIFY_COLUMNS
      case 'filter':
      case 'export':
      default:
        return []
    }
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Mock provider ready' }
  }
}
