/**
 * Tests for /api/skills/* — the SPA's skill catalog + runner (0.9.C).
 *
 * Each test stubs HOME so the markdown skill loader sees a clean
 * `~/.gtm-os/skills/` (or none), and exercises the in-process registry
 * via the real Hono app — no mocks of the registry itself.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-skills-api-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

describe('GET /api/skills/list', () => {
  it('lists every registered skill with metadata', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/skills/list')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      total: number
      skills: Array<{ id: string; name: string; category: string }>
    }
    expect(body.total).toBeGreaterThan(0)
    // Builtin: find-companies is registered unconditionally.
    expect(body.skills.find((s) => s.id === 'find-companies')).toBeDefined()
  })

  it('filters by ?category= when supplied', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/skills/list?category=outreach')
    const body = (await res.json()) as {
      skills: Array<{ category: string }>
    }
    for (const s of body.skills) {
      expect(s.category).toBe('outreach')
    }
  })
})

describe('GET /api/skills/:name', () => {
  it('returns the full skill metadata for a known id', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/skills/find-companies')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      id: string
      inputSchema: Record<string, unknown>
      outputSchema: Record<string, unknown>
    }
    expect(body.id).toBe('find-companies')
    expect(body.inputSchema).toBeDefined()
    expect(body.outputSchema).toBeDefined()
  })

  it('404s for an unknown skill', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/skills/no-such-skill')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('unknown_skill')
  })
})

describe('POST /api/skills/run/:name', () => {
  it('rejects calls missing required inputs with 400', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/skills/run/find-companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; missing: string[] }
    expect(body.error).toBe('missing_inputs')
    expect(Array.isArray(body.missing)).toBe(true)
  })

  it('404s on the run endpoint for an unknown skill', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/skills/run/no-such-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404)
  })
})
