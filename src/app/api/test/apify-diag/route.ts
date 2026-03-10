import { getRegistry } from '@/lib/providers/registry'

export const runtime = 'nodejs'

// Public GET diagnostic — no auth needed
export async function GET() {
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

  // Try starting a tiny actor (dry run — just checks if the API accepts the request)
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
  })
}
