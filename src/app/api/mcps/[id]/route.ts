import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mcpServers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { mcpManager } from '@/lib/mcp/client'
import { registerMcpTools, unregisterMcpTools } from '@/lib/mcp/provider-bridge'
import { encrypt } from '@/lib/crypto'
import type { McpServerConfig } from '@/lib/mcp/types'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const conn = mcpManager.getConnection(id)
  return NextResponse.json({
    server: {
      id: row.id,
      name: row.name,
      transport: row.transport,
      status: conn?.status ?? row.status ?? 'disconnected',
      tools: conn?.tools ?? (row.discoveredTools ? JSON.parse(row.discoveredTools as string) : []),
    },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()

  // Disconnect old connection
  unregisterMcpTools(id)
  mcpManager.disconnect(id)

  // Update DB
  const updates: Record<string, unknown> = {}
  if (body.name) updates.name = body.name
  if (body.transport) updates.transport = body.transport
  if (body.command !== undefined) updates.command = body.command
  if (body.args !== undefined) updates.args = JSON.stringify(body.args)
  if (body.url !== undefined) updates.url = body.url
  if (body.env !== undefined) updates.env = body.env && Object.keys(body.env).length > 0 ? encrypt(JSON.stringify(body.env)) : null

  await db.update(mcpServers).set(updates).where(eq(mcpServers.id, id))

  // Re-read and reconnect
  const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const config: McpServerConfig = {
    id: row.id,
    name: row.name,
    transport: row.transport as 'stdio' | 'sse',
    command: row.command ?? undefined,
    args: row.args ? JSON.parse(row.args as string) : undefined,
    url: row.url ?? undefined,
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

  return NextResponse.json({ server: { ...row, status: connection.status }, connection })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  unregisterMcpTools(id)
  mcpManager.disconnect(id)
  await db.delete(mcpServers).where(eq(mcpServers.id, id))

  return NextResponse.json({ ok: true })
}
