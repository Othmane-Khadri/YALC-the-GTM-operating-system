import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'
import type { ApifyActorEntry } from './apify-catalog'
import { runApifyActor, apifyHealthCheck } from './apify-base'

export function createApifyProvider(entry: ApifyActorEntry): StepExecutor {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    type: 'builtin' as const,
    capabilities: entry.capabilities as ProviderCapability[],

    isAvailable(): boolean {
      return !!process.env.APIFY_TOKEN
    },

    canExecute(step: WorkflowStepInput): boolean {
      if (step.provider === entry.id) return true
      return step.provider.startsWith(entry.id) || entry.id.startsWith(step.provider)
    },

    async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
      const config = step.config ?? {}
      const input = entry.buildInput(config, step)

      const rawResults = await runApifyActor(entry.actorId, input)
      const flatResults = entry.extractRows ? entry.extractRows(rawResults) : rawResults

      const batchSize = context.batchSize || 10
      let totalSoFar = 0
      const batches = Math.ceil(flatResults.length / batchSize)

      for (let i = 0; i < batches; i++) {
        const slice = flatResults.slice(i * batchSize, (i + 1) * batchSize)
        const rows = slice.map((raw) => entry.normalizeRow(raw))
        totalSoFar += rows.length
        yield { rows, batchIndex: i, totalSoFar }
      }
    },

    getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
      return entry.columns
    },

    async healthCheck(): Promise<{ ok: boolean; message: string }> {
      return apifyHealthCheck()
    },
  }
}
