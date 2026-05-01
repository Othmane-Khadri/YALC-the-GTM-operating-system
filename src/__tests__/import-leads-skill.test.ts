/**
 * import-leads skill — sanity tests (Tier 3, shell-out).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKILL_DIR = join(process.cwd(), '.claude', 'skills', 'import-leads')

const TRIGGER_PHRASES = [
  'just import this CSV',
  'load these leads without qualifying',
  'bulk import this file',
  'add these prospects to the DB',
  'pull this Notion DB into YALC',
]

describe('import-leads skill', () => {
  it('SKILL.md exists with frontmatter', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    expect(raw).toMatch(/^name:\s*import-leads\s*$/m)
    expect(raw).toMatch(/^version:\s*1\.0\.0\s*$/m)
  })

  it('description includes all 5 trigger phrases', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    const fm = raw.slice(4, raw.indexOf('\n---', 4))
    const desc = fm.match(/description:\s*"([\s\S]*?)"\s*$/m)![1]
    for (const p of TRIGGER_PHRASES) expect(desc).toContain(`'${p}'`)
  })

  it('body references leads:import', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    expect(raw).toContain('leads:import')
    expect(raw).toContain('--source')
    expect(raw).toContain('--input')
  })

  it('example-output.md exists', () => {
    expect(existsSync(join(SKILL_DIR, 'references', 'example-output.md'))).toBe(true)
  })

  it('triggers do not collide with siblings', () => {
    const FORBIDDEN = ['qualify these leads', 'list adapters', 'set up YALC', 'scrape engagers']
    for (const p of TRIGGER_PHRASES) {
      for (const f of FORBIDDEN) {
        expect(p.toLowerCase().includes(f.toLowerCase())).toBe(false)
        expect(f.toLowerCase().includes(p.toLowerCase())).toBe(false)
      }
    }
  })
})
