/**
 * show-routine skill — sanity tests (Tier 4, read-only shell-out).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKILL_DIR = join(process.cwd(), '.claude', 'skills', 'show-routine')

const TRIGGER_PHRASES = [
  'show my routine',
  'what would YALC propose',
  'preview the routine',
  'dry-run the routine generator',
  'just show me the proposal',
]

describe('show-routine skill', () => {
  it('SKILL.md exists with frontmatter', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    expect(raw).toMatch(/^name:\s*show-routine\s*$/m)
    expect(raw).toMatch(/^version:\s*1\.0\.0\s*$/m)
  })

  it('description includes all 5 trigger phrases', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    const fm = raw.slice(4, raw.indexOf('\n---', 4))
    const desc = fm.match(/description:\s*"([\s\S]*?)"\s*$/m)![1]
    for (const p of TRIGGER_PHRASES) expect(desc).toContain(`'${p}'`)
  })

  it('body references routine:propose --json', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    expect(raw).toContain('routine:propose --json')
  })

  it('example-output.md exists', () => {
    expect(existsSync(join(SKILL_DIR, 'references', 'example-output.md'))).toBe(true)
  })

  it('triggers do not collide with build-routine and others', () => {
    const FORBIDDEN = [
      'build my sales routine',
      'set up a sales routine',
      'auto-derive my routine',
      'list adapters',
      'set up YALC',
    ]
    for (const p of TRIGGER_PHRASES) {
      for (const f of FORBIDDEN) {
        expect(p.toLowerCase().includes(f.toLowerCase())).toBe(false)
        expect(f.toLowerCase().includes(p.toLowerCase())).toBe(false)
      }
    }
  })
})
