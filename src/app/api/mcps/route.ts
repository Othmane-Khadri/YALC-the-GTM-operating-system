import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mcpServers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { mcpManager } from '@/lib/mcp/client'
import { registerMcpTools } from '@/lib/mcp/provider-bridge'
import { encrypt } from '@/lib/crypto'
import type { McpServerConfig } from '@/lib/mcp/types'

function safeJsonParse(value: unknown, fallback: unknown[] = []): unknown[] {
  if (!value || typeof value !== 'string') return fallback
  try { return JSON.parse(value) as unknown[] } catch { return fallback }
}

export async function GET() {
  try {
    const rows = await db.select().from(mcpServers)
    const connections = mcpManager.getConnections()

    const servers = rows.map(row => {
      const conn = connections.find(c => c.serverId === row.id)
      const parsedTools = safeJsonParse(row.discoveredTools)
      return {
        id: row.id,
        name: row.name,
        transport: row.transport,
        status: conn?.status ?? row.status ?? 'disconnected',
        toolCount: conn?.tools.length ?? parsedTools.length,
        tools: conn?.tools ?? parsedTools,
        lastConnectedAt: row.lastConnectedAt,
      }
    })

    return NextResponse.json({ servers })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch MCP servers'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, transport, command, args, url, env } = body

    const id = crypto.randomUUID()

    // Encrypt env vars if provided
    const encryptedEnv = env && Object.keys(env).length > 0
      ? encrypt(JSON.stringify(env))
      : null

    await db.insert(mcpServers).values({
      id,
      name,
      transport,
      command: command ?? null,
      args: args ? JSON.stringify(args) : null,
      url: url ?? null,
      env: encryptedEnv,
      status: 'disconnected',
    })

    // Build config for connection
    const config: McpServerConfig = {
      id,
      name,
      transport,
      command,
      args,
      url,
      env,
    }

    // Attempt connection
    const connection = await mcpManager.connect(config)

    // Register tools if connected
    if (connection.status === 'connected') {
      registerMcpTools(connection.tools)
    }

    // Update DB with status
    await db.update(mcpServers)
      .set({
        status: connection.status,
        lastConnectedAt: connection.status === 'connected' ? new Date().toISOString() : null,
        discoveredTools: JSON.stringify(connection.tools),
      })
      .where(eq(mcpServers.id, id))

    return NextResponse.json({
      server: { id, name, transport, status: connection.status },
      connection,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add MCP server'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
