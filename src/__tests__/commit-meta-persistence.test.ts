/**
 * Tests for meta-confidence persistence after commitPreview (A6, Part 2).
 *
 * Before A6, `commitPreview()` removed the preview folder wholesale, which
 * stripped the per-section confidence values that A4's `writeCapturedPreview`
 * had seeded under `_meta.json#sections`. This forced /brain to recompute
 * confidence on every page load.
 *
 * A6 persists per-section confidence to a sidecar at the live root
 * (`<liveRoot>/_meta.json`) so /brain reads it directly. The live `_meta.json`
 * lookup already exists in `brain.ts` — we just need the commit pipeline to
 * stop dropping the data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-commit-meta-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

describe('commitPreview persists per-section confidence', () => {
  it('writes per-section confidence to <liveRoot>/_meta.json after commit', async () => {
    const {
      previewPath,
      ensurePreviewDir,
      writePreviewMeta,
      commitPreview,
      liveRoot,
    } = await import('../lib/onboarding/preview')

    writePreviewMeta({
      captured_at: '2026-04-30T00:00:00Z',
      version: '0.6.0',
      sections: {
        company_context: {
          confidence: 0.91,
          confidence_signals: {
            input_chars: 4200,
            llm_self_rating: 9,
            has_metadata_anchors: true,
          },
        },
        framework: {
          confidence: 0.74,
          confidence_signals: {
            input_chars: 1500,
            llm_self_rating: 7,
            has_metadata_anchors: false,
          },
        },
      },
    })
    ensurePreviewDir('company_context.yaml')
    writeFileSync(previewPath('company_context.yaml'), 'company:\n  name: acme\n')
    ensurePreviewDir('framework.yaml')
    writeFileSync(previewPath('framework.yaml'), 'name: ACME GTM\n')

    commitPreview()

    const liveMetaPath = join(liveRoot(), '_meta.json')
    expect(existsSync(liveMetaPath)).toBe(true)
    const meta = JSON.parse(readFileSync(liveMetaPath, 'utf-8'))
    expect(meta.sections.company_context.confidence).toBe(0.91)
    expect(meta.sections.company_context.confidence_signals.has_metadata_anchors).toBe(true)
    expect(meta.sections.framework.confidence).toBe(0.74)
  })

  it('only persists meta entries for sections that actually committed', async () => {
    const {
      previewPath,
      ensurePreviewDir,
      writePreviewMeta,
      commitPreview,
      liveRoot,
    } = await import('../lib/onboarding/preview')

    writePreviewMeta({
      captured_at: '2026-04-30T00:00:00Z',
      version: '0.6.0',
      sections: {
        company_context: {
          confidence: 0.91,
          confidence_signals: {
            input_chars: 4200,
            llm_self_rating: 9,
            has_metadata_anchors: true,
          },
        },
        framework: {
          confidence: 0.74,
          confidence_signals: {
            input_chars: 1500,
            llm_self_rating: 7,
            has_metadata_anchors: false,
          },
        },
      },
    })
    ensurePreviewDir('company_context.yaml')
    writeFileSync(previewPath('company_context.yaml'), 'company:\n  name: acme\n')
    ensurePreviewDir('framework.yaml')
    writeFileSync(previewPath('framework.yaml'), 'name: ACME GTM\n')

    // Discard framework — it should not be in live meta.
    commitPreview({ discardSections: ['framework'] })

    const liveMetaPath = join(liveRoot(), '_meta.json')
    const meta = JSON.parse(readFileSync(liveMetaPath, 'utf-8'))
    expect(meta.sections.company_context).toBeDefined()
    expect(meta.sections.framework).toBeUndefined()
  })

  it('merges into an existing live _meta.json instead of overwriting', async () => {
    const {
      previewPath,
      ensurePreviewDir,
      writePreviewMeta,
      commitPreview,
      liveRoot,
    } = await import('../lib/onboarding/preview')

    // Seed a pre-existing live meta with a different section.
    mkdirSync(liveRoot(), { recursive: true })
    writeFileSync(
      join(liveRoot(), '_meta.json'),
      JSON.stringify({
        sections: {
          voice: {
            confidence: 0.6,
            confidence_signals: {
              input_chars: 100,
              llm_self_rating: 6,
              has_metadata_anchors: false,
            },
          },
        },
      }),
    )

    writePreviewMeta({
      captured_at: '2026-04-30T00:00:00Z',
      sections: {
        company_context: {
          confidence: 0.91,
          confidence_signals: {
            input_chars: 4200,
            llm_self_rating: 9,
            has_metadata_anchors: true,
          },
        },
      },
    })
    ensurePreviewDir('company_context.yaml')
    writeFileSync(previewPath('company_context.yaml'), 'company:\n  name: acme\n')

    commitPreview()

    const liveMeta = JSON.parse(readFileSync(join(liveRoot(), '_meta.json'), 'utf-8'))
    // New entry merged in.
    expect(liveMeta.sections.company_context.confidence).toBe(0.91)
    // Pre-existing entry preserved.
    expect(liveMeta.sections.voice.confidence).toBe(0.6)
  })
})

describe('/api/brain/context — persisted meta short-circuits recompute', () => {
  function seedLive(home: string) {
    const root = join(home, '.gtm-os')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'company_context.yaml'), 'company: ACME\n')
    writeFileSync(join(root, 'framework.yaml'), 'name: ACME\n')
    return root
  }

  it('reads confidence from the persisted live _meta.json without recomputing', async () => {
    const root = seedLive(TMP)
    // Persisted live meta already has the answer.
    writeFileSync(
      join(root, '_meta.json'),
      JSON.stringify({
        sections: {
          company_context: {
            confidence: 0.93,
            confidence_signals: {
              input_chars: 4200,
              llm_self_rating: 9,
              has_metadata_anchors: true,
            },
          },
        },
      }),
    )

    // Spy on the recompute helper. brain.ts exposes a test seam
    // (`__confidenceRecompute.compute`) — when the persisted entry is
    // present we expect this NOT to be called.
    const brainModule = await import('../lib/server/routes/brain')
    const recomputeSpy = vi.spyOn(brainModule.__confidenceRecompute, 'compute')

    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request('/api/brain/context')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      sections: Array<{ id: string; confidence: number | null }>
    }
    const cc = body.sections.find((s) => s.id === 'company_context')!
    expect(cc.confidence).toBe(0.93)
    expect(recomputeSpy).not.toHaveBeenCalled()
  })
})
