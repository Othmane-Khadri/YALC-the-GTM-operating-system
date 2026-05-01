/**
 * enrich-with-signals skill — sanity tests (Tier 2, shell-out).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKILL_DIR = join(process.cwd(), '.claude', 'skills', 'enrich-with-signals')

const TRIGGER_PHRASES = [
  'enrich these companies with signals',
  'add buying signals to this list',
  'pull intent data for [domain]',
  'check signals for these accounts',
  'fetch jobs and news for these companies',
]

describe('enrich-with-signals skill', () => {
  it('SKILL.md exists with frontmatter', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    expect(raw).toMatch(/^name:\s*enrich-with-signals\s*$/m)
    expect(raw).toMatch(/^version:\s*1\.0\.0\s*$/m)
  })

  it('description includes all 5 trigger phrases', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    const fm = raw.slice(4, raw.indexOf('\n---', 4))
    const desc = fm.match(/description:\s*"([\s\S]*?)"\s*$/m)![1]
    for (const p of TRIGGER_PHRASES) expect(desc).toContain(`'${p}'`)
  })

  it('body references signals:enrich', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    expect(raw).toContain('signals:enrich')
    expect(raw.toLowerCase()).toContain('shell out')
  })

  it('example-output.md exists', () => {
    expect(existsSync(join(SKILL_DIR, 'references', 'example-output.md'))).toBe(true)
  })

  it('triggers do not collide with siblings', () => {
    const FORBIDDEN = ['list adapters', 'qualify these leads', 'find lookalikes', 'set up YALC']
    for (const p of TRIGGER_PHRASES) {
      for (const f of FORBIDDEN) {
        expect(p.toLowerCase().includes(f.toLowerCase())).toBe(false)
        expect(f.toLowerCase().includes(p.toLowerCase())).toBe(false)
      }
    }
  })
})
