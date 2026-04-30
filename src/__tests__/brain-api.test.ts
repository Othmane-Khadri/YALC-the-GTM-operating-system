/**
 * Tests for /api/brain/* — the SPA's read-only context viewer (0.9.C).
 *
 * Seeds a fake `~/.gtm-os/` live tree under a stubbed HOME (sometimes
 * with a parallel `_preview/_meta.json` so confidence numbers surface),
 * then drives the Hono app via `app.request()`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

function liveDir(): string {
  return join(TMP, '.gtm-os')
}

function seedLive() {
  const root = liveDir()
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'company_context.yaml'), 'company: ACME\n')
  writeFileSync(join(root, 'framework.yaml'), 'name: ACME GTM\n')
  mkdirSync(join(root, 'voice'), { recursive: true })
  writeFileSync(join(root, 'voice', 'tone-of-voice.md'), '# tone\n')
  writeFileSync(join(root, 'voice', 'examples.md'), '# examples\n')
  mkdirSync(join(root, 'icp'), { recursive: true })
  writeFileSync(join(root, 'icp', 'segments.yaml'), 'segments: []\n')
  mkdirSync(join(root, 'positioning'), { recursive: true })
  writeFileSync(join(root, 'positioning', 'one-pager.md'), '# pos\n')
  writeFileSync(join(root, 'qualification_rules.md'), '# rules\n')
  writeFileSync(join(root, 'campaign_templates.yaml'), 'templates: []\n')
  writeFileSync(join(root, 'search_queries.txt'), 'q1\n')
  writeFileSync(join(root, 'config.yaml'), 'key: value\n')
}

function seedPreviewMeta() {
  const root = join(liveDir(), '_preview')
  mkdirSync(root, { recursive: true })
  // The preview meta reader expects at least one section file to exist.
  writeFileSync(join(root, 'company_context.yaml'), 'company: ACME\n')
  writeFileSync(
    join(root, '_meta.json'),
    JSON.stringify({
      captured_at: '2026-04-29T00:00:00Z',
      version: '0.6.0',
      sections: {
        framework: {
          confidence: 0.82,
          confidence_signals: {
            input_chars: 1500,
            llm_self_rating: 8,
            has_metadata_anchors: true,
          },
        },
      },
    }),
  )
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-brain-api-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

describe('GET /api/brain/context', () => {
  it('returns 404 when no live tree exists', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/brain/context')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('no_brain')
  })

  it('lists every section that exists with its file contents', async () => {
    seedLive()
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/brain/context')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      tenant: string
      live_root: string
      sections: Array<{ id: string; files: Array<{ canonical: string; content: string }> }>
    }
    expect(body.tenant).toBe('default')
    const ids = body.sections.map((s) => s.id)
    expect(ids).toContain('company_context')
    expect(ids).toContain('framework')
    expect(ids).toContain('voice')
    // Voice walks one directory level.
    const voice = body.sections.find((s) => s.id === 'voice')!
    const voiceFiles = voice.files.map((f) => f.canonical)
    expect(voiceFiles).toContain('voice/tone-of-voice.md')
    expect(voiceFiles).toContain('voice/examples.md')
    // Content surfaces verbatim.
    const fw = body.sections.find((s) => s.id === 'framework')!
    expect(fw.files[0].content).toContain('ACME GTM')
  })

  it('surfaces preview confidence metadata when no live meta exists', async () => {
    seedLive()
    seedPreviewMeta()
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/brain/context')
    const body = (await res.json()) as {
      sections: Array<{ id: string; confidence: number | null }>
    }
    const fw = body.sections.find((s) => s.id === 'framework')!
    expect(fw.confidence).toBe(0.82)
  })
})

describe('POST /api/brain/regenerate/:section', () => {
  it('rejects unknown section names with 400', async () => {
    seedLive()
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/brain/regenerate/not_a_real_section', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; valid_sections: string[] }
    expect(body.error).toBe('unknown_section')
    expect(body.valid_sections).toContain('framework')
  })
})
