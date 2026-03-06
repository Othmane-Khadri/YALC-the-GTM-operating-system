import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mcpServers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { mcpManager } from '@/lib/mcp/client'
import { registerMcpTools } from '@/lib/mcp/provider-bridge'
import { encrypt } from '@/lib/crypto'
import type { McpServerConfig } from '@/lib/mcp/types'

export async function GET() {
  const rows = await db.select().from(mcpServers)
  const connections = mcpManager.getConnections()

  const servers = rows.map(row => {
    const conn = connections.find(c => c.serverId === row.id)
    return {
      id: row.id,
      name: row.name,
      transport: row.transport,
      status: conn?.status ?? row.status ?? 'disconnected',
      toolCount: conn?.tools.length ?? (row.discoveredTools ? JSON.parse(row.discoveredTools as string).length : 0),
      tools: conn?.tools ?? (row.discoveredTools ? JSON.parse(row.discoveredTools as string) : []),
      lastConnectedAt: row.lastConnectedAt,
    }
  })

  return NextResponse.json({ servers })
}

export async function POST(req: NextRequest) {
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
}
