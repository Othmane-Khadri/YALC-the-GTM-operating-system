import { NextRequest } from 'next/server'
import { getRegistry } from '@/lib/providers/registry'
import { ProviderIntelligence } from '@/lib/providers/intelligence'
import type { ExecutionContext } from '@/lib/providers/types'
import { ensureApifyMcp } from '@/lib/mcp/apify-auto-connect'

export async function POST(req: NextRequest) {
  try {
    const { provider, query, maxResults } = await req.json() as {
      provider?: string
      query?: string
      maxResults?: number
    }

    // Ensure Apify MCP server is connected for dynamic discovery
    await ensureApifyMcp()

    const registry = getRegistry()
    const intelligence = new ProviderIntelligence()

    // Step 1: Resolve provider (test auto-selection if no provider specified)
    const stepType = 'search'
    const providerId = provider || 'apify-google-search'

    const executor = await registry.resolveAsync({ stepType, provider: providerId })
    const resolvedVia = executor.id === providerId ? 'exact' : 'intelligence'

    // Step 2: Health check
    const health = executor.healthCheck ? await executor.healthCheck() : { ok: true, message: 'No health check' }
    if (!health.ok) {
      return Response.json({ error: `Health check failed: ${health.message}` }, { status: 503 })
    }

    // Step 3: Execute with a small batch
    const context: ExecutionContext = {
      frameworkContext: '',
      batchSize: 5,
      totalRequested: maxResults || 5,
    }

    const stepInput = {
      stepIndex: 0,
      title: 'Apify E2E Test',
      stepType,
      provider: providerId,
      description: query || 'SaaS companies hiring SDRs',
      estimatedRows: maxResults || 5,
      config: { query: query || 'SaaS companies hiring SDRs' },
    }

    const startTime = Date.now()
    const allRows: Record<string, unknown>[] = []

    for await (const batch of executor.execute(stepInput, context)) {
      allRows.push(...batch.rows)
    }

    const latencyMs = Date.now() - startTime

    // Step 4: Record to intelligence
    await intelligence.recordExecution(
      executor.id,
      { stepType },
      { rowCount: allRows.length, latencyMs, costEstimate: 0 },
    )

    // Step 5: Test auto-selection after recording
    const bestAfter = await intelligence.getBestProvider({
      stepType,
      capabilities: ['search'],
    })

    return Response.json({
      success: true,
      resolvedProvider: executor.id,
      resolvedVia,
      health,
      rowCount: allRows.length,
      latencyMs,
      sampleRows: allRows.slice(0, 3),
      columns: executor.getColumnDefinitions(stepInput).map(c => c.key),
      intelligenceAfter: bestAfter,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Apify test failed'
    return Response.json({ error: message, stack: err instanceof Error ? err.stack : undefined }, { status: 500 })
  }
}
