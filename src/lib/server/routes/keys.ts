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
 *   GET  /api/keys/knowledge    — bundled provider knowledge entries
 *   POST /api/keys/test/:id     — run that provider's selfHealthCheck/healthCheck
 *   POST /api/keys/save         — write user-supplied env vars to ~/.gtm-os/.env,
 *                                 reload, run selfHealthCheck, drop a sentinel
 */

import { Hono } from 'hono'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import yaml from 'js-yaml'

export const keysRoutes = new Hono()

/** Mask any field whose name reads like a secret. Used for safe logging. */
function maskSecretFields<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  const re = /key|secret|token|password/i
  for (const [k, v] of Object.entries(obj)) {
    out[k] = re.test(k) && typeof v === 'string' ? '***' : v
  }
  return out as T
}

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

// ─── GET /api/keys/knowledge ────────────────────────────────────────────────
//
// Returns bundled + user provider knowledge so the /keys/connect SPA can
// pre-fill its env-var schema without round-tripping through the CLI.

keysRoutes.get('/knowledge', async (c) => {
  const { loadProviderKnowledge } = await import('../../providers/knowledge-base.js')
  const map = loadProviderKnowledge()
  const entries = Array.from(map.values()).map((k) => ({
    id: k.id,
    display_name: k.display_name,
    homepage: k.homepage ?? null,
    docs_url: k.docs_url ?? null,
    key_acquisition_url: k.key_acquisition_url ?? null,
    integration_kind: k.integration_kind,
    env_vars: k.env_vars.map((ev) => ({
      name: ev.name,
      description: ev.description ?? '',
      example: ev.example ?? '',
      required: ev.required !== false,
    })),
    install_steps: k.install_steps,
  }))
  return c.json({ providers: entries })
})

// ─── POST /api/keys/save ────────────────────────────────────────────────────
//
// Body shape:
//   { provider: string, env: { KEY: VALUE, ... } }
//
// Behavior:
//   - Validates `env` against the provider's bundled schema (when known).
//     Unknown keys → 400. Missing required keys → 400.
//   - Writes via `applyCollectedKeysToEnv()` so existing .env lines are
//     replaced in place, never duplicated.
//   - Reloads dotenv with override:true so the new values land in
//     process.env this run.
//   - Calls the provider's selfHealthCheck() (when registered).
//   - Writes ~/.gtm-os/_handoffs/keys/<provider>.ready (the sentinel
//     signals "form was submitted", NOT "keys work" — the CLI reads
//     status separately from the JSON response or by re-polling).
//   - Custom (unknown) provider: writes
//     configs/providers/_user/<name>.yaml with a synthesized schema.
//   - NEVER logs key values. The route logs nothing on the happy path; if
//     downstream code needs to log a copy of the response, it must run it
//     through `maskSecretFields()` first.

interface SaveBody {
  provider?: unknown
  env?: unknown
}

