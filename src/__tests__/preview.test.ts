import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Tests for `src/lib/onboarding/preview.ts` — preview folder helpers.
 *
 * We override HOME so the helpers operate in a sandboxed temp directory,
 * preventing any pollution of the developer's real `~/.gtm-os/`.
 */

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-preview-'))
  vi.stubEnv('HOME', TMP)
  // Reset module cache so paths.ts re-resolves HOME_DIR per test.
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

describe('preview helpers — default tenant', () => {
  it('previewRoot resolves to ~/.gtm-os/_preview when no tenant given', async () => {
    const { previewRoot } = await import('../lib/onboarding/preview')
    expect(previewRoot()).toBe(join(homedir(), '.gtm-os', '_preview'))
  })

  it('previewExists is false on a clean tree', async () => {
    const { previewExists } = await import('../lib/onboarding/preview')
    expect(previewExists()).toBe(false)
  })

  it('writePreviewMeta creates the dir and a parsable JSON file', async () => {
    const { writePreviewMeta, readPreviewMeta, previewExists } = await import('../lib/onboarding/preview')
    writePreviewMeta({ captured_at: '2026-04-27T00:00:00Z', version: '0.6.0' })
    expect(previewExists()).toBe(true)
    expect(readPreviewMeta()?.captured_at).toBe('2026-04-27T00:00:00Z')
  })

  it('previewCapturedAt returns a Date when meta is present', async () => {
    const { writePreviewMeta, previewCapturedAt } = await import('../lib/onboarding/preview')
    writePreviewMeta({ captured_at: '2026-04-27T12:34:56Z' })
    const d = previewCapturedAt()
    expect(d instanceof Date).toBe(true)
    expect(d?.toISOString()).toBe('2026-04-27T12:34:56.000Z')
  })

  it('previewCapturedAt returns null when meta is missing', async () => {
    const { previewCapturedAt } = await import('../lib/onboarding/preview')
    expect(previewCapturedAt()).toBeNull()
  })
})

describe('preview helpers — named tenant', () => {
  it('previewRoot points under tenants/<slug>/_preview', async () => {
    const { previewRoot } = await import('../lib/onboarding/preview')
    expect(previewRoot({ tenantId: 'acme' })).toBe(
      join(homedir(), '.gtm-os', 'tenants', 'acme', '_preview'),
    )
  })

  it('default and named-tenant previews are isolated', async () => {
    const { writePreviewMeta, previewExists } = await import('../lib/onboarding/preview')
    writePreviewMeta({ captured_at: '2026-04-27T00:00:00Z' })
    expect(previewExists()).toBe(true)
    expect(previewExists({ tenantId: 'acme' })).toBe(false)
  })
})

describe('commitPreview', () => {
  it('moves preview files to live and removes the preview folder when fully committed', async () => {
    const { previewPath, livePath, commitPreview, ensurePreviewDir, writePreviewMeta, previewExists } =
      await import('../lib/onboarding/preview')

    writePreviewMeta({ captured_at: '2026-04-27T00:00:00Z' })
    ensurePreviewDir('framework.yaml')
    writeFileSync(previewPath('framework.yaml'), 'company: acme\n')
    ensurePreviewDir('voice/tone-of-voice.md')
    writeFileSync(previewPath('voice/tone-of-voice.md'), '# Tone\nbe direct.\n')
    ensurePreviewDir('voice/examples.md')
    writeFileSync(previewPath('voice/examples.md'), '# Examples\n')
    ensurePreviewDir('company_context.yaml')
    writeFileSync(previewPath('company_context.yaml'), 'company:\n  name: acme\n')

    const result = commitPreview()
    expect(result.committed).toContain('framework.yaml')
    expect(result.committed).toContain('voice')
    expect(result.committed).toContain('company_context.yaml')
    expect(result.discarded).toEqual([])

    expect(existsSync(livePath('framework.yaml'))).toBe(true)
    expect(existsSync(livePath('voice/tone-of-voice.md'))).toBe(true)
    expect(readFileSync(livePath('framework.yaml'), 'utf-8')).toContain('company: acme')
    // Preview folder is gone now that nothing is left behind.
    expect(previewExists()).toBe(false)
  })

  it('respects --discard <section>: file stays in preview, not in live', async () => {
    const { previewPath, livePath, commitPreview, ensurePreviewDir, writePreviewMeta, previewExists } =
      await import('../lib/onboarding/preview')

    writePreviewMeta({ captured_at: '2026-04-27T00:00:00Z' })
    ensurePreviewDir('framework.yaml')
    writeFileSync(previewPath('framework.yaml'), 'a: 1\n')
    ensurePreviewDir('campaign_templates.yaml')
    writeFileSync(previewPath('campaign_templates.yaml'), 'connect_note: hello\n')

    const result = commitPreview({ discardSections: ['campaign_templates'] })
    expect(result.committed).toContain('framework.yaml')
    expect(result.discarded).toContain('campaign_templates.yaml')
    expect(existsSync(livePath('framework.yaml'))).toBe(true)
    expect(existsSync(livePath('campaign_templates.yaml'))).toBe(false)

    // Discarded file is still in preview for the user to finish manually.
    expect(existsSync(previewPath('campaign_templates.yaml'))).toBe(true)
    expect(previewExists()).toBe(true)
  })

  it('throws when no preview exists', async () => {
    const { commitPreview } = await import('../lib/onboarding/preview')
    expect(() => commitPreview()).toThrow(/No preview/)
  })
})

describe('discardPreview', () => {
  it('removes the preview folder', async () => {
    const { writePreviewMeta, discardPreview, previewExists } = await import('../lib/onboarding/preview')
    writePreviewMeta({ captured_at: '2026-04-27T00:00:00Z' })
    expect(previewExists()).toBe(true)
    discardPreview()
    expect(previewExists()).toBe(false)
  })

  it('is a no-op when nothing exists', async () => {
    const { discardPreview, previewExists } = await import('../lib/onboarding/preview')
    expect(previewExists()).toBe(false)
    discardPreview()
    expect(previewExists()).toBe(false)
  })
})
