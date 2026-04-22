import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'

export const RESEARCH_COLUMNS: ColumnDef[] = [
  { key: 'question', label: 'Question', type: 'text' },
  { key: 'answer', label: 'Answer', type: 'text' },
  { key: 'confidence', label: 'Confidence', type: 'score' },
  { key: 'source_count', label: 'Sources', type: 'number' },
  { key: 'top_source_url', label: 'Top Source', type: 'url' },
  { key: 'structured_data', label: 'Structured Data', type: 'text' },
]

export class ResearchProvider implements StepExecutor {
  id = 'research'
  name = 'AI Research Agent'
  description = 'General-purpose web research with evidence chains. Searches, scrapes, extracts structured answers via Claude, and stores in the intelligence layer.'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['search', 'enrich']

  isAvailable(): boolean {
    // Requires Firecrawl for scraping and Anthropic for extraction
    return !!process.env.FIRECRAWL_API_KEY && !!process.env.ANTHROPIC_API_KEY
  }

  canExecute(step: WorkflowStepInput): boolean {
    if (step.provider === 'research') return true
    // Claim research-type steps
    if (step.stepType === 'search' || step.stepType === 'enrich') {
      const desc = String(step.description ?? '').toLowerCase()
      const query = String(step.config?.question ?? '').toLowerCase()
      return desc.includes('research') || query.includes('research')
    }
    return false
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const { runResearchAgent } = await import('../../scraping/research-agent')

    // If enriching previous rows, research each one
    if (step.stepType === 'enrich' && context.previousStepRows?.length) {
      const rows = context.previousStepRows
      const question = String(step.config?.question ?? step.description ?? '')
      let totalSoFar = 0

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const target = String(
          row.website ?? row.company_website ?? row.company_name ?? row.name ?? '',
        )

        if (!target) {
          totalSoFar++
          yield { rows: [row], batchIndex: i, totalSoFar }
          continue
        }

        try {
          const finding = await runResearchAgent({
            question,
            targetType: 'company',
            target,
            maxSources: 3,
            tenantId: context.tenantId,
          })

          totalSoFar++
          yield {
            rows: [{
              ...row,
              research_answer: finding.answer,
              research_confidence: finding.confidence,
              research_source_count: finding.evidence.length,
              research_top_source: finding.evidence[0]?.url ?? '',
              research_structured_data: JSON.stringify(finding.structuredData),
            }],
            batchIndex: i,
            totalSoFar,
          }
        } catch {
          totalSoFar++
          yield { rows: [row], batchIndex: i, totalSoFar }
        }
      }
      return
    }

    // Direct research query
    const question = String(step.config?.question ?? step.description ?? '')
    const target = String(step.config?.target ?? '')
    const targetType = String(step.config?.targetType ?? 'company') as 'company' | 'person' | 'topic'
    const maxSources = Number(step.config?.maxSources ?? 5)

    const finding = await runResearchAgent({
      question,
      targetType,
      target,
      maxSources,
      tenantId: context.tenantId,
    })

    const row: Record<string, unknown> = {
      question: finding.question,
      answer: finding.answer,
      confidence: finding.confidence,
      source_count: finding.evidence.length,
      top_source_url: finding.evidence[0]?.url ?? '',
      structured_data: JSON.stringify(finding.structuredData),
    }

    yield { rows: [row], batchIndex: 0, totalSoFar: 1 }
  }

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    return RESEARCH_COLUMNS
  }
}
