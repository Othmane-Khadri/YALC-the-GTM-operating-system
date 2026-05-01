/**
 * personalize-message skill — sanity tests (Tier 1, shell-out per benchmark).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKILL_DIR = join(process.cwd(), '.claude', 'skills', 'personalize-message')

const TRIGGER_PHRASES = [
  'personalize this message',
  'tailor this outreach to the prospect',
  'rewrite this template for [name]',
  'make this message more personal',
  'generate a personal opener',
]

describe('personalize-message skill', () => {
  it('SKILL.md exists with required frontmatter fields', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    expect(raw.startsWith('---\n')).toBe(true)
    const closeIdx = raw.indexOf('\n---', 4)
    expect(closeIdx).toBeGreaterThan(0)
    const fm = raw.slice(4, closeIdx)
    expect(fm).toMatch(/^name:\s*personalize-message\s*$/m)
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

  it('SKILL.md body references the personalize CLI command and shell-out pattern', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    const raw = readFileSync(path, 'utf-8')
    expect(raw).toContain('personalize')
    expect(raw).toContain('--template')
    expect(raw).toContain('--email')
    expect(raw.toLowerCase()).toContain('shell out')
  })

  it('references/example-output.md exists with variant + reasoning structure', () => {
    const path = join(SKILL_DIR, 'references', 'example-output.md')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    expect(raw.toLowerCase()).toContain('variant')
    expect(raw.toLowerCase()).toContain('reasoning')
    expect(raw.toLowerCase()).toContain('cost')
  })

  it('description trigger phrases do not collide with sibling skills', () => {
    const FORBIDDEN = [
      'is YALC working',
      'set up YALC',
      'list adapters',
      'qualify these leads',
      'scrape engagers',
      'add a new provider',
      'debug',
      'troubleshoot',
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