keysRoutes.post('/save', async (c) => {
  let body: SaveBody = {}
  try {
    body = (await c.req.json()) as SaveBody
  } catch {
    return c.json({ error: 'bad_request', message: 'JSON body required' }, 400)
  }

  if (typeof body.provider !== 'string' || !/^[a-z][a-z0-9-]*$/.test(body.provider)) {
    return c.json(
      { error: 'bad_request', message: 'provider must be a lowercase slug (a-z0-9-)' },
      400,
    )
  }
  if (!body.env || typeof body.env !== 'object' || Array.isArray(body.env)) {
    return c.json({ error: 'bad_request', message: 'env must be an object of KEY=VALUE pairs' }, 400)
  }
  const provider = body.provider
  const envIn = body.env as Record<string, unknown>

  for (const [k, v] of Object.entries(envIn)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) {
      return c.json({ error: 'bad_request', message: `env key "${k}" must be UPPER_SNAKE_CASE` }, 400)
    }
    if (typeof v !== 'string') {
      return c.json({ error: 'bad_request', message: `env["${k}"] must be a string` }, 400)
    }
  }

  const home = process.env.HOME ?? homedir()
  const gtmDir = join(home, '.gtm-os')
  const envPath = join(gtmDir, '.env')
  const handoffDir = join(gtmDir, '_handoffs', 'keys')
  if (!existsSync(gtmDir)) mkdirSync(gtmDir, { recursive: true })

  const { loadProviderKnowledge } = await import('../../providers/knowledge-base.js')
  const knowledgeMap = loadProviderKnowledge()
  const knowledge = knowledgeMap.get(provider)

  let isCustom = false
  if (knowledge) {
    const expectedNames = knowledge.env_vars.map((ev) => ev.name)
    const expectedSet = new Set(expectedNames)
    const unknown = Object.keys(envIn).filter((k) => !expectedSet.has(k))
    if (unknown.length > 0) {
      return c.json(
        {
          error: 'unknown_env_vars',
          message: `Unknown env vars for provider "${provider}": ${unknown.join(', ')}`,
          expected: expectedNames,
        },
        400,
      )
    }
    const requiredMissing = knowledge.env_vars
      .filter((ev) => ev.required !== false)
      .map((ev) => ev.name)
      .filter((name) => {
        const v = envIn[name]
        return typeof v !== 'string' || v.trim() === ''
      })
    if (requiredMissing.length > 0) {
      return c.json(
        {
          error: 'missing_required',
          message: `Missing required env vars: ${requiredMissing.join(', ')}`,
          missing: requiredMissing,
        },
        400,
      )
    }
  } else {
    // Custom provider — synthesize a yaml under configs/providers/_user/.
    isCustom = true
    const userYaml = {
      id: provider,
      display_name: provider,
      integration_kind: 'rest',
      env_vars: Object.keys(envIn).map((name) => ({
        name,
        description: 'Custom provider env var (set via /keys/connect).',
        example: '',
        required: true,
      })),
      capabilities_supported: [],
      install_steps: [
        'Custom provider — env vars are set in ~/.gtm-os/.env via /keys/connect.',
      ],
      test_query: null,
    }
    const { PKG_ROOT } = await import('../../paths.js')
    const userDir = join(PKG_ROOT, 'configs', 'providers', '_user')
    if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, `${provider}.yaml`), yaml.dump(userYaml, { lineWidth: 100 }), 'utf-8')
  }

  // Write env values. `applyCollectedKeysToEnv` replaces in place, never
  // duplicates lines that already exist (covers the rotation flow).
  const collected: Record<string, string> = {}
  for (const [k, v] of Object.entries(envIn)) collected[k] = String(v)
  const { applyCollectedKeysToEnv } = await import('../../onboarding/env-template.js')
  applyCollectedKeysToEnv(envPath, collected)

  // Reload dotenv so the new values take effect this run.
  if (existsSync(envPath)) {
    loadEnv({ path: envPath, quiet: true, override: true })
  }

  // Run selfHealthCheck — best-effort. Failures still let us write the
  // sentinel so the CLI can advance to its retry/rotate UX.
  let healthcheck: { status: string; detail: string; ok: boolean } = {
    status: 'unsupported',
    detail: isCustom
      ? 'Custom provider — health check unavailable.'
      : 'Provider not registered in this runtime.',
    ok: false,
  }
  try {
    const { getRegistryReady } = await import('../../providers/registry.js')
    const registry = await getRegistryReady()
    const internal = (registry as unknown as { providers: Map<string, unknown> }).providers
    const executor = internal.get(provider) as
      | {
          selfHealthCheck?: () => Promise<{ status: string; detail: string }>
          healthCheck?: () => Promise<{ ok: boolean; message: string }>
        }
      | undefined
    if (executor?.selfHealthCheck) {
      const r = await executor.selfHealthCheck()
      healthcheck = { status: r.status, detail: r.detail, ok: r.status === 'ok' }
    } else if (executor?.healthCheck) {
      const r = await executor.healthCheck()
      healthcheck = { status: r.ok ? 'ok' : 'fail', detail: r.message, ok: r.ok }
    }
  } catch (err) {
    healthcheck = {
      status: 'fail',
      detail: err instanceof Error ? err.message : 'health probe threw',
      ok: false,
    }
  }

  // Sentinel — written regardless of healthcheck outcome.
  if (!existsSync(handoffDir)) mkdirSync(handoffDir, { recursive: true })
  const sentinelPath = join(handoffDir, `${provider}.ready`)
  writeFileSync(
    sentinelPath,
    JSON.stringify(
      {
        provider,
        ts: new Date().toISOString(),
        healthcheck_status: healthcheck.status,
      },
      null,
      2,
    ),
    'utf-8',
  )

  return c.json(
    maskSecretFields({
      status: healthcheck.ok ? 'configured' : 'failed',
      provider,
      healthcheck,
      sentinel_path: sentinelPath,
      custom: isCustom,
    }),
  )
})
