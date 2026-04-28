import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  resolveSkillAlias,
  SKILL_ALIASES,
  _resetSkillAliasWarnings,
} from '../lib/skills/aliases'

describe('skill alias map', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    _resetSkillAliasWarnings()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('known alias resolves to the renamed skill', () => {
    expect(resolveSkillAlias('crustdata-icp-search')).toBe('icp-company-search')
    expect(resolveSkillAlias('crustdata-funding-feed')).toBe('detect-funding')
  })

  it('unknown skill name passes through unchanged', () => {
    expect(resolveSkillAlias('made-up-skill-name')).toBe('made-up-skill-name')
    expect(resolveSkillAlias('classify-mentions')).toBe('classify-mentions')
    // No WARN should fire for non-aliased lookups.
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('alias emits WARN once and stays quiet on repeat lookups', () => {
    resolveSkillAlias('crustdata-icp-search')
    resolveSkillAlias('crustdata-icp-search')
    resolveSkillAlias('crustdata-icp-search')
    // One WARN total — the dedup set keeps subsequent lookups silent.
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const msg = String(warnSpy.mock.calls[0][0])
    expect(msg).toMatch(/deprecated/)
    expect(msg).toMatch(/icp-company-search/)
    expect(msg).toMatch(/1\.0\.0/)
  })

  it('each alias warns independently (separate dedup keys)', () => {
    resolveSkillAlias('crustdata-icp-search')
    resolveSkillAlias('crustdata-funding-feed')
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })

  it('exposes a non-empty SKILL_ALIASES table', () => {
    expect(Object.keys(SKILL_ALIASES).length).toBeGreaterThan(0)
    for (const [from, to] of Object.entries(SKILL_ALIASES)) {
      expect(typeof from).toBe('string')
      expect(typeof to).toBe('string')
      expect(from).not.toBe(to)
    }
  })
})

describe('skill alias priority — exact match wins over alias', () => {
  it('framework runner consults the registry before the alias map', async () => {
    // The runner is in src/lib/frameworks/runner.ts. The order is:
    //  1. registry.get(skillId) — direct lookup
    //  2. registry.get(`md:${skillId}`)
    //  3. bundled fallback configs/skills/<id>.md
    //  4. resolveSkillAlias() — only if the above all return null
    //
    // We assert the source contains the recursive-alias call last so future
    // refactors can't accidentally re-order it.
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { PKG_ROOT } = await import('../lib/paths')
    const runnerSrc = readFileSync(join(PKG_ROOT, 'src/lib/frameworks/runner.ts'), 'utf-8')
    const directIdx = runnerSrc.indexOf('registry.get(skillId)')
    // Use the call site (`resolveSkillAlias(`) — not the import — so we
    // assert ordering inside the resolver, not in the import block.
    const aliasCallIdx = runnerSrc.indexOf('resolveSkillAlias(skillId)')
    expect(directIdx).toBeGreaterThan(0)
    expect(aliasCallIdx).toBeGreaterThan(directIdx)
  })
})
