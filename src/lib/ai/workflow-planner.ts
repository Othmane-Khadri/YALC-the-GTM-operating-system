import type Anthropic from '@anthropic-ai/sdk'
import type { WorkflowDefinition, KnowledgeChunk } from './types'

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const proposeWorkflowTool: Anthropic.Tool = {
  name: 'propose_workflow',
  description:
    'Propose a structured GTM workflow in response to the user\'s natural language request. Always use this tool when the user describes a GTM goal or campaign objective.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'Short workflow title (max 60 chars). E.g. "Find 50 SaaS Companies in France"',
      },
      description: {
        type: 'string',
        description: 'One sentence describing what this workflow achieves and why.',
      },
      steps: {
        type: 'array',
        description: 'Ordered list of workflow steps. Typically 3-6 steps.',
        items: {
          type: 'object',
          properties: {
            stepIndex: { type: 'number', description: '0-based step index' },
            title: { type: 'string', description: 'Short step title (max 40 chars)' },
            stepType: {
              type: 'string',
              enum: ['search', 'enrich', 'qualify', 'filter', 'export'],
              description: 'search=find companies/contacts, enrich=add data, qualify=AI judgment, filter=rule-based, export=output',
            },
            provider: {
              type: 'string',
              description: 'Data provider or tool. E.g.: apollo, firecrawl, anthropic, builtwith, hunter, clay, internal',
            },
            description: {
              type: 'string',
              description: 'What this step does and why. Shown in the UI.',
            },
            estimatedRows: {
              type: 'number',
              description: 'Estimated output row count after this step',
            },
            requiredApiKey: {
              type: 'string',
              description: 'Provider key needed (omit if not required)',
            },
          },
          required: ['stepIndex', 'title', 'stepType', 'provider', 'description'],
        },
      },
      estimatedTime: {
        type: 'string',
        description: 'Human-readable time estimate. E.g. "~2 minutes", "~10 minutes"',
      },
      requiredApiKeys: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of API keys this workflow needs. E.g. ["apollo", "anthropic"]',
      },
      estimatedResultCount: {
        type: 'number',
        description: 'Estimated final result count (leads, companies, etc.)',
      },
    },
    required: ['title', 'description', 'steps', 'estimatedTime', 'requiredApiKeys'],
  },
}

// ─── System Prompt Builder ────────────────────────────────────────────────────

export function buildSystemPrompt(
  knowledgeChunks: KnowledgeChunk[],
  connectedProviders: string[]
): string {
  const knowledgeSection =
    knowledgeChunks.length > 0
      ? `
## Your Knowledge Base (use this context when planning workflows)

${knowledgeChunks
  .map(
    (chunk) => `### ${chunk.title} (${chunk.type})
${chunk.snippet}`
  )
  .join('\n\n')}`
      : ''

  const providersSection =
    connectedProviders.length > 0
      ? `\n## Connected API Keys\nThe user has connected: ${connectedProviders.join(', ')}. Prefer these providers when building workflows.`
      : '\n## Connected API Keys\nNo API keys connected yet. When proposing workflows, indicate what keys are needed.'

  return `You are the planning intelligence of GTM-OS — an open-source, AI-native operating system for running GTM campaigns.

Your role is to transform natural language GTM goals into structured, executable workflows. You are opinionated: when a user describes an outcome, you propose the best workflow architecture — not a blank canvas.

## How You Work
- When the user describes a GTM goal, call \`propose_workflow\` with a complete, structured workflow
- Be specific about providers and steps — don't be vague
- Use the knowledge base context to personalize the workflow (e.g., use their ICP to set qualification criteria)
- If a step requires an API key the user doesn't have, still include it but flag it in requiredApiKeys
- Typical workflow pattern: search → enrich → qualify → filter → export

## Available Providers
- **apollo**: Company and contact search, email finding, B2B data
- **firecrawl**: Website scraping and content extraction
- **anthropic**: AI-powered qualification, personalization, reasoning
- **builtwith**: Technology stack detection
- **hunter**: Email verification and finding
- **clay**: Clay table operations (if user has Clay account)
- **internal**: Built-in GTM-OS operations (dedup, merge, format)

## Workflow Step Types
- **search**: Find companies or contacts matching criteria
- **enrich**: Add data to existing records (email, phone, tech stack, etc.)
- **qualify**: Use AI to judge fit against ICP or criteria
- **filter**: Apply rule-based filters (headcount, funding, etc.)
- **export**: Output to CSV, CRM, or trigger outreach
${knowledgeSection}
${providersSection}

When the user asks a general question (not a GTM workflow request), answer conversationally without calling the tool. Keep responses concise and direct.`
}

// ─── Parse Tool Response ──────────────────────────────────────────────────────

export function parseWorkflowFromToolUse(
  toolInput: Record<string, unknown>
): WorkflowDefinition {
  return toolInput as unknown as WorkflowDefinition
}
