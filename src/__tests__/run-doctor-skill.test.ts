/**
 * run-doctor skill — sanity tests (Tier 4, import-direct).
 *
 * 1. SKILL.md exists with the required frontmatter (name, version, description).
 * 2. Description includes all 6 spec-mandated trigger phrases as quoted strings.
 * 3. The skill body references `runDoctor` and the import path actually exists
 *    in the lib so the import-direct runner won't break silently.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SKILL_DIR = join(process.cwd(), '.claude', 'skills', 'run-doctor')

const TRIGGER_PHRASES = [
  'is YALC working',
  'diagnose YALC',
  'check YALC health',
  'is everything configured',
  'run the health check',
  'are my keys set up',
]

describe('run-doctor skill', () => {
  it('SKILL.md exists with required frontmatter fields', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    // Frontmatter delimited by `---` on its own line at the start.
    expect(raw.startsWith('---\n')).toBe(true)
    const closeIdx = raw.indexOf('\n---', 4)
    expect(closeIdx).toBeGreaterThan(0)
    const fm = raw.slice(4, closeIdx)
    expect(fm).toMatch(/^name:\s*run-doctor\s*$/m)
    expect(fm).toMatch(/^version:\s*1\.0\.0\s*$/m)
    expect(fm).toMatch(/^description:/m)
  })

  it('description includes all 6 trigger phrases as quoted strings', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    const raw = readFileSync(path, 'utf-8')
    const closeIdx = raw.indexOf('\n---', 4)
    const fm = raw.slice(4, closeIdx)
    // Pull the description value out of the frontmatter.
    const descMatch = fm.match(/description:\s*"([\s\S]*?)"\s*$/m)
    expect(descMatch).not.toBeNull()
    const desc = descMatch![1]
    for (const phrase of TRIGGER_PHRASES) {
      // Phrase must appear surrounded by single quotes — that's how the
      // skill router signals "exact trigger string" vs prose context.
      expect(desc).toContain(`'${phrase}'`)
    }
  })

  it('SKILL.md body references the runDoctor function', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    const raw = readFileSync(path, 'utf-8')
    expect(raw).toContain('runDoctor')
    // The import-direct runner pattern: it must point at the real module path.
    // Path is built via shell expansion ($PWD) so the runner can live in
    // /tmp/ but resolve against the gtm-os root. Either form is acceptable.
    expect(raw).toMatch(/src\/lib\/diagnostics\/doctor\.ts/)
  })

  it('runDoctor is actually exported from the lib path the skill references', async () => {
    const mod = await import('../lib/diagnostics/doctor')
    expect(typeof mod.runDoctor).toBe('function')
    // Sanity check: keysConnectUrlFor is also exported (used by A5 to build
    // the /keys/connect/<provider> URLs the skill surfaces).
    expect(typeof mod.keysConnectUrlFor).toBe('function')
  })

  it('references/example-output.md exists and shows a connect URL', () => {
    const path = join(SKILL_DIR, 'references', 'example-output.md')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    // The example must demonstrate the URL surfacing — that's the whole
    // point of the skill rendering FAILs alongside their connect link.
    expect(raw).toContain('http://localhost:3847/keys/connect/')
  })

  it('description trigger phrases do not collide with sibling skills', () => {
    // The 6 trigger phrases must avoid substring overlap with `setup`'s
    // 'set up YALC' and `debugger`'s 'debug', 'fix', 'not working',
    // 'broken', 'troubleshoot' so the router doesn't misroute.
    const FORBIDDEN = ['set up YALC', 'debug', 'troubleshoot', 'broken', 'not working']
    for (const phrase of TRIGGER_PHRASES) {
      const lower = phrase.toLowerCase()
      for (const f of FORBIDDEN) {
        expect(lower.includes(f.toLowerCase())).toBe(false)
      }
    }
  })
})
