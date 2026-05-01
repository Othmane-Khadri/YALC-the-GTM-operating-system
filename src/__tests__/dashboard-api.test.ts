/**
 * Tests for /api/dashboard/* — archetype-specific dashboard surface (C3).
 *
 * Each archetype (a/b/c/d) gets its own first-class route. The route is
 * read-only over the same disk layout as /api/today, filtered to the
 * single framework that archetype owns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

function agentsDir(): string {
  return join(TMP, '.gtm-os', 'agents')
}

function seedRun(
  framework: string,
  ranAt: string,
  opts: { error?: string; rows?: number; title?: string } = {},
) {
  const dir = join(agentsDir(), `${framework}.runs`)
  mkdirSync(dir, { recursive: true })
  const stamp = ranAt.replace(/[:.]/g, '-')
  const rows = Array.from({ length: opts.rows ?? 1 }).map((_, i) => ({ idx: i }))
  const payload: Record<string, unknown> = {
    title: opts.title ?? `${framework} run`,
    summary: `summary for ${framework}`,
    rows,
    ranAt,
  }
  if (opts.error) payload.error = opts.error
  writeFileSync(join(dir, `${stamp}.json`), JSON.stringify(payload))
}

function seedAwaitingGate(
  framework: string,
  runId: string,
  payload: Record<string, unknown>,
) {
  const dir = join(agentsDir(), `${framework}.runs`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${runId}.awaiting-gate.json`),
    JSON.stringify({ run_id: runId, framework, ...payload }),
  )
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-dashboard-api-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

describe('GET /api/dashboard/list', () => {
  it('lists all four archetypes with framework + title metadata', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/dashboard/list')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      archetypes: Array<{ id: string; framework: string; title: string }>
    }
    expect(body.archetypes).toHaveLength(4)
    const map = new Map(body.archetypes.map((a) => [a.id, a]))
    expect(map.get('a')?.framework).toBe('competitor-audience-mining')
    expect(map.get('b')?.framework).toBe('content-calendar-builder')
    expect(map.get('c')?.framework).toBe('outreach-campaign-builder')
    expect(map.get('d')?.framework).toBe('lead-magnet-builder')
  })
})

describe('GET /api/dashboard/:archetype', () => {
  it('returns 404 with a clear error for an unknown archetype letter', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/dashboard/z')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('unknown_archetype')
  })

  it('returns the expected payload shape for each archetype with no on-disk state', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    for (const id of ['a', 'b', 'c', 'd']) {
      const res = await app.request(`/api/dashboard/${id}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        archetype: { id: string; framework: string; title: string; description: string }
        installed: boolean
        active_runs: number
        last_successful_pass: string | null
        awaiting_gates: unknown[]
        recent_runs: unknown[]
        visualizations: Array<{ view_id: string; intent: string; generated: boolean }>
      }
      expect(body.archetype.id).toBe(id)
      expect(typeof body.archetype.framework).toBe('string')
      expect(typeof body.archetype.title).toBe('string')
      expect(body.installed).toBe(false)
      expect(body.active_runs).toBe(0)
      expect(body.last_successful_pass).toBeNull()
      expect(body.awaiting_gates).toEqual([])
      expect(body.recent_runs).toEqual([])
      // Each archetype's framework declares a default_visualization in its
      // bundled yaml so the dashboard always exposes at least one entry.
      expect(body.visualizations.length).toBeGreaterThanOrEqual(1)
      expect(body.visualizations[0].generated).toBe(false)
    }
  })

  it('includes runs and awaiting gates for the matching framework only', async () => {
    seedRun('competitor-audience-mining', '2026-04-29T11:00:00Z', { rows: 3 })
    seedRun('competitor-audience-mining', '2026-04-29T10:00:00Z', { rows: 1 })
    seedRun('content-calendar-builder', '2026-04-29T09:00:00Z', { rows: 5 })
    seedAwaitingGate('competitor-audience-mining', 'run-1', {
      step_index: 5,
      gate_id: 'approve-engagers',
      prompt: 'Approve top engagers.',
      payload: { foo: 'bar' },
      created_at: new Date().toISOString(),
    })
    const { createApp } = await import('../lib/server/index')
    const app = createApp()

    const resA = await app.request('/api/dashboard/a')
    const bodyA = (await resA.json()) as {
      active_runs: number
      last_successful_pass: string | null
      awaiting_gates: Array<{ gate_id: string; framework: string }>
      recent_runs: Array<{ ranAt: string }>
    }
    expect(bodyA.active_runs).toBe(2)
    expect(bodyA.last_successful_pass).toBe('2026-04-29T11:00:00Z')
    expect(bodyA.awaiting_gates).toHaveLength(1)
    expect(bodyA.awaiting_gates[0].gate_id).toBe('approve-engagers')
    expect(bodyA.awaiting_gates[0].framework).toBe('competitor-audience-mining')
    // Runs sorted newest-first.
    expect(bodyA.recent_runs[0].ranAt).toBe('2026-04-29T11:00:00Z')

    const resB = await app.request('/api/dashboard/b')
    const bodyB = (await resB.json()) as {
      active_runs: number
      awaiting_gates: unknown[]
    }
    expect(bodyB.active_runs).toBe(1)
    expect(bodyB.awaiting_gates).toEqual([])
  })

  it('ignores failed runs when computing last_successful_pass', async () => {
    seedRun('outreach-campaign-builder', '2026-04-29T12:00:00Z', { error: 'boom' })
    seedRun('outreach-campaign-builder', '2026-04-29T11:00:00Z', { rows: 2 })
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/dashboard/c')
    const body = (await res.json()) as { last_successful_pass: string | null; active_runs: number }
    expect(body.active_runs).toBe(2)
    expect(body.last_successful_pass).toBe('2026-04-29T11:00:00Z')
  })

  it('reflects installed status when the framework has been installed', async () => {
    const installedDir = join(TMP, '.gtm-os', 'frameworks', 'installed')
    mkdirSync(installedDir, { recursive: true })
    writeFileSync(
      join(installedDir, 'lead-magnet-builder.json'),
      JSON.stringify({
        name: 'lead-magnet-builder',
        display_name: 'Lead Magnet Builder',
        description: 'stub',
        installed_at: '2026-04-29T00:00:00Z',
        schedule: {},
        output: { destination: 'dashboard' },
        inputs: {},
      }),
    )
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/dashboard/d')
    const body = (await res.json()) as { installed: boolean }
    expect(body.installed).toBe(true)
  })
})
