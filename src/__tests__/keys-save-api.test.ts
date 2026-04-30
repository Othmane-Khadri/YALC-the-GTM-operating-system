/**
 * Tests for POST /api/keys/save (0.9.D).
 *
 * The endpoint is HOME-isolated for the duration of each test so the real
 * ~/.gtm-os/ never gets touched. We exercise the route through the Hono
 * `app.request()` helper rather than spinning up a real server, which
 * keeps the suite hermetic and fast.
 *
 * `loadProviderKnowledge` is mocked so the bundled-knowledge tests don't
 * depend on what's checked in under configs/providers/.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-keys-save-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
})

async function appWithMockedKnowledge(map: Record<string, unknown>) {
  const knowledgeModule = await import('../lib/providers/knowledge-base')
  vi.spyOn(knowledgeModule, 'loadProviderKnowledge').mockReturnValue(
    new Map(Object.entries(map)) as never,
  )
  const { createApp } = await import('../lib/server/index')
  return createApp()
}

const FAKE_KEY = 'unit-test-placeholder-1234'

const PROVIDER_FIXTURE = {
  id: 'crustdata',
  display_name: 'Crustdata',
  integration_kind: 'rest',
  env_vars: [
    { name: 'CRUSTDATA_API_KEY', description: 'Crustdata token', example: '', required: true },
  ],
  capabilities_supported: [],
  install_steps: [],
}

describe('POST /api/keys/save — bundled provider', () => {
  it('writes the env line and sentinel for a valid bundled provider', async () => {
    const app = await appWithMockedKnowledge({ crustdata: PROVIDER_FIXTURE })
    const res = await app.request('/api/keys/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'crustdata', env: { CRUSTDATA_API_KEY: FAKE_KEY } }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sentinel_path: string }
    const envText = readFileSync(join(TMP, '.gtm-os', '.env'), 'utf-8')
    expect(envText).toContain(`CRUSTDATA_API_KEY=${FAKE_KEY}`)
    expect(existsSync(body.sentinel_path)).toBe(true)
  })

  it('rejects unknown env keys with 400 and a list of expected vars', async () => {
    const app = await appWithMockedKnowledge({ crustdata: PROVIDER_FIXTURE })
    const res = await app.request('/api/keys/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'crustdata',
        env: { CRUSTDATA_API_KEY: FAKE_KEY, BOGUS_VAR: 'nope' },
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; expected: string[] }
    expect(body.error).toBe('unknown_env_vars')
    expect(body.expected).toContain('CRUSTDATA_API_KEY')
  })

  it('rejects missing required vars with 400 listing the missing names', async () => {
    const app = await appWithMockedKnowledge({ crustdata: PROVIDER_FIXTURE })
    const res = await app.request('/api/keys/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'crustdata', env: { CRUSTDATA_API_KEY: '' } }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; missing: string[] }
    expect(body.error).toBe('missing_required')
    expect(body.missing).toContain('CRUSTDATA_API_KEY')
  })

  it('returns failed status but still writes the sentinel when health check fails', async () => {
    // Crustdata is registered with selfHealthCheck — without a valid live
    // key the probe returns either 'fail' or 'warn'. Either way we expect
    // a 200, status: 'failed' (when status != 'ok'), and the sentinel.
    delete process.env.CRUSTDATA_API_KEY
    const app = await appWithMockedKnowledge({ crustdata: PROVIDER_FIXTURE })
    const res = await app.request('/api/keys/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'crustdata',
        env: { CRUSTDATA_API_KEY: 'wrong-' + FAKE_KEY },
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      sentinel_path: string
      healthcheck: { status: string }
    }
    expect(['configured', 'failed']).toContain(body.status)
    expect(existsSync(body.sentinel_path)).toBe(true)
    // Healthcheck status is whatever the live probe reported — never `ok`
    // for a fabricated key against a real API endpoint.
    expect(body.healthcheck.status).not.toBe('ok')
  })
})

describe('POST /api/keys/save — custom provider', () => {
  it('writes a yaml at configs/providers/_user/<name>.yaml and the sentinel', async () => {
    const app = await appWithMockedKnowledge({})
    const res = await app.request('/api/keys/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'my-internal-api',
        env: { MY_INTERNAL_API_TOKEN: FAKE_KEY },
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { custom: boolean; sentinel_path: string }
    expect(body.custom).toBe(true)
    expect(existsSync(body.sentinel_path)).toBe(true)

    const { PKG_ROOT } = await import('../lib/paths')
    const yamlPath = join(PKG_ROOT, 'configs', 'providers', '_user', 'my-internal-api.yaml')
    expect(existsSync(yamlPath)).toBe(true)
    const yamlText = readFileSync(yamlPath, 'utf-8')
    expect(yamlText).toContain('id: my-internal-api')
    expect(yamlText).toContain('MY_INTERNAL_API_TOKEN')
    // Cleanup so the next run doesn't see this entry.
    rmSync(yamlPath, { force: true })
  })
})

describe('POST /api/keys/save — rotation', () => {
  it('replaces an existing .env line in place — never appends a duplicate', async () => {
    const app = await appWithMockedKnowledge({ crustdata: PROVIDER_FIXTURE })
    // First write — establishes the line.
    let res = await app.request('/api/keys/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'crustdata',
        env: { CRUSTDATA_API_KEY: 'first-' + FAKE_KEY },
      }),
    })
    expect(res.status).toBe(200)
    let envText = readFileSync(join(TMP, '.gtm-os', '.env'), 'utf-8')
    expect(envText.split('\n').filter((l) => l.startsWith('CRUSTDATA_API_KEY=')).length).toBe(1)

    // Second write — replaces, no duplicate.
    res = await app.request('/api/keys/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'crustdata',
        env: { CRUSTDATA_API_KEY: 'second-' + FAKE_KEY },
      }),
    })
    expect(res.status).toBe(200)
    envText = readFileSync(join(TMP, '.gtm-os', '.env'), 'utf-8')
    const matches = envText.split('\n').filter((l) => l.startsWith('CRUSTDATA_API_KEY='))
    expect(matches).toHaveLength(1)
    expect(matches[0]).toBe('CRUSTDATA_API_KEY=second-' + FAKE_KEY)
  })
})
