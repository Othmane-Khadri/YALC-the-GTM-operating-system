/**
 * MCP Provider Adapter
 *
 * Wraps any MCP server as a StepExecutor, enabling drop-in
 * registration in the ProviderRegistry alongside builtin providers.
 *
 * Supports stdio and SSE transports. Discovers tools via tools/list,
 * maps them to GTM-OS capabilities, and executes tool calls when the
 * provider is used in a pipeline step.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type {
  StepExecutor,
  RowBatch,
  ExecutionContext,
  WorkflowStepInput,
  ProviderCapability,
} from './types'
import type { ColumnDef } from '@/lib/ai/types'

// ─── Config types ─────────────────────────────────────────────────────────────

export interface McpHealthCheck {
  tool: string
  timeout: number
}

export interface McpProviderConfigBase {
  name: string
  displayName: string
  capabilities: ProviderCapability[]
  healthCheck?: McpHealthCheck
}

export interface McpStdioConfig extends McpProviderConfigBase {
  transport: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpSseConfig extends McpProviderConfigBase {
  transport: 'sse'
  url: string
  headers?: Record<string, string>
}

export type McpProviderConfig = McpStdioConfig | McpSseConfig

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class McpProviderAdapter implements StepExecutor {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly type = 'mcp' as const
  readonly capabilities: ProviderCapability[]

  private client: Client | null = null
  private available = false
  private tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = []
  private readonly config: McpProviderConfig

  constructor(config: McpProviderConfig) {
    this.config = config
    this.id = `mcp:${config.name}`
    this.name = config.displayName
    this.description = `MCP provider: ${config.displayName} (${config.capabilities.join(', ')})`
    this.capabilities = [...config.capabilities]
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Connect to the MCP server, discover tools, and mark availability.
   * Never throws — marks unavailable on failure.
   */
  async connect(): Promise<void> {
    try {
      this.client = new Client({ name: 'gtm-os', version: '1.0.0' })

      let transport: StdioClientTransport | SSEClientTransport

      if (this.config.transport === 'stdio') {
        const cfg = this.config as McpStdioConfig
        transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args ?? [],
          env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
        })
      } else {
        const cfg = this.config as McpSseConfig
        transport = new SSEClientTransport(
          new URL(cfg.url),
          { requestInit: { headers: cfg.headers ?? {} } },
        )
      }

      // Connect with a timeout to avoid hanging
      await Promise.race([
        this.client.connect(transport),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), 10_000),
        ),
      ])

      // Discover tools
      const result = await Promise.race([
        this.client.listTools(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('tools/list timeout')), 10_000),
        ),
      ])

      this.tools = (result as any).tools ?? []
      this.available = true
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mcp:${this.config.name}] Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      this.available = false
      this.client = null
    }
  }

  /**
   * Disconnect gracefully.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close()
      } catch {
        // ignore
      }
      this.client = null
    }
    this.available = false
  }

  // ─── StepExecutor interface ──────────────────────────────────────────────

  isAvailable(): boolean {
    return this.available
  }

  canExecute(step: WorkflowStepInput): boolean {
    // Match by provider name (exact or with mcp: prefix)
    if (step.provider === this.id || step.provider === this.config.name) return true
    if (step.provider === `mcp:${this.config.name}`) return true

    // Capability-based match
    const cap = step.stepType as ProviderCapability
    return this.capabilities.includes(cap)
  }

  async *execute(
    step: WorkflowStepInput,
    context: ExecutionContext,
  ): AsyncIterable<RowBatch> {
    if (!this.client || !this.available) {
      // Attempt reconnect
      await this.connect()
      if (!this.client || !this.available) {
        throw new Error(`[mcp:${this.config.name}] Provider unavailable — cannot execute`)
      }
    }

    // Determine which MCP tool to call.
    // Priority: step.config.tool > first tool matching step description > first tool
    const toolName = this.resolveToolName(step)
    if (!toolName) {
      throw new Error(
        `[mcp:${this.config.name}] No matching tool found for step "${step.title}". Available: ${this.tools.map(t => t.name).join(', ')}`,
      )
    }

    // Build arguments from step config + previous step rows
    const args: Record<string, unknown> = {
      ...(step.config ?? {}),
    }

    // If there are previous step rows, pass them as input
    if (context.previousStepRows && context.previousStepRows.length > 0) {
      args.input_rows = context.previousStepRows
    }

    // Remove internal keys
    delete args.tool

    try {
      const result = await Promise.race([
        this.client.callTool({ name: toolName, arguments: args }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool call timeout (${toolName})`)),
            this.config.healthCheck?.timeout ?? 30_000,
          ),
        ),
      ])

      // Parse MCP result into rows
      const rows = this.parseToolResult(result)

      // Yield in batches
      const batchSize = context.batchSize || 25
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize)
        yield {
          rows: batch,
          batchIndex: Math.floor(i / batchSize),
          totalSoFar: Math.min(i + batchSize, rows.length),
        }
      }

      // If no rows extracted, yield empty batch
      if (rows.length === 0) {
        yield { rows: [], batchIndex: 0, totalSoFar: 0 }
      }
    } catch (err) {
      // On connection drops, mark unavailable
      if (
        err instanceof Error &&
        (err.message.includes('timeout') ||
          err.message.includes('ECONNREFUSED') ||
          err.message.includes('closed'))
      ) {
        this.available = false
      }
      throw err
    }
  }

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    // MCP providers return dynamic schemas — return a generic set
    return [
      { key: 'id', label: 'ID', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'data', label: 'Data', type: 'text' },
    ]
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.config.healthCheck) {
      return { ok: this.available, message: this.available ? 'Connected' : 'Unavailable' }
    }

    if (!this.client || !this.available) {
      await this.connect()
    }

    if (!this.client || !this.available) {
      return { ok: false, message: 'Cannot connect to MCP server' }
    }

    const { tool, timeout } = this.config.healthCheck

    // Check if the tool exists in discovered tools
    const toolExists = this.tools.some(t => t.name === tool)
    if (!toolExists) {
      return {
        ok: false,
        message: `Health check tool "${tool}" not found. Available: ${this.tools.map(t => t.name).join(', ')}`,
      }
    }

    try {
      await Promise.race([
        this.client.callTool({ name: tool, arguments: {} }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), timeout),
        ),
      ])
      return { ok: true, message: `Tool "${tool}" responded` }
    } catch (err) {
      return {
        ok: false,
        message: `Health check failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  // ─── Tool info ────────────────────────────────────────────────────────────

  getDiscoveredTools(): Array<{ name: string; description?: string }> {
    return this.tools.map(t => ({ name: t.name, description: t.description }))
  }

  getConfig(): McpProviderConfig {
    return this.config
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private resolveToolName(step: WorkflowStepInput): string | null {
    // Explicit tool in config
    if (step.config?.tool && typeof step.config.tool === 'string') {
      const match = this.tools.find(t => t.name === step.config!.tool)
      if (match) return match.name
    }

    // Match by step description keywords
    const desc = (step.description ?? '').toLowerCase()
    for (const t of this.tools) {
      const toolDesc = (t.description ?? t.name).toLowerCase()
      if (desc.includes(t.name.toLowerCase())) return t.name
      // Check for keyword overlap
      const descWords = desc.split(/\s+/)
      const toolWords = toolDesc.split(/\s+/)
      const overlap = descWords.filter(w => w.length > 3 && toolWords.includes(w))
      if (overlap.length >= 2) return t.name
    }

    // Fall back to first tool
    return this.tools[0]?.name ?? null
  }

  private parseToolResult(result: unknown): Record<string, unknown>[] {
    if (!result || typeof result !== 'object') return []

    const res = result as Record<string, unknown>

    // MCP tools return content array with text items
    const content = res.content as Array<{ type: string; text?: string }> | undefined
    if (!content || !Array.isArray(content)) return []

    const rows: Record<string, unknown>[] = []

    for (const item of content) {
      if (item.type === 'text' && item.text) {
        try {
          const parsed = JSON.parse(item.text)
          if (Array.isArray(parsed)) {
            rows.push(...parsed.map((r: unknown) => (typeof r === 'object' && r !== null ? r : { data: r }) as Record<string, unknown>))
          } else if (typeof parsed === 'object' && parsed !== null) {
            // Single object — check for nested arrays
            const arrKey = Object.keys(parsed).find(k => Array.isArray((parsed as any)[k]))
            if (arrKey) {
              rows.push(...(parsed as any)[arrKey])
            } else {
              rows.push(parsed as Record<string, unknown>)
            }
          }
        } catch {
          // Not JSON — wrap as text row
          rows.push({ text: item.text })
        }
      }
    }

    return rows
  }
}
