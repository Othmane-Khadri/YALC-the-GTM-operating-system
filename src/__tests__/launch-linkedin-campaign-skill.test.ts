/**
 * launch-linkedin-campaign skill — sanity tests (Tier 1, chained shell-out).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKILL_DIR = join(process.cwd(), '.claude', 'skills', 'launch-linkedin-campaign')

const TRIGGER_PHRASES = [
  'launch a LinkedIn campaign for these leads',
  'send a LinkedIn outreach to this list',
  'start the outbound to the qualified leads',
  'run the LinkedIn sequence on this result set',
  'fire the connect-then-DM flow',
]

describe('launch-linkedin-campaign skill', () => {
  it('SKILL.md exists with required frontmatter fields', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    expect(raw.startsWith('---\n')).toBe(true)
    const closeIdx = raw.indexOf('\n---', 4)
    expect(closeIdx).toBeGreaterThan(0)
    const fm = raw.slice(4, closeIdx)
    expect(fm).toMatch(/^name:\s*launch-linkedin-campaign\s*$/m)
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

  it('SKILL.md body references both CLI commands', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    const raw = readFileSync(path, 'utf-8')
    expect(raw).toContain('campaign:create')
    expect(raw).toContain('campaign:create-sequence')
    expect(raw).toContain('--title')
    expect(raw).toContain('--hypothesis')
    expect(raw).toContain('--sequence')
    expect(raw).toContain('--source')
  })

  it('SKILL.md body enforces the hypothesis gate', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    const raw = readFileSync(path, 'utf-8')
    expect(raw).toContain('outreach-campaign-builder.hypothesis.json')
    expect(raw).toContain('framework:set-hypothesis')
    expect(raw.toLowerCase()).toContain('hypothesis gate')
  })

  it('SKILL.md does NOT reference invalid CLI flags (--result-set, --campaign-id, --variants)', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    const raw = readFileSync(path, 'utf-8')
    expect(raw).not.toMatch(/campaign:create\s+--result-set/)
    expect(raw).not.toMatch(/campaign:create-sequence\s+--campaign-id/)
    expect(raw).not.toMatch(/campaign:create-sequence\s+--variants\s+\d/)
  })

  it('references/example-output.md exists', () => {
    const path = join(SKILL_DIR, 'references', 'example-output.md')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    expect(raw).toContain('Campaign')
    expect(raw.toLowerCase()).toContain('sequence')
  })

  it('description trigger phrases do not collide with sibling skills', () => {
    const FORBIDDEN = [
      'is YALC working',
      'set up YALC',
      'list adapters',
      'qualify these leads',
      'add a new provider',
      'debug',
      'troubleshoot',
      'campaign status',
      'show me campaigns',
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
