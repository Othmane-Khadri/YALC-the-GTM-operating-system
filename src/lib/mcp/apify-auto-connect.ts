import { mcpManager } from './client'
import { registerMcpTools } from './provider-bridge'

const APIFY_MCP_ID = 'apify-mcp'
let initialized = false

/**
 * Ensure the Apify MCP server is connected via stdio transport.
 * Called lazily on first workflow execution or planner invocation.
 * No-ops if APIFY_TOKEN is not set or connection already active.
 */
export async function ensureApifyMcp(): Promise<void> {
  if (initialized) return
  if (!process.env.APIFY_TOKEN) return
  // Stdio transport cannot work in serverless (Vercel) — skip MCP, use direct HTTP via catalog
  if (process.env.VERCEL) { initialized = true; return }

  const existing = mcpManager.getConnection(APIFY_MCP_ID)
  if (existing?.status === 'connected') {
    initialized = true
    return
  }

  try {
    const connection = await mcpManager.connect({
      id: APIFY_MCP_ID,
      name: 'Apify Actors',
      transport: 'stdio',
      command: 'npx',
      args: ['@apify/actors-mcp-server', '--tools', 'actors'],
      env: { APIFY_TOKEN: process.env.APIFY_TOKEN },
    })

    if (connection.status === 'connected' && connection.tools.length > 0) {
      registerMcpTools(connection.tools)
      console.log(`[Apify MCP] Connected. ${connection.tools.length} tools discovered.`)
    } else if (connection.lastError) {
      console.warn(`[Apify MCP] Connection failed: ${connection.lastError}`)
    }

    initialized = true
  } catch (err) {
    console.warn('[Apify MCP] Auto-connect failed:', err instanceof Error ? err.message : err)
    initialized = true // Don't retry every request
  }
}
