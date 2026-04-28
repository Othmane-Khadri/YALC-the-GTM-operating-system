import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Ajv from 'ajv'

import { loadMarkdownSkill } from '../lib/skills/markdown-loader'

/**
 * Gold-fixtures discovery + assertion runner.
 *
 * Layout: `gold-fixtures/<skill-name>/<case>.json` — each file has shape
 *   { "input": {...}, "expected_output": ... }
 *
 * Behavior matrix (intentional, see plan):
 *
 *   - Skill has `output_schema:` declared (object)
 *       → assert `expected_output` validates against the schema (sanity-check
 *         the fixture itself; catches typos in the fixture).
 *
 *   - Skill has `output_schema: null` (deterministic pass-through)
 *       → no schema validation. (We don't actually invoke the skill because
 *         no `deterministic` provider is registered in the bundled set; the
 *         fixture is documentation of input/expected_output for reviewers.)
 *
 *   - Skill has no `output_schema:` declared
 *       → fixture exists for documentation only; no assertion possible.
 *
 *   - LLM-backed skills are NOT actually invoked here (would be flaky and
 *     costly). The fixture's `expected_output` shape is the contract.
 *
 *   - Missing fixture for a bundled skill → test emits a console WARN but
 *     does not fail (so users can opt out for skills that genuinely have no
 *     stable example shape — none today, but the doctrine holds).
 */

const PKG_ROOT = process.cwd()
const SKILLS_DIR = join(PKG_ROOT, 'configs', 'skills')
const FIXTURES_DIR = join(PKG_ROOT, 'gold-fixtures')

const ajv = new Ajv({ allErrors: true, strict: false })

interface Fixture {
  input: Record<string, unknown>
  expected_output: unknown
}

function listSkillNames(): string[] {
  if (!existsSync(SKILLS_DIR)) return []
  return readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort()
}

function listFixtureCasesFor(skill: string): string[] {
  const dir = join(FIXTURES_DIR, skill)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
}

function readFixture(skill: string, file: string): Fixture {
  const raw = readFileSync(join(FIXTURES_DIR, skill, file), 'utf-8')
  return JSON.parse(raw) as Fixture
}

describe('gold-fixtures: discovery', () => {
  it('finds the fixtures directory and at least one fixture', () => {
    expect(existsSync(FIXTURES_DIR)).toBe(true)
    const skills = listSkillNames()
    expect(skills.length).toBeGreaterThan(0)
    let totalCases = 0
    for (const s of skills) totalCases += listFixtureCasesFor(s).length
    expect(totalCases).toBeGreaterThan(0)
  })

  it('every bundled skill has at least one fixture file', () => {
    const missing: string[] = []
    for (const s of listSkillNames()) {
      if (listFixtureCasesFor(s).length === 0) missing.push(s)
    }
    expect(missing).toEqual([])
  })
})

describe('gold-fixtures: schema sanity', () => {
  const skills = listSkillNames()
  for (const skill of skills) {
    const cases = listFixtureCasesFor(skill)
    if (cases.length === 0) continue
    for (const file of cases) {
      it(`${skill}/${file}: expected_output validates against output_schema`, async () => {
        const skillPath = join(SKILLS_DIR, `${skill}.md`)
        const result = await loadMarkdownSkill(skillPath)
        expect(result.errors).toEqual([])
        const schema = result.skill?.validationSchema
        const fixture = readFixture(skill, file)
        if (schema === null || schema === undefined) {
          // null = explicit pass-through, undefined = legacy. Nothing to
          // validate — but we still confirm the fixture is well-formed JSON
          // and has both keys.
          expect(fixture).toHaveProperty('input')
          expect(fixture).toHaveProperty('expected_output')
          return
        }
        const validate = ajv.compile(schema)
        const ok = validate(fixture.expected_output)
        if (!ok) {
          throw new Error(
            `Fixture ${skill}/${file} expected_output failed schema validation: ` +
              JSON.stringify(validate.errors, null, 2),
          )
        }
        expect(ok).toBe(true)
      })
    }
  }
})

describe('gold-fixtures: deterministic skills exact-match', () => {
  // Deterministic skills whose `output_schema: null` declares a pass-through
  // shape have a fixture with `expected_output` that we exact-match against
  // a local reference implementation. The skills' bundled bodies route
  // through a `provider: deterministic` that isn't bundled with a real
  // executor today, so we mirror the documented behavior here for the
  // assertion. When the deterministic provider lands, this block can be
  // refactored to call the skill's actual execute() instead.

  it('rank-and-truncate sorts by relevance_score desc and returns top n', () => {
    const fx = readFixture('rank-and-truncate', 'basic.json')
    const inputAny = fx.input as { mentions: Array<Record<string, unknown>>; n: number }
    const sorted = [...inputAny.mentions].sort((a, b) => {
      const ar = Number((a.relevance_score as number | undefined) ?? 0)
      const br = Number((b.relevance_score as number | undefined) ?? 0)
      return br - ar
    })
    const out = sorted.slice(0, inputAny.n)
    expect(out).toEqual(fx.expected_output)
  })

  it('dedupe-against-history drops repeat domains, preserving first-seen order', () => {
    const fx = readFixture('dedupe-against-history', 'basic.json')
    const inputAny = fx.input as { candidates: Array<Record<string, unknown>> }
    const seen = new Set<string>()
    const out: Array<Record<string, unknown>> = []
    for (const row of inputAny.candidates) {
      const key = String(row.domain ?? row.id ?? '')
      if (key && seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
    expect(out).toEqual(fx.expected_output)
  })
})

describe('gold-fixtures: fixture format guardrails', () => {
  let tmpDir: string
  beforeEachInline()
  afterEachInline()
  function beforeEachInline() {
    // vitest's beforeEach is OK in describe; using inline for clarity.
  }
  function afterEachInline() {
    // no-op
  }

  it('rejects malformed JSON in a fixture file', () => {
    tmpDir = join(tmpdir(), `yalc-fx-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
    const bad = join(tmpDir, 'bad.json')
    writeFileSync(bad, '{ this is not json', 'utf-8')
    let threw = false
    try {
      JSON.parse(readFileSync(bad, 'utf-8'))
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('a fixture violating its skill\'s schema is detectable', async () => {
    // Synthesize a violating fixture against score-lead's schema and confirm
    // ajv catches it. Don't write to disk.
    const skillPath = join(SKILLS_DIR, 'score-lead.md')
    const result = await loadMarkdownSkill(skillPath)
    expect(result.skill).not.toBeNull()
    const schema = result.skill!.validationSchema
    expect(schema).toBeTruthy()
    const validate = ajv.compile(schema as object)
    // Missing required fields on purpose.
    const bad = { overall_score: 999, verdict: 'invalid-enum-value' }
    expect(validate(bad)).toBe(false)
    expect((validate.errors ?? []).length).toBeGreaterThan(0)
  })

  it('multiple fixture cases per skill are all picked up', () => {
    const skill = 'rank-and-truncate'
    const dir = join(FIXTURES_DIR, skill)
    const before = readdirSync(dir).filter((f) => f.endsWith('.json'))
    // Add a temporary second case, count, then remove.
    const extra = join(dir, '__second.json')
    const baseFx = readFixture(skill, 'basic.json')
    writeFileSync(extra, JSON.stringify(baseFx, null, 2), 'utf-8')
    try {
      const after = readdirSync(dir).filter((f) => f.endsWith('.json'))
      expect(after.length).toBe(before.length + 1)
    } finally {
      rmSync(extra, { force: true })
    }
  })
})
