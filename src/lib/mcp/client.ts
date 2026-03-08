import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { McpServerConfig, McpConnection, McpToolDefinition } from './types'
import { validateUrl } from '../web/url-validator'

// Only these commands are allowed for stdio MCP servers.
// Extend this list as needed — never allow arbitrary binaries.
const ALLOWED_COMMANDS = new Set([
  'npx', 'node', 'uvx', 'uv', 'docker', 'python3', 'python',
  'deno', 'bun',
])

// Only these env vars are forwarded to child processes.
// Server secrets (ANTHROPIC_API_KEY, ENCRYPTION_KEY, etc.) are never leaked.
const ALLOWED_CHILD_ENV_VARS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'TERM',
  'NODE_ENV', 'npm_config_prefix',
])

class McpConnectionManager {
  private connections = new Map<string, { client: Client; connection: McpConnection }>()

  async connect(config: McpServerConfig): Promise<McpConnection> {
    this.disconnect(config.id)

    let transport
    if (config.transport === 'stdio') {
      const cmd = config.command!
      // Only allow bare command names — reject paths to prevent trojan binaries
      if (cmd.includes('/') || cmd.includes('\\')) {
        throw new Error(
          `Blocked: command "${cmd}" contains path separators. ` +
          `Only bare command names are allowed (e.g., "npx", "node").`
        )
      }
      if (!ALLOWED_COMMANDS.has(cmd)) {
        throw new Error(
          `Blocked: command "${cmd}" is not in the allowlist. ` +
          `Allowed: ${[...ALLOWED_COMMANDS].join(', ')}`
        )
      }

      // Build a minimal env — never spread process.env
      const childEnv: Record<string, string> = {}
      for (const key of ALLOWED_CHILD_ENV_VARS) {
        if (process.env[key]) childEnv[key] = process.env[key]!
      }
      // Merge user-supplied env vars (these are stored encrypted in the DB)
      if (config.env) {
        Object.assign(childEnv, config.env)
      }

      transport = new StdioClientTransport({
        command: cmd,
        args: config.args ?? [],
        env: childEnv,
      })
    } else {
      await validateUrl(config.url!)
      transport = new SSEClientTransport(new URL(config.url!))
    }

    const client = new Client(
      { name: 'gtm-os', version: '1.0.0' },
      { capabilities: {} }
    )

    try {
      await client.connect(transport)
      const tools = await this.discoverTools(config.id, client)

      const connection: McpConnection = {
        serverId: config.id,
        status: 'connected',
        tools,
        connectedAt: new Date().toISOString(),
      }

      this.connections.set(config.id, { client, connection })
      return connection
    } catch (err) {
      const connection: McpConnection = {
        serverId: config.id,
        status: 'error',
        tools: [],
        connectedAt: new Date().toISOString(),
        lastError: err instanceof Error ? err.message : String(err),
      }
      return connection
    }
  }

  disconnect(serverId: string): void {
    const entry = this.connections.get(serverId)
    if (entry) {
      entry.client.close().catch(() => {})
      this.connections.delete(serverId)
    }
  }

  private async discoverTools(serverId: string, client?: Client): Promise<McpToolDefinition[]> {
    const c = client ?? this.connections.get(serverId)?.client
    if (!c) return []

    const result = await c.listTools()
    return (result.tools ?? []).map(tool => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
      serverId,
    }))
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown> | undefined): Promise<unknown> {
    const entry = this.connections.get(serverId)
    if (!entry) throw new Error(`Server ${serverId} not connected`)

    const result = await entry.client.callTool({ name: toolName, arguments: args ?? {} })
    return result
  }

  getConnections(): McpConnection[] {
    return Array.from(this.connections.values()).map(e => e.connection)
  }

  getConnection(serverId: string): McpConnection | undefined {
    return this.connections.get(serverId)?.connection
  }

  async healthCheck(serverId: string): Promise<{ ok: boolean }> {
    const entry = this.connections.get(serverId)
    if (!entry) return { ok: false }
    try {
      await entry.client.listTools()
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }
}

export const mcpManager = new McpConnectionManager()
