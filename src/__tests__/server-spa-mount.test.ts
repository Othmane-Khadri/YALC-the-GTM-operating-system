import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createApp } from '../lib/server/index'

/**
 * SPA mount contract for the Hono server.
 *
 * Verifies that the static-HTML legacy routes still respond, the SPA
 * renders at `/`, unknown paths fall back to the SPA index for client-
 * side routing, and `/api/*` is unaffected by the SPA mount.
 */

const ROOT = resolve(__dirname, '..', '..')
const DIST_INDEX = join(ROOT, 'web', 'dist', 'index.html')

beforeAll(() => {
  if (!existsSync(DIST_INDEX)) {
    const env = { ...process.env, NODE_ENV: 'production' }
    execSync('pnpm --silent build', {
      cwd: join(ROOT, 'web'),
      stdio: ['ignore', 'ignore', 'inherit'],
      env,
    })
  }
}, 120_000)

describe('server SPA mount', () => {
  it('serves the SPA at GET /', async () => {
    const app = createApp()
    const res = await app.request('/')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<div id="root">')
  })

  it('falls back to the SPA index for unknown client routes', async () => {
    const app = createApp()
    const res = await app.request('/some/deep/spa/path')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<div id="root">')
  })

  it('keeps GET /api/* off the SPA fallback', async () => {
    const app = createApp()
    // No bearer token configured in this test env, so the API route
    // reaches its handler. It will respond with whatever the campaigns
    // index returns (JSON), but crucially it does NOT serve SPA HTML.
    const res = await app.request('/api/campaigns')
    expect(res.status).not.toBe(404)
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).not.toContain('text/html')
  })

  it('still serves the legacy /campaigns static HTML page', async () => {
    const app = createApp()
    const res = await app.request('/campaigns')
    expect(res.status).toBe(200)
    const html = await res.text()
    // The legacy page identifies itself with a <title> distinct from the SPA.
    expect(html.toLowerCase()).toContain('campaign')
    // Crucially, it is NOT the SPA shell (no #root mount node).
    expect(html).not.toContain('<div id="root">')
  })
})
