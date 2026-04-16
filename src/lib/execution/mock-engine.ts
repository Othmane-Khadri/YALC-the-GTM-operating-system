import { getAnthropicClient, PLANNER_MODEL } from '@/lib/ai/client'
import { db } from '@/lib/db'
import { apiConnections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { ColumnDef } from '@/lib/ai/types'

interface GenerateLeadsParams {
  workflowTitle: string
  workflowDescription: string
  columns: ColumnDef[]
  batchSize: number
  batchIndex: number
  totalRequested: number
  frameworkContext?: string
  knowledgeContext?: string
  provider?: string
}

export async function checkProviderKey(provider: string): Promise<boolean> {
  try {
    const [conn] = await db.select().from(apiConnections)
      .where(eq(apiConnections.provider, provider))
      .limit(1)
    if (conn) {
      console.log(`[mock-engine] ${provider}: API key found — ready for real integration (using mock for now)`)
      return true
    }
  } catch {
    // DB query failed — proceed without
  }
  console.log(`[mock-engine] ${provider}: no key, generating mock data`)
  return false
}

export async function generateMockLeads(params: GenerateLeadsParams): Promise<Record<string, unknown>[]> {
  const {
    workflowTitle,
    workflowDescription,
    columns,
    batchSize,
    batchIndex,
    totalRequested,
    frameworkContext,
    knowledgeContext,
  } = params

  // Check if provider has a real API key
  if (params.provider) {
    await checkProviderKey(params.provider)
  }

  const anthropic = getAnthropicClient()

  const columnSpec = columns.map(c => `  - ${c.key} (${c.type}): ${c.label}`).join('\n')

  const prompt = `You are generating mock lead data for a GTM campaign workflow.

Campaign: "${workflowTitle}"
Description: ${workflowDescription}
Batch: ${batchIndex + 1} (generating ${batchSize} leads, ${totalRequested} total)

${frameworkContext ? `\n## User's Business Context\n${frameworkContext}\n` : ''}
${knowledgeContext ? `\n## User's Knowledge Base\nUse this to match leads to their actual ICP and industry:\n${knowledgeContext}\n` : ''}

Generate exactly ${batchSize} realistic leads with these columns:
${columnSpec}

CRITICAL QUALITY DISTRIBUTION:
- ~30% should be GREAT ICP fits (high scores, perfect match)
- ~40% should be OKAY fits (moderate scores, partial match)
- ~30% should be POOR fits (low scores, misaligned)

This distribution makes human review meaningful — users need both good and bad leads to train the system.

Rules:
- Use real-sounding company names (not obviously fake)
- Vary industries, locations, and company sizes realistically
- For score fields: 0-100 integer. Great=75-95, Okay=40-70, Poor=5-35
- For url fields: use realistic domains (e.g. "https://acme-corp.com")
- For badge fields: use short labels (1-3 words)
- For number fields: use realistic integers
- Make data varied and interesting — no repetitive patterns`

  const response = await anthropic.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 4096,
    tools: [{
      name: 'generate_leads',
      description: 'Generate an array of lead objects matching the specified columns',
      input_schema: {
        type: 'object' as const,
        properties: {
          leads: {
            type: 'array',
            items: {
              type: 'object',
              properties: Object.fromEntries(
                columns.map(col => [
                  col.key,
                  col.type === 'number' || col.type === 'score'
                    ? { type: 'number' }
                    : { type: 'string' }
                ])
              ),
            },
          },
        },
        required: ['leads'],
      },
    }],
    tool_choice: { type: 'tool' as const, name: 'generate_leads' },
    messages: [{ role: 'user', content: prompt }],
  })

  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'generate_leads') {
      const input = block.input as { leads: Record<string, unknown>[] }
      return input.leads || []
    }
  }

  return []
}
