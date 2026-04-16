import type { ColumnDef } from '@/lib/ai/types'

// ProviderCapability — what a provider can do
export type ProviderCapability = 'search' | 'enrich' | 'qualify' | 'filter' | 'export' | 'custom'

// RowBatch — chunk of results yielded during execution
export interface RowBatch {
  rows: Record<string, unknown>[]
  batchIndex: number
  totalSoFar: number
}

// ExecutionContext — passed into every execute() call
export interface ExecutionContext {
  frameworkContext: string
  knowledgeContext?: string
  learningsContext?: string
  previousStepRows?: Record<string, unknown>[]
  apiKey?: string
  mcpClient?: unknown
  batchSize: number
  totalRequested: number
  /**
   * Tenant slug for this execution. Used by providers that need to load
   * tenant-scoped state (framework, memory) to make routing decisions.
   * Defaults to 'default' when unset. (Phase 2 / P2.4)
   */
  tenantId?: string
}

// ProviderMetadata — lightweight descriptor for UI and planner
export interface ProviderMetadata {
  id: string
  name: string
  description: string
  type: 'builtin' | 'mcp' | 'mock'
  capabilities: ProviderCapability[]
  status: 'active' | 'disconnected' | 'error'
}

// WorkflowStepInput — the step shape from the workflow that providers receive
export interface WorkflowStepInput {
  stepIndex: number
  title: string
  stepType: string
  provider: string
  description: string
  estimatedRows?: number
  requiredApiKey?: string
  config?: Record<string, unknown>
  [key: string]: unknown
}

// StepExecutor — the core interface every provider implements
export interface StepExecutor {
  id: string
  name: string
  description: string
  type: 'builtin' | 'mcp' | 'mock'
  capabilities: ProviderCapability[]

  /** Whether this provider's credentials are available (default: true) */
  isAvailable(): boolean
  canExecute(step: WorkflowStepInput): boolean
  execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch>
  getColumnDefinitions(step: WorkflowStepInput): ColumnDef[]
  healthCheck?(): Promise<{ ok: boolean; message: string }>
}
