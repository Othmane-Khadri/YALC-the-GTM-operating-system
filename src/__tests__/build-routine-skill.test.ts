/**
 * build-routine skill — sanity tests (Tier 1, hybrid: propose=import + install=shell-out).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKILL_DIR = join(process.cwd(), '.claude', 'skills', 'build-routine')

const TRIGGER_PHRASES = [
  'build my sales routine',
  'show me what YALC would auto-configure',
  'propose a routine for me',
  'set up a sales routine',
  'auto-derive my routine',
]

describe('build-routine skill', () => {
  it('SKILL.md exists with required frontmatter fields', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    expect(raw.startsWith('---\n')).toBe(true)
    const closeIdx = raw.indexOf('\n---', 4)
    expect(closeIdx).toBeGreaterThan(0)
    const fm = raw.slice(4, closeIdx)
    expect(fm).toMatch(/^name:\s*build-routine\s*$/m)
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

  it('SKILL.md body references both hybrid phases', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    const raw = readFileSync(path, 'utf-8')
    expect(raw).toContain('generateRoutine')
    expect(raw).toContain('routine:install')
    expect(raw.toLowerCase()).toContain('import-direct')
    expect(raw.toLowerCase()).toContain('shell-out')
    expect(raw.toLowerCase()).toContain('hybrid')
  })

  it('SKILL.md body documents the fallback to routine:propose --json', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    const raw = readFileSync(path, 'utf-8')
    expect(raw).toContain('routine:propose --json')
  })

  it('references/example-output.md exists and shows both phases', () => {
    const path = join(SKILL_DIR, 'references', 'example-output.md')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    expect(raw.toLowerCase()).toContain('propose')
    expect(raw.toLowerCase()).toContain('install')
    expect(raw.toLowerCase()).toContain('routine.yaml')
  })

  it('description trigger phrases do not collide with sibling skills', () => {
    const FORBIDDEN = [
      'is YALC working',
      'set up YALC',
      'list adapters',
      'qualify these leads',
      'add a new provider',
      'launch a LinkedIn campaign',
      'scrape engagers',
      'personalize this message',
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
