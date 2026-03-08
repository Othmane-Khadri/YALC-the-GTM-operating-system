import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createGtmOsServer } from '@/lib/mcp/server'

export const runtime = 'nodejs'

function checkAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization')
  const expectedToken = process.env.MCP_SERVER_TOKEN
  if (!expectedToken) return false
  const expected = `Bearer ${expectedToken}`
  if (!authHeader || authHeader.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
}

export async function GET(request: NextRequest) {
  const expectedToken = process.env.MCP_SERVER_TOKEN
  if (!expectedToken) {
    return new NextResponse('MCP server not configured. Set MCP_SERVER_TOKEN env var.', { status: 503 })
  }
  if (!checkAuth(request)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Return server info / tool list as JSON for basic discovery
  const server = createGtmOsServer()
  return NextResponse.json({
    name: 'gtm-os',
    version: '1.0.0',
    description: 'GTM-OS MCP Server — exposes GTM capabilities to external AI agents',
    tools: ['search_leads', 'get_framework', 'get_learnings', 'qualify_lead', 'get_available_providers'],
  })
}

export async function POST(request: NextRequest) {
  const expectedToken = process.env.MCP_SERVER_TOKEN
  if (!expectedToken) {
    return new NextResponse('MCP server not configured', { status: 503 })
  }
  if (!checkAuth(request)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Handle JSON-RPC style tool calls directly
  const body = await request.json()
  const { tool, arguments: args } = body

  if (!tool) {
    return NextResponse.json({ error: 'Missing "tool" field' }, { status: 400 })
  }

  try {
    // Import and call handlers directly for the REST API surface
    const { handleSearchLeads, handleGetFramework, handleGetLearnings, handleQualifyLead, handleGetAvailableProviders } = await import('@/lib/mcp/server-tools')

    let result
    switch (tool) {
      case 'search_leads':
        result = await handleSearchLeads(args ?? {})
        break
      case 'get_framework':
        result = await handleGetFramework(args ?? {})
        break
      case 'get_learnings':
        result = await handleGetLearnings(args ?? {})
        break
      case 'qualify_lead':
        result = await handleQualifyLead(args ?? {})
        break
      case 'get_available_providers':
        result = await handleGetAvailableProviders()
        break
      default:
        return NextResponse.json({ error: `Unknown tool: ${tool}` }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
