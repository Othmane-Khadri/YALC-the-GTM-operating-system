// McpServerConfig — persisted configuration for one MCP server
export interface McpServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

// McpToolDefinition — one tool discovered from a connected server
export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  serverId: string
}

// McpConnection — runtime state of a connected server
export interface McpConnection {
  serverId: string
  status: 'connected' | 'disconnected' | 'error'
  tools: McpToolDefinition[]
  connectedAt: string
  lastError?: string
}
