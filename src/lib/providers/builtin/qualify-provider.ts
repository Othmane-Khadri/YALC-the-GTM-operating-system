import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'
import { getAnthropicClient, QUALIFIER_MODEL } from '@/lib/ai/client'

export const QUALIFY_COLUMNS_FULL: ColumnDef[] = [
  { key: 'icp_score', label: 'ICP Score', type: 'score' },
  { key: 'icp_fit_level', label: 'Fit Level', type: 'badge' },
  { key: 'qualification_reason', label: 'Qualification Reason', type: 'text' },
  { key: 'qualification_signals', label: 'Signals', type: 'text' },
]

export class QualifyProvider implements StepExecutor {
  id = 'qualify'
  name = 'AI Qualification Engine'
  description = 'Evaluates leads against ICP framework using Claude. Scores existing rows — does not generate new data.'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['qualify']

  isAvailable(): boolean {
    return true
  }

  canExecute(step: WorkflowStepInput): boolean {
    return step.stepType === 'qualify'
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const rows = context.previousStepRows
    if (!rows || rows.length === 0) {
      yield { rows: [], batchIndex: 0, totalSoFar: 0 }
      return
    }

    const anthropic = getAnthropicClient()
    const batchSize = context.batchSize || 10
    const batches = Math.ceil(rows.length / batchSize)
    let totalSoFar = 0

    for (let i = 0; i < batches; i++) {
      const slice = rows.slice(i * batchSize, (i + 1) * batchSize)

      const rowsForPrompt = slice.map((row, idx) => {
        const fields = Object.entries(row)
          .map(([k, v]) => `  ${k}: ${v ?? '—'}`)
          .join('\n')
        return `Lead ${idx + 1}:\n${fields}`
      }).join('\n\n')

      const prompt = `You are a lead qualification engine. Score each lead against the ICP criteria below.

## ICP Framework
${context.frameworkContext || 'No ICP framework loaded. Use general B2B qualification criteria (company size, relevance, seniority).'}

${context.learningsContext ? `## Historical Learnings (from user feedback)\n${context.learningsContext}\n\nApply these patterns when scoring. They reflect what this specific user considers a good or bad lead.` : ''}

## Qualification Criteria
${step.description || 'Score leads based on ICP fit. Consider company relevance, role seniority, company size, and alignment with pain points.'}

## Leads to Qualify (${slice.length} leads)
${rowsForPrompt}

Score each lead. Be discriminating — not every lead is a good fit.
- icp_score: 0-100 integer. 80+ = strong fit, 50-79 = moderate, below 50 = poor
- icp_fit_level: "Strong", "Moderate", or "Poor"
- qualification_reason: 1-2 sentences explaining WHY this score
- qualification_signals: Comma-separated positive/negative signals (e.g. "+right industry, +senior title, -small company")`

      const response = await anthropic.messages.create({
        model: QUALIFIER_MODEL,
        max_tokens: 4096,
        tools: [{
          name: 'score_leads',
          description: 'Score an array of leads with ICP qualification data',
          input_schema: {
            type: 'object' as const,
            properties: {
              scored_leads: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    lead_index: { type: 'number' },
                    icp_score: { type: 'number' },
                    icp_fit_level: { type: 'string', enum: ['Strong', 'Moderate', 'Poor'] },
                    qualification_reason: { type: 'string' },
                    qualification_signals: { type: 'string' },
                  },
                  required: ['lead_index', 'icp_score', 'icp_fit_level', 'qualification_reason', 'qualification_signals'],
                },
              },
            },
            required: ['scored_leads'],
          },
        }],
        tool_choice: { type: 'tool' as const, name: 'score_leads' },
        messages: [{ role: 'user', content: prompt }],
      })

      let scoredLeads: Array<{
        lead_index: number
        icp_score: number
        icp_fit_level: string
        qualification_reason: string
        qualification_signals: string
      }> = []

      for (const block of response.content) {
        if (block.type === 'tool_use' && block.name === 'score_leads') {
          const input = block.input as { scored_leads: typeof scoredLeads }
          scoredLeads = input.scored_leads || []
        }
      }

      const enrichedRows = slice.map((originalRow, idx) => {
        const score = scoredLeads.find(s => s.lead_index === idx + 1) || scoredLeads[idx]
        return {
          ...originalRow,
          icp_score: score?.icp_score ?? 50,
          icp_fit_level: score?.icp_fit_level ?? 'Moderate',
          qualification_reason: score?.qualification_reason ?? 'Unable to qualify',
          qualification_signals: score?.qualification_signals ?? '',
        }
      })

      totalSoFar += enrichedRows.length

      yield {
        rows: enrichedRows,
        batchIndex: i,
        totalSoFar,
      }
    }
  }

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    return QUALIFY_COLUMNS_FULL
  }
}
