/**
 * Tests for /visualize/<view_id> + /api/visualize/* — page + metadata routes.
 *
 * Same pattern as today-api.test.ts: stub HOME under tmpdir, write a fake
 * sidecar + HTML, drive the Hono app via app.request().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

function vizDir(): string {
  return join(TMP, '.gtm-os', 'visualizations')
}

function seedVisualization(viewId: string, html: string, meta: Record<string, unknown>) {
  mkdirSync(vizDir(), { recursive: true })
  writeFileSync(join(vizDir(), `${viewId}.html`), html, 'utf-8')
  writeFileSync(
    join(vizDir(), `${viewId}.json`),
    JSON.stringify({ view_id: viewId, ...meta }, null, 2),
    'utf-8',
  )
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-viz-route-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

describe('GET /visualize/:viewId', () => {
  it('serves the saved HTML with text/html Content-Type', async () => {
    const html = '<!DOCTYPE html><html><body><h1>hello</h1></body></html>'
    seedVisualization('campaign-queue', html, {
      intent: 'kanban board',
      idiom: 'kanban',
      data_paths: ['/tmp/x'],
      last_generated_at: '2026-04-29T10:00:00Z',
    })
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/visualize/campaign-queue')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toBe(html)
  })

  it('returns 404 when the view_id does not exist', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/visualize/missing-view')
    expect(res.status).toBe(404)
  })
})

describe('GET /api/visualize/list', () => {
  it('returns all saved views with metadata', async () => {
    seedVisualization('alpha', '<div>a</div>', {
      intent: 'cards', idiom: 'cards', data_paths: ['/tmp/a'],
      last_generated_at: '2026-04-29T10:00:00Z',
    })
    seedVisualization('beta', '<div>b</div>', {
      intent: 'kanban', idiom: 'kanban', data_paths: ['/tmp/b'],
      last_generated_at: '2026-04-29T11:00:00Z',
    })
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/visualize/list')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: Array<{ view_id: string; idiom: string }>
      total: number
    }
    expect(body.total).toBe(2)
    // Newest first.
    expect(body.items[0].view_id).toBe('beta')
    expect(body.items[1].view_id).toBe('alpha')
    expect(body.items[0].idiom).toBe('kanban')
  })
})

describe('visualization sidecar persistence', () => {
  it('the sidecar JSON written by the runner contains every metadata field', async () => {
    // Drive runVisualize through a fake reasoning adapter so we exercise
    // the real persistence path (the unit tests for the runner spot-check
    // shape; this one verifies the sidecar is durable across a fresh
    // process / module re-import).
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const dataDir = join(TMP, '.gtm-os', 'agents', 'fixture.runs')
    mkdirSync(dataDir, { recursive: true })
    const dataPath = join(dataDir, 'fixture.json')
    writeFileSync(
      dataPath,
      JSON.stringify({
        rows: [{ id: '1', name: 'one' }, { id: '2', name: 'two' }],
        ranAt: '2026-04-29T09:00:00Z',
      }),
    )
    const { resetCapabilityRegistry, getCapabilityRegistryReady } = await import(
      '../lib/providers/capabilities'
    )
    resetCapabilityRegistry()
    const registry = await getCapabilityRegistryReady()
    registry.register({
      capabilityId: 'reasoning',
      providerId: 'anthropic',
      isAvailable: () => true,
      async execute(input: Record<string, unknown>) {
        return {
          text: JSON.stringify({
            view_id: input.view_id,
            html: '<!DOCTYPE html><html><head></head><body>visual</body></html>',
            idiom: 'cards',
            summary: 'two items',
          }),
        }
      },
    })
    const { runVisualize } = await import('../lib/visualize/runner')
    await runVisualize({
      view_id: 'sidecar-test',
      intent: 'grid of cards',
      data_paths: [dataPath],
    })
    const sidecar = JSON.parse(readFileSync(join(vizDir(), 'sidecar-test.json'), 'utf-8'))
    expect(sidecar.view_id).toBe('sidecar-test')
    expect(sidecar.intent).toBe('grid of cards')
    expect(sidecar.idiom).toBe('cards')
    expect(sidecar.summary).toBe('two items')
    expect(Array.isArray(sidecar.data_paths)).toBe(true)
    expect(sidecar.data_paths[0]).toBe(dataPath)
    expect(typeof sidecar.last_generated_at).toBe('string')
    resetCapabilityRegistry()
  })
})
