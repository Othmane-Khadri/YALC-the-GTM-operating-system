import { getAnthropicClient, QUALIFIER_MODEL, PLANNER_MODEL } from '@/lib/ai/client'
import type { ColumnDef } from '@/lib/ai/types'

interface ExtractLearningsParams {
  approvedRows: Array<Record<string, unknown>>
  rejectedRows: Array<Record<string, unknown>>
  flaggedRows: Array<Record<string, unknown>>
  columns: ColumnDef[]
}

export interface ExtractedPattern {
  insight: string
  confidence: 'hypothesis' | 'validated' | 'proven'
  segment?: string
  evidence_count: number
  category?: 'icp' | 'channel' | 'content' | 'timing' | 'provider' | 'qualification' | 'campaign' | 'competitive'
}

function formatRows(rows: Array<Record<string, unknown>>, columns: ColumnDef[]): string {
  if (rows.length === 0) return '(none)'
  return rows.map((row, i) => {
    const fields = columns.map(c => `  ${c.label}: ${row[c.key] ?? '—'}`).join('\n')
    return `Row ${i + 1}:\n${fields}`
  }).join('\n\n')
}

export async function extractLearnings(params: ExtractLearningsParams): Promise<ExtractedPattern[]> {
  const { approvedRows, rejectedRows, flaggedRows, columns } = params

  const anthropic = getAnthropicClient()

  // Use Opus for deeper pattern recognition if available, fall back to Sonnet
  let model = PLANNER_MODEL
  try {
    model = QUALIFIER_MODEL
  } catch {
    model = PLANNER_MODEL
  }

  const prompt = `You are analyzing a user's lead qualification decisions to extract patterns.

The user reviewed leads and made these decisions:

## APPROVED LEADS (${approvedRows.length} — these match what they want)
${formatRows(approvedRows, columns)}

## REJECTED LEADS (${rejectedRows.length} — these do NOT match)
${formatRows(rejectedRows, columns)}

${flaggedRows.length > 0 ? `## FLAGGED LEADS (${flaggedRows.length} — these need investigation)
${formatRows(flaggedRows, columns)}` : ''}

Analyze the differences between approved and rejected leads. Extract 3-5 specific, actionable patterns.

For each pattern:
- Be SPECIFIC (e.g., "Companies under 50 employees were consistently rejected" not "Size matters")
- Include evidence count (how many leads support this pattern)
- Set confidence: "hypothesis" if <5 evidence, "validated" if 5-10, "proven" if >10
- Include segment if the pattern applies to a specific group
- For each pattern, also include a "category" field with one of:
  icp, channel, content, timing, provider, qualification, campaign, competitive.
  Choose the category that best describes what domain this learning applies to.

These patterns will be saved and used to improve future lead generation.`

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    tools: [{
      name: 'extract_learnings',
      description: 'Extract patterns from lead qualification feedback',
      input_schema: {
        type: 'object' as const,
        properties: {
          patterns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                insight: { type: 'string', description: 'Specific, actionable pattern description' },
                confidence: { type: 'string', enum: ['hypothesis', 'validated', 'proven'] },
                segment: { type: 'string', description: 'Target segment this applies to (optional)' },
                evidence_count: { type: 'number', description: 'Number of leads that support this pattern' },
                category: { type: 'string', enum: ['icp', 'channel', 'content', 'timing', 'provider', 'qualification', 'campaign', 'competitive'], description: 'Domain category this learning applies to' },
              },
              required: ['insight', 'confidence', 'evidence_count'],
            },
          },
        },
        required: ['patterns'],
      },
    }],
    tool_choice: { type: 'tool' as const, name: 'extract_learnings' },
    messages: [{ role: 'user', content: prompt }],
  })

  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'extract_learnings') {
      const input = block.input as { patterns: ExtractedPattern[] }
      return input.patterns || []
    }
  }

  return []
}
