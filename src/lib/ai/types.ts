// ─── Workflow Types ───────────────────────────────────────────────────────────

export type WorkflowStepType = 'search' | 'enrich' | 'qualify' | 'filter' | 'export'

export type WorkflowProvider =
  | 'apollo'
  | 'firecrawl'
  | 'anthropic'
  | 'builtwith'
  | 'clay'
  | 'hunter'
  | 'clearbit'
  | 'manual'
  | 'internal'

export interface ProposedStep {
  stepIndex: number
  title: string
  stepType: WorkflowStepType
  provider: WorkflowProvider
  description: string      // Shown in the workflow preview card
  estimatedRows?: number   // Estimated output rows
  requiredApiKey?: string  // Provider key needed — prompts vault if missing
  config?: Record<string, unknown>
}

export interface WorkflowDefinition {
  title: string
  description: string
  steps: ProposedStep[]
  estimatedTime: string    // e.g. "~2 minutes", "~5 minutes"
  requiredApiKeys: string[]
  estimatedResultCount?: number
}

// ─── Message Types ────────────────────────────────────────────────────────────

export type MessageType = 'text' | 'workflow_proposal' | 'table' | 'knowledge_ref'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  type: MessageType
  // Present when type === 'workflow_proposal'
  workflowDefinition?: WorkflowDefinition
  // Present when type === 'table' — references a resultSetId
  resultSetId?: string
  createdAt: Date
}

// ─── Streaming Event Types ────────────────────────────────────────────────────

export type StreamEventType =
  | 'text_delta'
  | 'workflow_proposal'
  | 'step_start'
  | 'step_complete'
  | 'error'
  | 'done'

export interface StreamEvent {
  type: StreamEventType
  content?: string              // For text_delta
  workflow?: WorkflowDefinition // For workflow_proposal
  stepIndex?: number            // For step_start / step_complete
  stepTitle?: string
  error?: string
}

// ─── Knowledge Types ──────────────────────────────────────────────────────────

export type KnowledgeType = 'icp' | 'template' | 'competitive' | 'learning' | 'other'

export interface KnowledgeChunk {
  itemId: string
  title: string
  type: KnowledgeType
  snippet: string  // Relevant excerpt from extracted text
}

// ─── API Connection Types ─────────────────────────────────────────────────────

export type ApiProvider =
  | 'apollo'
  | 'anthropic'
  | 'firecrawl'
  | 'builtwith'
  | 'clay'
  | 'hunter'
  | 'openai'

export const PROVIDER_LABELS: Record<ApiProvider, string> = {
  apollo: 'Apollo.io',
  anthropic: 'Anthropic (Claude)',
  firecrawl: 'Firecrawl',
  builtwith: 'BuiltWith',
  clay: 'Clay',
  hunter: 'Hunter.io',
  openai: 'OpenAI',
}

export const STEP_TYPE_ICONS: Record<WorkflowStepType, string> = {
  search: '🔍',
  enrich: '⚡',
  qualify: '🧠',
  filter: '🎯',
  export: '📤',
}
