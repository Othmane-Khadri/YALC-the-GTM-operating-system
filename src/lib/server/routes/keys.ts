/**
 * /api/keys/* — provider list + status surface for the SPA's /keys page.
 *
 * Reads the provider registry (builtin + MCP) and reports:
 *   - id / name / description / type
 *   - capability list
 *   - status = 'green' | 'red' | 'gray' (gray = not configured / not available)
 *   - selfHealthCheck result (when the user explicitly invokes a probe)
 *
 * Endpoints:
 *   GET  /api/keys/list         — registry snapshot with availability
 *   POST /api/keys/test/:id     — run that provider's selfHealthCheck/healthCheck
 */

import { Hono } from 'hono'

export const keysRoutes = new Hono()

interface KeyEntry {
  id: string
  name: string
  description: string
  type: 'builtin' | 'mcp' | 'mock'
  capabilities: string[]
  /** 'green' = available; 'red' = registered but errored; 'gray' = not configured. */
  status: 'green' | 'red' | 'gray'
  /** Whether the provider exposes a self-describing health probe. */
  hasHealthProbe: boolean
}

function mapStatus(reg: 'active' | 'disconnected' | 'error'): KeyEntry['status'] {
  if (reg === 'active') return 'green'
  if (reg === 'error') return 'red'
  // 'disconnected' typically means missing API key — treat as not configured.
  return 'gray'
}

// ─── GET /api/keys/list ─────────────────────────────────────────────────────

keysRoutes.get('/list', async (c) => {
  const { getRegistryReady } = await import('../../providers/registry.js')
  const registry = await getRegistryReady()
  const all = registry.getAll()
  const entries: KeyEntry[] = all.map((p) => {
    const executor = (registry as unknown as { providers: Map<string, unknown> }).providers.get(p.id) as
      | {
          selfHealthCheck?: () => Promise<unknown>
          healthCheck?: () => Promise<unknown>
        }
      | undefined
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type,
      capabilities: p.capabilities as string[],
      status: mapStatus(p.status),
      hasHealthProbe: !!(executor?.selfHealthCheck || executor?.healthCheck),
    }
  })
  return c.json({ providers: entries })
})

// ─── POST /api/keys/test/:provider ──────────────────────────────────────────

keysRoutes.post('/test/:provider', async (c) => {
  const id = c.req.param('provider')
  if (!id) return c.json({ error: 'bad_request', message: 'provider id required' }, 400)

  const { getRegistryReady } = await import('../../providers/registry.js')
  const registry = await getRegistryReady()
  // Reach into the underlying map — `getAll()` strips method references.
  const internal = (registry as unknown as { providers: Map<string, unknown> }).providers
  const executor = internal.get(id) as
    | {
        id: string
        name: string
        selfHealthCheck?: () => Promise<{ status: string; detail: string }>
        healthCheck?: () => Promise<{ ok: boolean; message: string }>
      }
    | undefined

  if (!executor) {
    return c.json(
      { error: 'unknown_provider', message: `Unknown provider id "${id}".` },
      404,
    )
  }

  // Prefer selfHealthCheck (richer payload), fall back to legacy healthCheck.
  if (executor.selfHealthCheck) {
    try {
      const r = await executor.selfHealthCheck()
      return c.json({ ok: r.status === 'ok', status: r.status, detail: r.detail })
    } catch (err) {
      return c.json(
        {
          ok: false,
          status: 'fail',
          detail: err instanceof Error ? err.message : 'health probe threw',
        },
        500,
      )
    }
  }
  if (executor.healthCheck) {
    try {
      const r = await executor.healthCheck()
      return c.json({ ok: r.ok, status: r.ok ? 'ok' : 'fail', detail: r.message })
    } catch (err) {
      return c.json(
        {
          ok: false,
          status: 'fail',
          detail: err instanceof Error ? err.message : 'health probe threw',
        },
        500,
      )
    }
  }

  return c.json(
    {
      ok: false,
      status: 'unsupported',
      detail: 'Provider does not expose a health probe.',
    },
    501,
  )
})
