import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mcpServers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { mcpManager } from '@/lib/mcp/client'
import { registerMcpTools, unregisterMcpTools } from '@/lib/mcp/provider-bridge'
import { decrypt } from '@/lib/crypto'
import type { McpServerConfig } from '@/lib/mcp/types'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Unregister old tools first
  unregisterMcpTools(id)

  let env: Record<string, string> | undefined
  if (row.env) {
    try {
      env = JSON.parse(decrypt(row.env as string))
    } catch {
      // env decryption failed — proceed without
    }
  }

  const config: McpServerConfig = {
    id: row.id,
    name: row.name,
    transport: row.transport as 'stdio' | 'sse',
    command: row.command ?? undefined,
    args: row.args ? JSON.parse(row.args as string) : undefined,
    url: row.url ?? undefined,
    env,
  }

  const connection = await mcpManager.connect(config)

  if (connection.status === 'connected') {
    registerMcpTools(connection.tools)
  }

  await db.update(mcpServers).set({
    status: connection.status,
    lastConnectedAt: connection.status === 'connected' ? new Date().toISOString() : null,
    discoveredTools: JSON.stringify(connection.tools),
  }).where(eq(mcpServers.id, id))

  return NextResponse.json({ status: connection.status, tools: connection.tools })
}
