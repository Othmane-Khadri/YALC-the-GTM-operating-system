import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Tests for `src/lib/onboarding/index-builder.ts`.
 *
 * Drives the helper directly with concrete folders rather than through
 * preview/commit so the structure here is independent of D1 path resolution.
 */

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-idx-'))
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('buildIndex', () => {
  it('emits a markdown table with descriptions for known files', async () => {
    const { buildIndex } = await import('../lib/onboarding/index-builder')
    writeFileSync(join(TMP, 'company_context.yaml'), 'company:\n  name: Acme\n')
    writeFileSync(join(TMP, 'framework.yaml'), 'a: 1\n')
    mkdirSync(join(TMP, 'voice'), { recursive: true })
    writeFileSync(join(TMP, 'voice', 'tone-of-voice.md'), '# Tone\n')
    writeFileSync(join(TMP, 'voice', 'examples.md'), '# Examples\n')

    const target = buildIndex(TMP, false)
    expect(existsSync(target)).toBe(true)
    const md = readFileSync(target, 'utf-8')
    expect(md).toContain('# Your GTM brain — index')
    expect(md).toContain('| File | What it contains | Updated |')
    expect(md).toContain('`company_context.yaml`')
    expect(md).toContain('Captured answers about your company')
    expect(md).toContain('`framework.yaml`')
    expect(md).toContain('`voice/tone-of-voice.md`')
    // Live mode (isPreview=false): no preview banner.
    expect(md).not.toMatch(/^>\s*\*\*Preview\*\*/m)
  })

  it('prepends a Preview banner when isPreview is true', async () => {
    const { buildIndex } = await import('../lib/onboarding/index-builder')
    writeFileSync(join(TMP, 'framework.yaml'), 'a: 1\n')
    const target = buildIndex(TMP, true)
    const md = readFileSync(target, 'utf-8')
    expect(md.split('\n')[0]).toMatch(/^>\s*\*\*Preview\*\*/)
    expect(md).toContain('--commit-preview')
  })

  it('describes battlecards based on slug', async () => {
    const { buildIndex } = await import('../lib/onboarding/index-builder')
    mkdirSync(join(TMP, 'positioning', 'battlecards'), { recursive: true })
    writeFileSync(join(TMP, 'positioning', 'one-pager.md'), '# One pager\n')
    writeFileSync(join(TMP, 'positioning', 'battlecards', 'acme.md'), '# Acme\n')
    const target = buildIndex(TMP, false)
    const md = readFileSync(target, 'utf-8')
    expect(md).toContain('`positioning/battlecards/acme.md`')
    expect(md).toContain('Battlecard for acme')
  })

  it('skips _index.md and _meta.json when listing entries', async () => {
    const { buildIndex } = await import('../lib/onboarding/index-builder')
    writeFileSync(join(TMP, '_meta.json'), '{}')
    writeFileSync(join(TMP, 'framework.yaml'), 'a: 1\n')
    const target = buildIndex(TMP, false)
    const md = readFileSync(target, 'utf-8')
    expect(md).not.toContain('`_meta.json`')
    expect(md).not.toContain('`_index.md`')
    expect(md).toContain('`framework.yaml`')
  })

  it('handles an empty folder by emitting an empty-state row', async () => {
    const { buildIndex } = await import('../lib/onboarding/index-builder')
    const target = buildIndex(TMP, true)
    const md = readFileSync(target, 'utf-8')
    expect(md).toContain('_empty_')
  })
})
