import { getRegistry } from '@/lib/providers/registry'
import { OrthogonalProvider } from '@/lib/providers/builtin/orthogonal'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET() {
  const registry = getRegistry()
  const allProviders = registry.getAll()

  // Check env
  const hasToken = !!process.env.ORTHOGONAL_API_KEY
  const tokenPrefix = process.env.ORTHOGONAL_API_KEY?.slice(0, 10) ?? 'NOT SET'

  // Try resolving orthogonal provider
  let resolveResult = 'unknown'
  try {
    const executor = registry.resolve({ stepType: 'search', provider: 'orthogonal' })
    resolveResult = `${executor.id} (type: ${executor.type}, available: ${executor.isAvailable()})`
  } catch (err) {
    resolveResult = `ERROR: ${err instanceof Error ? err.message : err}`
  }

  // Health check
  let healthResult = 'skipped'
  if (hasToken) {
    try {
      const provider = new OrthogonalProvider()
      const health = await provider.healthCheck()
      healthResult = health.ok ? `OK: ${health.message}` : `FAILED: ${health.message}`
    } catch (err) {
      healthResult = `ERROR: ${err instanceof Error ? err.message : err}`
    }
  }

  // Sample search
  let searchResult: unknown = 'skipped'
  if (hasToken) {
    try {
      const provider = new OrthogonalProvider()
      const results = await provider.searchAPIs('find SaaS companies', 2)
      searchResult = {
        count: results.length,
        results: results.map(r => ({
          slug: r.slug,
          endpoints: r.endpoints.length,
          topEndpoint: r.endpoints[0] ?? null,
        })),
      }
    } catch (err) {
      searchResult = { error: err instanceof Error ? err.message : String(err) }
    }
  }

  return Response.json({
    timestamp: new Date().toISOString(),
    env: {
      ORTHOGONAL_API_KEY: hasToken ? `${tokenPrefix}...` : 'NOT SET',
      NODE_ENV: process.env.NODE_ENV,
    },
    providers: allProviders.map(p => ({
      id: p.id,
      type: p.type,
      capabilities: p.capabilities,
    })),
    resolveTest: resolveResult,
    health: healthResult,
    sampleSearch: searchResult,
  })
}
