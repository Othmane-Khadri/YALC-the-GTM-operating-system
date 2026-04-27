import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Section-level commit/discard semantics for the 0.6.0 preview model.
 *
 * Every preview section maps to a top-level path under `_preview/`. The
 * SECTION_NAMES map drives `--commit-preview --discard <section>` and
 * `--regenerate <section>`. These tests validate the discrete pieces; the
 * end-to-end CLI flow is exercised by the verifier.
 */

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-preview-sec-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

describe('SECTION_NAMES + SECTION_PATHS', () => {
  it('includes all canonical onboarding sections', async () => {
    const { SECTION_NAMES, SECTION_PATHS } = await import('../lib/onboarding/preview')
    expect(SECTION_NAMES).toEqual([
      'company_context',
      'framework',
      'voice',
      'icp',
      'positioning',
      'qualification_rules',
      'campaign_templates',
      'search_queries',
      'config',
    ])
    // Every section maps to at least one canonical path.
    for (const s of SECTION_NAMES) {
      expect(SECTION_PATHS[s].length).toBeGreaterThan(0)
    }
  })
})

describe('commitPreview discards', () => {
  it('keeps a discarded directory section in preview while committing the rest', async () => {
    const { previewPath, livePath, ensurePreviewDir, commitPreview, writePreviewMeta, previewExists } =
      await import('../lib/onboarding/preview')

    writePreviewMeta({ captured_at: '2026-04-27T00:00:00Z' })
    ensurePreviewDir('voice/tone-of-voice.md')
    writeFileSync(previewPath('voice/tone-of-voice.md'), '# tone\n')
    ensurePreviewDir('voice/examples.md')
    writeFileSync(previewPath('voice/examples.md'), '# examples\n')
    ensurePreviewDir('framework.yaml')
    writeFileSync(previewPath('framework.yaml'), 'a: 1\n')

    const result = commitPreview({ discardSections: ['voice'] })
    expect(result.committed).toContain('framework.yaml')
    expect(result.discarded).toContain('voice')
    expect(existsSync(livePath('framework.yaml'))).toBe(true)
    expect(existsSync(livePath('voice/tone-of-voice.md'))).toBe(false)
    expect(existsSync(previewPath('voice/tone-of-voice.md'))).toBe(true)
    expect(previewExists()).toBe(true)
  })

  it('overrides an existing live file when the same section is committed again', async () => {
    const { previewPath, livePath, ensurePreviewDir, commitPreview, writePreviewMeta } =
      await import('../lib/onboarding/preview')
    const { mkdirSync } = await import('node:fs')

    // First commit — preview → live.
    writePreviewMeta({ captured_at: '2026-04-27T00:00:00Z' })
    ensurePreviewDir('framework.yaml')
    writeFileSync(previewPath('framework.yaml'), 'first: 1\n')
    commitPreview({ discardSections: [] })
    expect(readFileSync(livePath('framework.yaml'), 'utf-8')).toContain('first: 1')

    // Second capture writes a new preview; commit should overwrite live.
    mkdirSync(previewPath('').slice(0, -1), { recursive: true })
    writePreviewMeta({ captured_at: '2026-04-28T00:00:00Z' })
    ensurePreviewDir('framework.yaml')
    writeFileSync(previewPath('framework.yaml'), 'second: 2\n')
    commitPreview({ discardSections: [] })
    expect(readFileSync(livePath('framework.yaml'), 'utf-8')).toContain('second: 2')
  })
})

describe('writeSynthesizedPreview — stub mode', () => {
  it('writes one file per section into the preview tree without an Anthropic key', async () => {
    delete process.env.ANTHROPIC_API_KEY

    const { writeSynthesizedPreview } = await import('../lib/onboarding/synthesis')
    const { previewPath } = await import('../lib/onboarding/preview')
    const { emptyCompanyContext } = await import('../lib/framework/context-types')
    const ctx = emptyCompanyContext()
    ctx.company.name = 'TestCo'
    ctx.icp.competitors = ['acme']

    const result = await writeSynthesizedPreview({ context: ctx })
    expect(result.llmDriven).toBe(false)
    expect(result.written).toContain('framework.yaml')
    expect(result.written).toContain('voice/tone-of-voice.md')
    expect(result.written).toContain('icp/segments.yaml')
    expect(result.written).toContain('positioning/one-pager.md')
    expect(result.written).toContain('qualification_rules.md')
    expect(result.written).toContain('campaign_templates.yaml')
    expect(result.written).toContain('search_queries.txt')
    // Verify the files actually exist on disk.
    for (const rel of result.written) {
      expect(existsSync(previewPath(rel))).toBe(true)
    }
  })

  it('respects `only:` to limit synthesis to a single section', async () => {
    delete process.env.ANTHROPIC_API_KEY

    const { writeSynthesizedPreview } = await import('../lib/onboarding/synthesis')
    const { previewPath } = await import('../lib/onboarding/preview')
    const { emptyCompanyContext } = await import('../lib/framework/context-types')
    const ctx = emptyCompanyContext()

    const result = await writeSynthesizedPreview({ context: ctx, only: ['framework'] })
    expect(result.sections).toEqual(['framework'])
    expect(result.written).toEqual(['framework.yaml'])
    expect(existsSync(previewPath('framework.yaml'))).toBe(true)
    expect(existsSync(previewPath('voice/tone-of-voice.md'))).toBe(false)
  })
})
