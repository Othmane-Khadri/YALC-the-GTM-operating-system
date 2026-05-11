/**
 * list-adapters skill — sanity tests (Tier 4, shell-out per benchmark).
 *
 * 1. SKILL.md exists with the required frontmatter.
 * 2. Description includes all 5 spec-mandated trigger phrases as quoted strings.
 * 3. Body references the CLI command (adapters:list --json) so the shell-out
 *    won't silently break.
 * 4. references/example-output.md exists and shows the rendered table format.
 * 5. Trigger phrases don't collide with sibling skills (provider-builder,
 *    run-doctor).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKILL_DIR = join(process.cwd(), '.claude', 'skills', 'list-adapters')

const TRIGGER_PHRASES = [
  'list adapters',
  'show me which providers are configured',
  'which providers are available',
  'what capabilities can YALC use right now',
  'show capability coverage',
]

describe('list-adapters skill', () => {
  it('SKILL.md exists with required frontmatter fields', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    expect(raw.startsWith('---\n')).toBe(true)
    const closeIdx = raw.indexOf('\n---', 4)
    expect(closeIdx).toBeGreaterThan(0)
    const fm = raw.slice(4, closeIdx)
    expect(fm).toMatch(/^name:\s*list-adapters\s*$/m)
    expect(fm).toMatch(/^version:\s*1\.0\.0\s*$/m)
    expect(fm).toMatch(/^description:/m)
  })

  it('description includes all 5 trigger phrases as quoted strings', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    const raw = readFileSync(path, 'utf-8')
    const closeIdx = raw.indexOf('\n---', 4)
    const fm = raw.slice(4, closeIdx)
    const descMatch = fm.match(/description:\s*"([\s\S]*?)"\s*$/m)
    expect(descMatch).not.toBeNull()
    const desc = descMatch![1]
    for (const phrase of TRIGGER_PHRASES) {
      expect(desc).toContain(`'${phrase}'`)
    }
  })

  it('SKILL.md body references the adapters:list CLI command', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    const raw = readFileSync(path, 'utf-8')
    expect(raw).toContain('adapters:list --json')
    // Body should explicitly call out shell-out (not import-direct) per the
    // 0.13.0 benchmark recommendation for single-command skills.
    expect(raw.toLowerCase()).toContain('shell out')
  })

  it('references/example-output.md exists and shows the rendered format', () => {
    const path = join(SKILL_DIR, 'references', 'example-output.md')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    // The example must demonstrate the priority + source + availability format
    // a user will see — that's the contract this skill renders.
    expect(raw).toContain('[built-in]')
    expect(raw).toContain('[bundled]')
    // Priority rank notation (#N) and non-priority bullet (·) must both
    // appear so the example covers the full output grammar.
    expect(raw).toMatch(/#1\s+✓/)
    expect(raw).toMatch(/·\s+✗/)
  })

  it('description trigger phrases do not collide with sibling skills', () => {
    // provider-builder uses 'add a new provider', 'wire up', 'build an adapter'.
    // run-doctor uses 'is YALC working', 'diagnose YALC', etc.
    // setup uses 'set up YALC'.
    // None of our 5 phrases should substring-overlap any of those.
    const FORBIDDEN = [
      'add a new provider',
      'wire up',
      'build an adapter',
      'is YALC working',
      'diagnose YALC',
      'set up YALC',
    ]
    for (const phrase of TRIGGER_PHRASES) {
      const lower = phrase.toLowerCase()
      for (const f of FORBIDDEN) {
        expect(lower.includes(f.toLowerCase())).toBe(false)
        expect(f.toLowerCase().includes(lower)).toBe(false)
      }
    }
  })
})
