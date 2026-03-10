import { getRegistry } from '@/lib/providers/registry'
import { runApifyActor } from '@/lib/providers/builtin/apify-base'
import type { ExecutionContext } from '@/lib/providers/types'

export const runtime = 'nodejs'
export const maxDuration = 120

// Public GET diagnostic — no auth needed
export async function GET(req: Request) {
  const url = new URL(req.url)
  const runTest = url.searchParams.get('run') === '1'

  const registry = getRegistry()
  const allProviders = registry.getAll()

  // Check env
  const hasApifyToken = !!process.env.APIFY_TOKEN
  const tokenPrefix = process.env.APIFY_TOKEN?.slice(0, 10) ?? 'NOT SET'

  // Try resolving a known provider
  let resolveResult = 'unknown'
  try {
    const executor = await registry.resolveAsync({ stepType: 'search', provider: 'apify-google-search' })
    resolveResult = `${executor.id} (type: ${executor.type}, available: ${executor.isAvailable()})`
  } catch (err) {
    resolveResult = `ERROR: ${err instanceof Error ? err.message : err}`
  }

  // Try Apify health check
  let healthResult = 'skipped'
  if (hasApifyToken) {
    try {
      const res = await fetch('https://api.apify.com/v2/users/me', {
        headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}` },
      })
      healthResult = res.ok ? `OK (${res.status})` : `FAILED (${res.status})`
    } catch (err) {
      healthResult = `ERROR: ${err instanceof Error ? err.message : err}`
    }
  }

  // Try resolving the actor via tilde URL
  let actorStartResult = 'skipped'
  if (hasApifyToken) {
    try {
      const res = await fetch('https://api.apify.com/v2/acts/apify~google-search-scraper', {
        headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}` },
      })
      actorStartResult = res.ok ? `Actor exists (${res.status})` : `Actor NOT FOUND (${res.status})`
    } catch (err) {
      actorStartResult = `ERROR: ${err instanceof Error ? err.message : err}`
    }
  }

  // If ?run=1, actually execute the full provider pipeline
  let executionResult: Record<string, unknown> = { skipped: true }
  if (runTest && hasApifyToken) {
    try {
      // Test 1: Direct runApifyActor call
      const startTime = Date.now()
      const rawResults = await runApifyActor('apify/google-search-scraper', {
        queries: 'SaaS companies France',
        maxPagesPerQuery: 1,
        resultsPerPage: 3,
      })
      const directMs = Date.now() - startTime

      // Test 2: Full provider pipeline via registry
      const executor = await registry.resolveAsync({ stepType: 'search', provider: 'apify-google-search' })
      const context: ExecutionContext = {
        frameworkContext: '',
        batchSize: 5,
        totalRequested: 3,
      }
      const stepInput = {
        stepIndex: 0,
        title: 'Diagnostic Test',
        stepType: 'search',
        provider: 'apify-google-search',
        description: 'SaaS companies France',
        estimatedRows: 3,
        config: { query: 'SaaS companies France' },
      }

      const pipelineStart = Date.now()
      const allRows: Record<string, unknown>[] = []
      for await (const batch of executor.execute(stepInput, context)) {
        allRows.push(...batch.rows)
      }
      const pipelineMs = Date.now() - pipelineStart

      executionResult = {
        directCall: {
          rawResultCount: rawResults.length,
          hasOrganicResults: rawResults.some(r => Array.isArray(r.organicResults)),
          firstResultKeys: rawResults[0] ? Object.keys(rawResults[0]).slice(0, 10) : [],
          latencyMs: directMs,
        },
        pipeline: {
          resolvedTo: executor.id,
          resolvedType: executor.type,
          rowCount: allRows.length,
          sampleRow: allRows[0] ?? null,
          latencyMs: pipelineMs,
        },
      }
    } catch (err) {
      executionResult = {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5) : undefined,
      }
    }
  }

  return Response.json({
    timestamp: new Date().toISOString(),
    env: {
      APIFY_TOKEN: hasApifyToken ? `${tokenPrefix}...` : 'NOT SET',
      VERCEL: process.env.VERCEL ?? 'not set',
      NODE_ENV: process.env.NODE_ENV,
    },
    providers: allProviders.map(p => ({
      id: p.id,
      type: p.type,
      capabilities: p.capabilities,
    })),
    resolveTest: resolveResult,
    apifyHealth: healthResult,
    actorCheck: actorStartResult,
    execution: executionResult,
  })
}
