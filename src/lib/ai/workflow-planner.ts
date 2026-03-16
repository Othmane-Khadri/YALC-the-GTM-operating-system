import type Anthropic from '@anthropic-ai/sdk'
import type { WorkflowDefinition, KnowledgeChunk } from './types'

// ─── 3 Focused Action Tools ────────────────────────────────────────────────────

export const findLeadsTool: Anthropic.Tool = {
  name: 'find_leads',
  description: 'Search for companies/people OR scrape from a URL. Always auto-qualifies results against ICP.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query. E.g. "SaaS companies in France hiring for sales"',
      },
      url: {
        type: 'string',
        description: 'URL to scrape (LinkedIn post, website, etc.). Provide instead of query when user shares a link.',
      },
      targetCount: {
        type: 'number',
        description: 'How many leads to find. Default 50.',
      },
      filters: {
        type: 'object',
        description: 'Optional structured filters',
        properties: {
          industry: { type: 'string' },
          location: { type: 'string' },
          companySize: { type: 'string' },
          role: { type: 'string' },
        },
      },
    },
    required: ['query'],
  },
}

export const enrichLeadsTool: Anthropic.Tool = {
  name: 'enrich_leads',
  description: 'Enrich existing leads with missing data (email, company info, tech stack, etc.)',
  input_schema: {
    type: 'object' as const,
    properties: {
      enrichmentGoal: {
        type: 'string',
        description: 'What to find: "email addresses", "company info", "tech stack", etc.',
      },
      leads: {
        type: 'array',
        items: { type: 'object' },
        description: 'Inline leads parsed from user text. Each object is one lead with whatever fields are available.',
      },
    },
    required: ['enrichmentGoal'],
  },
}

export const qualifyLeadsTool: Anthropic.Tool = {
  name: 'qualify_leads',
  description: 'Score leads against ICP criteria. Use when user wants to qualify/score existing data.',
  input_schema: {
    type: 'object' as const,
    properties: {
      criteria: {
        type: 'string',
        description: 'ICP description or qualification context from the user.',
      },
      leads: {
        type: 'array',
        items: { type: 'object' },
        description: 'Inline leads parsed from user text. Each object is one lead.',
      },
    },
    required: ['criteria'],
  },
}

// All tools array for easy import
export const actionTools: Anthropic.Tool[] = [findLeadsTool, enrichLeadsTool, qualifyLeadsTool]

// ─── System Prompt Builder ────────────────────────────────────────────────────

export function buildSystemPrompt(
  knowledgeChunks: KnowledgeChunk[],
  connectedProviders: string[],
  frameworkContext: string = ''
): string {
  const knowledgeSection =
    knowledgeChunks.length > 0
      ? `
## Your Knowledge Base (use this context when planning)

${knowledgeChunks
  .map((chunk) => {
    const content =
      chunk.extractedText && chunk.textLength && chunk.textLength < 4000
        ? chunk.extractedText
        : chunk.snippet
    return `### ${chunk.title} (${chunk.type})\n${content}`
  })
  .join('\n\n')}`
      : ''

  const providersSection =
    connectedProviders.length > 0
      ? `\n## Connected API Keys\nThe user has connected: ${connectedProviders.join(', ')}.`
      : '\n## Connected API Keys\nNo API keys connected yet.'

  return `You are GTM-OS — an AI-native operating system for lead generation.

You have 3 actions available. Pick the right one based on what the user asks:

## Actions
1. **find_leads** — Search for companies/people OR scrape a URL. Results are auto-qualified against ICP.
   - User says "Find 50 SaaS companies in France" → use find_leads
   - User says "Scrape people from this LinkedIn post: [URL]" → use find_leads with the url parameter
   - User uploads a CSV + says "find more like these" → use find_leads

2. **enrich_leads** — Add missing data to existing leads (email, company info, tech stack).
   - User pastes domains and says "get me their emails" → use enrich_leads
   - User uploads a CSV + says "enrich with tech stack" → use enrich_leads

3. **qualify_leads** — Score leads against ICP criteria.
   - User uploads a CSV + says "score against my ICP" → use qualify_leads
   - User pastes leads and says "which of these are a good fit?" → use qualify_leads

## Rules
- Always call exactly ONE tool per message. Never call multiple.
- Extract structured parameters from natural language. Be specific.
- If the user shares a URL, put it in the \`url\` field of find_leads.
- If the user pastes lead data inline, parse it into the \`leads\` array.
- If attached CSV rows are provided in the message, they will be available as seedRows. Reference them in your tool call.
- When the user asks a general question (not a GTM action), answer conversationally without calling a tool.
${frameworkContext ? '\n## ICP Framework\n' + frameworkContext : ''}
${knowledgeSection}
${providersSection}`
}

