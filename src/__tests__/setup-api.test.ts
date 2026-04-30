/**
 * Tests for /api/setup/* — the SPA-driven preview review surface (0.9.B).
 *
 * Each test seeds a fake `_preview/` tree under a stubbed HOME, then drives
 * the Hono app via `app.request()`. No network — same pattern as
 * `server-spa-mount.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

function liveDir(): string {
  return join(TMP, '.gtm-os')
}
function previewDir(): string {
  return join(liveDir(), '_preview')
}

/**
 * Seed a full 9-section preview tree at `~/.gtm-os/_preview/` so the API
 * can walk it. Each section gets a one-line body so we can detect edits.
 */
function seedPreview(opts: { withMeta?: boolean } = {}) {
  const { withMeta = true } = opts
  const root = previewDir()
  mkdirSync(root, { recursive: true })

  const writeFile = (rel: string, content: string) => {
    const abs = join(root, rel)
    mkdirSync(join(root, rel.split('/').slice(0, -1).join('/') || '.'), { recursive: true })
    writeFileSync(abs, content)
  }

  writeFile('company_context.yaml', 'company: ACME\n')
  writeFile('framework.yaml', 'name: ACME GTM\n')
  writeFile('voice/tone-of-voice.md', '# tone\n')
  writeFile('voice/examples.md', '# examples\n')
  writeFile('icp/segments.yaml', 'segments: []\n')
  writeFile('positioning/one-pager.md', '# one-pager\n')
  writeFile('qualification_rules.md', '# rules\n')
  writeFile('campaign_templates.yaml', 'templates: []\n')
  writeFile('search_queries.txt', 'query 1\n')
  writeFile('config.yaml', 'a: 1\n')

  if (withMeta) {
    const sections: Record<string, unknown> = {}
    const ids = [
      'company_context',
      'framework',
      'voice',
      'icp',
      'positioning',
      'qualification_rules',
      'campaign_templates',
      'search_queries',
      'config',
    ]
    for (const id of ids) {
      sections[id] = {
        confidence: 0.7,
        confidence_signals: {
          input_chars: 1000,
          llm_self_rating: 7,
          has_metadata_anchors: true,
        },
      }
    }
    writeFileSync(
      join(root, '_meta.json'),
      JSON.stringify(
        {
          captured_at: '2026-04-29T00:00:00Z',
          version: '0.6.0',
          sections,
        },
        null,
        2,
      ),
    )
  }
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-setup-api-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

describe('GET /api/setup/preview', () => {
  it('reads every section in canonical order with confidence metadata', async () => {
    seedPreview()
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/setup/preview')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      tenant: string
      preview_root: string
      sections: Array<{
        id: string
        canonical: string
        content: string
        confidence: number | null
      }>
    }
    expect(body.tenant).toBe('default')
    // Distinct section ids should cover all 9.
    const ids = new Set(body.sections.map((s) => s.id))
    for (const id of [
      'company_context',
      'framework',
      'voice',
      'icp',
      'positioning',
      'qualification_rules',
      'campaign_templates',
      'search_queries',
      'config',
    ]) {
      expect(ids.has(id)).toBe(true)
    }
    // Voice section emits two files (tone + examples) — both must be present.
    const voiceFiles = body.sections.filter((s) => s.id === 'voice').map((s) => s.canonical)
    expect(voiceFiles).toContain('voice/tone-of-voice.md')
    expect(voiceFiles).toContain('voice/examples.md')
    expect(body.sections[0].confidence).toBe(0.7)
  })

  it('returns 404 when no preview exists', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/setup/preview')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('no_preview')
  })
})

describe('PUT /api/setup/preview/:section', () => {
  it('writes back to the preview file and the next GET sees the change', async () => {
    seedPreview()
    const { createApp } = await import('../lib/server/index')
    const app = createApp()

    const putRes = await app.request('/api/setup/preview/framework', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'name: ACME GTM v2\nversion: 2\n' }),
    })
    expect(putRes.status).toBe(200)

    const getRes = await app.request('/api/setup/preview')
    const body = (await getRes.json()) as {
      sections: Array<{ id: string; content: string }>
    }
    const fw = body.sections.find((s) => s.id === 'framework')
    expect(fw?.content).toContain('ACME GTM v2')
  })

  it('rejects malformed YAML with 400', async () => {
    seedPreview()
    const { createApp } = await import('../lib/server/index')
    const app = createApp()

    const res = await app.request('/api/setup/preview/framework', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: ': : invalid yaml [\n  -broken' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('invalid_yaml')
  })
})

describe('POST /api/setup/commit', () => {
  it('moves preview files to live and clears the preview folder', async () => {
    seedPreview()
    const { createApp } = await import('../lib/server/index')
    const app = createApp()

    const res = await app.request('/api/setup/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; committed: string[] }
    expect(body.ok).toBe(true)
    expect(body.committed.length).toBeGreaterThan(0)

    // Live tree now has the framework file; preview is gone.
    expect(existsSync(join(liveDir(), 'framework.yaml'))).toBe(true)
    expect(existsSync(previewDir())).toBe(false)

    // Sentinel landed.
    const sentinel = join(liveDir(), '_handoffs', 'setup', 'review.committed')
    expect(existsSync(sentinel)).toBe(true)
    const parsed = JSON.parse(readFileSync(sentinel, 'utf-8'))
    expect(parsed.tenant).toBe('default')
  })

  it('skips listed sections via the discard array', async () => {
    seedPreview()
    const { createApp } = await import('../lib/server/index')
    const app = createApp()

    const res = await app.request('/api/setup/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discard: ['voice'] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { committed: string[]; discarded: string[] }
    expect(body.discarded).toContain('voice')

    // Voice files stayed in preview (not in live).
    expect(existsSync(join(liveDir(), 'voice', 'tone-of-voice.md'))).toBe(false)
    expect(existsSync(join(previewDir(), 'voice', 'tone-of-voice.md'))).toBe(true)
    // Other sections committed.
    expect(existsSync(join(liveDir(), 'framework.yaml'))).toBe(true)
  })
})
