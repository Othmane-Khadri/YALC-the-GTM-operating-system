/**
 * send-cold-email skill — sanity tests (Tier 3, chained shell-out).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKILL_DIR = join(process.cwd(), '.claude', 'skills', 'send-cold-email')

const TRIGGER_PHRASES = [
  'send a cold email to this list',
  'fire the email sequence',
  'launch the email campaign',
  'send the drip sequence',
  'email these qualified leads',
]

describe('send-cold-email skill', () => {
  it('SKILL.md exists with frontmatter', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    expect(raw).toMatch(/^name:\s*send-cold-email\s*$/m)
    expect(raw).toMatch(/^version:\s*1\.0\.0\s*$/m)
  })

  it('description includes all 5 trigger phrases', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    const fm = raw.slice(4, raw.indexOf('\n---', 4))
    const desc = fm.match(/description:\s*"([\s\S]*?)"\s*$/m)![1]
    for (const p of TRIGGER_PHRASES) expect(desc).toContain(`'${p}'`)
  })

  it('body references both email CLI commands', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    expect(raw).toContain('email:create-sequence')
    expect(raw).toContain('email:send')
  })

  it('example-output.md exists', () => {
    expect(existsSync(join(SKILL_DIR, 'references', 'example-output.md'))).toBe(true)
  })

  it('triggers do not collide with siblings', () => {
    const FORBIDDEN = [
      'launch a LinkedIn campaign',
      'qualify these leads',
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