// ─── Build Workflow from Tool Call ────────────────────────────────────────────

export function buildWorkflowFromAction(
  toolName: string,
  toolInput: Record<string, unknown>,
): WorkflowDefinition {
  const targetCount = (toolInput.targetCount as number) ?? 50

  if (toolName === 'find_leads') {
    const query = (toolInput.query as string) ?? (toolInput.url ? `Scrape ${toolInput.url}` : 'Find leads')
    const config: Record<string, unknown> = {}
    if (toolInput.query) config.query = toolInput.query
    if (toolInput.url) config.url = toolInput.url
    if (toolInput.filters) config.filters = toolInput.filters

    // Detect LinkedIn vs web search
    const isLinkedIn = query.toLowerCase().includes('linkedin')
      || String(toolInput.url ?? '').toLowerCase().includes('linkedin.com')
    const provider = isLinkedIn ? 'unipile' : 'firecrawl'
    const requiredKey = isLinkedIn ? 'unipile' : 'firecrawl'

    return {
      title: query.slice(0, 60),
      description: query,
      steps: [
        {
          stepIndex: 0,
          title: toolInput.url ? 'Scrape & collect' : 'Search leads',
          stepType: 'search',
          provider,
          description: query,
          estimatedRows: targetCount,
          config,
        },
        {
          stepIndex: 1,
          title: 'Qualify against ICP',
          stepType: 'qualify',
          provider: 'qualify',
          description: 'Auto-qualify all results against your ICP framework',
          estimatedRows: targetCount,
        },
      ],
      estimatedTime: '~2 minutes',
      requiredApiKeys: [requiredKey],
      estimatedResultCount: targetCount,
    }
  }

  if (toolName === 'enrich_leads') {
    const goal = (toolInput.enrichmentGoal as string) ?? 'Enrich leads'

    // Detect LinkedIn enrichment
    const isLinkedIn = goal.toLowerCase().includes('linkedin')
    const provider = isLinkedIn ? 'unipile' : 'firecrawl'
    const requiredKey = isLinkedIn ? 'unipile' : 'firecrawl'

    return {
      title: `Enrich: ${goal}`.slice(0, 60),
      description: goal,
      steps: [
        {
          stepIndex: 0,
          title: 'Enrich leads',
          stepType: 'enrich',
          provider,
          description: goal,
          estimatedRows: targetCount,
          config: { query: goal },
        },
      ],
      estimatedTime: '~2 minutes',
      requiredApiKeys: [requiredKey],
      estimatedResultCount: targetCount,
    }
  }

  // qualify_leads
  const criteria = (toolInput.criteria as string) ?? 'Score against ICP'
  return {
    title: `Qualify: ${criteria}`.slice(0, 60),
    description: criteria,
    steps: [
      {
        stepIndex: 0,
        title: 'Qualify against ICP',
        stepType: 'qualify',
        provider: 'qualify',
        description: criteria,
        estimatedRows: targetCount,
      },
    ],
    estimatedTime: '~1 minute',
    requiredApiKeys: [],
    estimatedResultCount: targetCount,
  }
}

// Keep backward-compatible export
export function parseWorkflowFromToolUse(
  toolInput: Record<string, unknown>
): WorkflowDefinition {
  return toolInput as unknown as WorkflowDefinition
}
