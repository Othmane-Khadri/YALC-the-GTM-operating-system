/**
 * Tests for /api/keys/* — the SPA's provider list + health surface (0.9.C).
 *
 * The provider registry is a process-global singleton; each test resets
 * vitest modules so the registry initialises fresh against the stubbed
 * env. We exercise the real registry rather than mocking it so the
 * routes' contract with `getRegistryReady()` is genuinely covered.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-keys-api-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

describe('GET /api/keys/list', () => {
  it('returns the full provider registry with status mapping', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/keys/list')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      providers: Array<{
        id: string
        status: 'green' | 'red' | 'gray'
        capabilities: string[]
      }>
    }
    expect(body.providers.length).toBeGreaterThan(0)
    const ids = body.providers.map((p) => p.id)
    // Builtin providers always register.
    expect(ids).toContain('mock')
    // Status uses the ternary palette.
    for (const p of body.providers) {
      expect(['green', 'red', 'gray']).toContain(p.status)
    }
  })

  it('reports `green` for the always-available mock provider', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/keys/list')
    const body = (await res.json()) as {
      providers: Array<{ id: string; status: string }>
    }
    const mock = body.providers.find((p) => p.id === 'mock')!
    expect(mock.status).toBe('green')
  })
})

describe('POST /api/keys/test/:provider', () => {
  it('returns 404 for an unknown provider id', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/keys/test/no-such-provider', { method: 'POST' })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('unknown_provider')
  })

  it('runs the providers selfHealthCheck and reports the result', async () => {
    // FullEnrich's selfHealthCheck reports `warn` when no API key is set,
    // which is a deterministic offline-friendly signal.
    delete process.env.FIRECRAWL_API_KEY
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/keys/test/firecrawl', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; status: string; detail: string }
    // Without a key the firecrawl probe returns `warn` with a key-not-set
    // detail; with a stale key it might return `fail` but still 200.
    expect(['ok', 'warn', 'fail']).toContain(body.status)
    expect(typeof body.detail).toBe('string')
  })
})
