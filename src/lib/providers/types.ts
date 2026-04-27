import type { ColumnDef } from '../ai/types'

// ProviderCapability — what a provider can do.
//
// `email_send` and `linkedin_send` are outbound-channel slots so messaging
// providers (Instantly, Brevo, Mailgun, SendGrid, Unipile, …) can register
// against the same capability surface as search/enrich/qualify providers.
// Routing through the registry is what makes outbound channels swappable.
export type ProviderCapability =
  | 'search'
  | 'enrich'
  | 'qualify'
  | 'filter'
  | 'export'
  | 'custom'
  | 'email_send'
  | 'linkedin_send'

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

/**
 * Skill-runtime metadata that is NOT part of the underlying tool/provider
 * argument shape. Loaders (e.g. the markdown skill loader) use this to
 * carry the resolved prompt, intended output mode, originating skill name,
 * etc. through to the executor without polluting `step.config` — which
 * is forwarded verbatim as MCP tool `arguments` and rejected by
 * strict-schema servers if it contains unknown keys.
 *
 * Convention: any field the executor needs that is NOT a real tool
 * argument MUST live here, OR be prefixed with `_yalc_` inside `config`
 * (also stripped before tool dispatch, see mcp-adapter).
 */
export interface StepMetadata {
  prompt?: string
  output?: string
  skillName?: string
  [key: string]: unknown
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
  /**
   * Tool arguments only. Anything in here is forwarded verbatim to MCP
   * tool calls — never inject skill-runtime fields.
   */
  config?: Record<string, unknown>
  /**
   * Skill-runtime metadata (resolved prompt, output mode, skill name).
   * Builtin providers that need the rendered prompt should read from
   * `metadata.prompt`. Never sent to MCP servers.
   */
  metadata?: StepMetadata
  [key: string]: unknown
}

/**
 * Self-describing health-check result. Providers that implement
 * `selfHealthCheck()` own their own probe — the diagnostic layer does not
 * have to know which API endpoint to hit. Required for builtins as of
 * 0.7.0; doctor reads `selfHealthCheck` first and only falls back to its
 * legacy hardcoded probes for providers that have not migrated.
 */
export interface ProviderHealthStatus {
  status: 'ok' | 'fail' | 'warn'
  detail: string
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
  /** Legacy health-check shape used by `provider:test`. */
  healthCheck?(): Promise<{ ok: boolean; message: string }>
  /** Self-describing health probe used by doctor (0.7.0+). */
  selfHealthCheck?(): Promise<ProviderHealthStatus>
}
