/**
 * track-campaigns skill — sanity tests (Tier 3, shell-out).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKILL_DIR = join(process.cwd(), '.claude', 'skills', 'track-campaigns')

const TRIGGER_PHRASES = [
  'track campaigns',
  'advance the sequences',
  'check campaign progress',
  'poll for replies',
  'sync replies to Notion',
]

describe('track-campaigns skill', () => {
  it('SKILL.md exists with frontmatter', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    expect(raw).toMatch(/^name:\s*track-campaigns\s*$/m)
    expect(raw).toMatch(/^version:\s*1\.0\.0\s*$/m)
  })

  it('description includes all 5 trigger phrases', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    const fm = raw.slice(4, raw.indexOf('\n---', 4))
    const desc = fm.match(/description:\s*"([\s\S]*?)"\s*$/m)![1]
    for (const p of TRIGGER_PHRASES) expect(desc).toContain(`'${p}'`)
  })

  it('body references campaign:track', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    expect(raw).toContain('campaign:track')
  })

  it('example-output.md exists', () => {
    expect(existsSync(join(SKILL_DIR, 'references', 'example-output.md'))).toBe(true)
  })

  it('triggers do not collide with siblings', () => {
    const FORBIDDEN = [
      'launch a LinkedIn campaign',
      'send a cold email',
      'list adapters',
      'set up YALC',
      'campaign status',
      'show me campaigns',
    ]
    for (const p of TRIGGER_PHRASES) {
      for (const f of FORBIDDEN) {
        expect(p.toLowerCase().includes(f.toLowerCase())).toBe(false)
        expect(f.toLowerCase().includes(p.toLowerCase())).toBe(false)
      }
    }
  })
})
