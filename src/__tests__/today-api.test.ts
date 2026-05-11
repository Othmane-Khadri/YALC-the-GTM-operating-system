/**
 * Tests for /api/today/* — the SPA's daily feed surface (0.9.C).
 *
 * Each test seeds a fake `~/.gtm-os/agents/<framework>.runs/*.json` tree
 * (and optionally an awaiting-gate file) under a stubbed HOME, then drives
 * the Hono app via `app.request()`. No network, same pattern the other
 * API tests use.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

function agentsDir(): string {
  return join(TMP, '.gtm-os', 'agents')
}

function seedRun(framework: string, ranAt: string, opts: { error?: string; rows?: number } = {}) {
  const dir = join(agentsDir(), `${framework}.runs`)
  mkdirSync(dir, { recursive: true })
  const stamp = ranAt.replace(/[:.]/g, '-')
  const rows = Array.from({ length: opts.rows ?? 1 }).map((_, i) => ({ idx: i }))
  const payload: Record<string, unknown> = {
    title: `${framework} run`,
    summary: `summary for ${framework}`,
    rows,
    ranAt,
  }
  if (opts.error) payload.error = opts.error
  writeFileSync(join(dir, `${stamp}.json`), JSON.stringify(payload))
}

function seedAwaitingGate(framework: string, payload: Record<string, unknown>) {
  mkdirSync(agentsDir(), { recursive: true })
  writeFileSync(
    join(agentsDir(), `${framework}.awaiting-gate.json`),
    JSON.stringify(payload),
  )
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-today-api-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

describe('GET /api/today/feed', () => {
  it('returns an empty feed when no agents have run', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/today/feed')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
  })

  it('lists framework runs sorted newest-first', async () => {
    seedRun('alpha', '2026-04-29T10:00:00Z')
    seedRun('beta', '2026-04-29T11:00:00Z')
    seedRun('alpha', '2026-04-29T09:00:00Z')
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/today/feed')
    const body = (await res.json()) as {
      items: Array<{ type: string; framework: string; ranAt: string }>
    }
    expect(body.items.length).toBe(3)
    // Newest first.
    expect(body.items[0].ranAt).toBe('2026-04-29T11:00:00Z')
    expect(body.items[0].framework).toBe('beta')
    expect(body.items[2].ranAt).toBe('2026-04-29T09:00:00Z')
  })

  it('surfaces failed runs with their error message', async () => {
    seedRun('alpha', '2026-04-29T10:00:00Z', { error: 'firecrawl 402' })
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/today/feed')
    const body = (await res.json()) as {
      items: Array<{ type: string; error: string | null }>
    }
    const run = body.items[0]
    expect(run.type).toBe('run')
    expect(run.error).toBe('firecrawl 402')
  })

  it('mixes awaiting-gate items into the feed using the documented schema', async () => {
    // Use a recent timestamp for the gate so it stays inside the default
    // 72h timeout window regardless of when the suite runs. The run uses a
    // slightly older recent timestamp so the gate sorts ahead of it.
    const gateCreatedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString() // 30 min ago
    const runRanAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2h ago
    seedRun('alpha', runRanAt)
    seedAwaitingGate('alpha', {
      run_id: 'r1',
      framework: 'alpha',
      step_index: 2,
      gate_id: 'qual_review',
      prompt: 'Approve qualification batch?',
      payload: { rows: 12 },
      created_at: gateCreatedAt,
    })
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/today/feed')
    const body = (await res.json()) as {
      items: Array<{ type: string; framework: string; gate_id?: string; created_at?: string }>
    }
    const gate = body.items.find((i) => i.type === 'awaiting_gate')
    expect(gate).toBeDefined()
    expect(gate?.gate_id).toBe('qual_review')
    expect(gate?.framework).toBe('alpha')
    // Mixed sort puts the more recent gate before the older run.
    expect(body.items[0].type).toBe('awaiting_gate')
  })

  it('also discovers runs under the newer agents/<name>/runs/ layout', async () => {
    const dir = join(agentsDir(), 'gamma', 'runs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, '2026-04-29.json'),
      JSON.stringify({
        title: 'gamma run',
        summary: 'newer layout',
        rows: [],
        ranAt: '2026-04-29T12:00:00Z',
      }),
    )
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/today/feed')
    const body = (await res.json()) as {
      items: Array<{ type: string; framework: string }>
    }
    expect(body.items.find((i) => i.framework === 'gamma')).toBeDefined()
  })
})
