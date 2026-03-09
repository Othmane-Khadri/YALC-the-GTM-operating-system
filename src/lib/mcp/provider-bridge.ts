import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../providers/types'
import { getRegistry } from '../providers/registry'
import { mcpManager } from './client'
import type { McpToolDefinition } from './types'
import type { ColumnDef } from '@/lib/ai/types'

function sanitizeToolName(name: string): string {
  // Strip characters that could cause ID collisions or path traversal
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128)
}

function createMcpExecutor(tool: McpToolDefinition): StepExecutor {
  const safeName = sanitizeToolName(tool.name)
  const executorId = `mcp:${tool.serverId}:${safeName}`

  return {
    id: executorId,
    name: tool.name,
    description: tool.description,
    type: 'mcp',
    capabilities: inferCapabilities(tool),

    isAvailable(): boolean {
      return true // MCP servers are always available once registered
    },

    canExecute(step: WorkflowStepInput): boolean {
      return step.provider === executorId || step.provider === tool.name
    },

    async *execute(step: WorkflowStepInput, _context: ExecutionContext): AsyncIterable<RowBatch> {
      const result = await mcpManager.callTool(tool.serverId, tool.name, step.config)
      const rows = normalizeToolResult(result)
      yield { rows, batchIndex: 0, totalSoFar: rows.length }
    },

    getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
      return deriveColumnsFromSchema(tool.inputSchema)
    },

    async healthCheck() {
      const health = await mcpManager.healthCheck(tool.serverId)
      return { ok: health.ok, message: health.ok ? 'Connected' : 'Disconnected' }
    },
  }
}

function inferCapabilities(tool: McpToolDefinition): ProviderCapability[] {
  const text = `${tool.name} ${tool.description}`.toLowerCase()
  const caps: ProviderCapability[] = []
  if (text.includes('search') || text.includes('find') || text.includes('list')) caps.push('search')
  if (text.includes('enrich') || text.includes('lookup') || text.includes('detail')) caps.push('enrich')
  if (text.includes('filter') || text.includes('qualify') || text.includes('score')) caps.push('qualify')
  if (text.includes('export') || text.includes('write') || text.includes('save')) caps.push('export')
  if (caps.length === 0) caps.push('custom')
  return caps
}

function normalizeToolResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result.map(r => (typeof r === 'object' && r !== null ? r : { value: r }) as Record<string, unknown>)
  if (typeof result === 'object' && result !== null) {
    const obj = result as Record<string, unknown>
    for (const key of ['content', 'results', 'data', 'items', 'rows']) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[]
    }
    return [obj]
  }
  return [{ value: result }]
}

function deriveColumnsFromSchema(schema: Record<string, unknown>): ColumnDef[] {
  const properties = (schema as Record<string, Record<string, unknown>>)?.properties ?? {}
  return Object.entries(properties).map(([key]) => ({
    key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    type: 'text' as const,
  }))
}

export function registerMcpTools(tools: McpToolDefinition[]): void {
  const registry = getRegistry()
  for (const tool of tools) {
    const executor = createMcpExecutor(tool)
    // Prevent MCP tools from shadowing built-in providers
    const existing = registry.getAll().find(p => p.id === executor.id)
    if (existing && !existing.id.startsWith('mcp:')) {
      console.warn(`[MCP] Skipping tool "${tool.name}" — would shadow built-in provider "${existing.id}"`)
      continue
    }
    registry.register(executor)
  }
}

export function unregisterMcpTools(serverId: string): void {
  const registry = getRegistry()
  const allProviders = registry.getAll()
  for (const p of allProviders) {
    if (p.id.startsWith(`mcp:${serverId}:`)) {
      registry.unregister(p.id)
    }
  }
}
