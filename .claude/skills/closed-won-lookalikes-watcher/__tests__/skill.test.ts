/**
 * closed-won-lookalikes-watcher skill — sanity tests.
 *
 * Mirrors the structure validation pattern used by claap-weekly-recap
 * and find-lookalikes: frontmatter shape, trigger phrases, body
 * references, agent YAML shape.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

const SKILL_DIR = join(
  process.cwd(),
  '.claude',
  'skills',
  'closed-won-lookalikes-watcher',
)

const TRIGGER_PHRASES = [
  'closed-won lookalikes',
  'weekly compound prospecting',
  'lookalike watcher',
  'mine my closed-won pattern',
  'who should I prospect next based on what closed last week',
]

describe('closed-won-lookalikes-watcher skill', () => {
  it('SKILL.md exists with frontmatter', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    expect(raw).toMatch(/^name:\s*closed-won-lookalikes-watcher\s*$/m)
    expect(raw).toMatch(/^version:\s*1\.0\.0\s*$/m)
  })

  it('description includes all 5 trigger phrases', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    const closeIdx = raw.indexOf('\n---', 4)
    const fm = raw.slice(4, closeIdx)
    const desc = fm.match(/description:\s*"([\s\S]*?)"\s*$/m)![1]
    for (const p of TRIGGER_PHRASES) expect(desc).toContain(`'${p}'`)
  })

  it('body references SETUP MODE, find-lookalikes, FullEnrich, intelligence store, dedup', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    expect(raw).toContain('SETUP MODE')
    expect(raw).toContain('find-lookalikes')
    expect(raw).toContain('FullEnrich')
    expect(raw).toContain('intelligence store')
    expect(raw).toContain('buildSuppressionSet')
    expect(raw).toContain("category: 'icp'")
    expect(raw).toContain("confidence: 'hypothesis'")
  })

  it('references/setup.md exists', () => {
    expect(existsSync(join(SKILL_DIR, 'references', 'setup.md'))).toBe(true)
  })

  it('gitignores .config.json', () => {
    const path = join(SKILL_DIR, '.gitignore')
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf-8')).toContain('.config.json')
  })

  it('triggers do not collide with sibling skills', () => {
    const FORBIDDEN = [
      'find lookalikes',
      'enrich these companies with signals',
      'qualify these leads',
      'set up YALC',
      'weekly call recap',
    ]
    for (const p of TRIGGER_PHRASES) {
      for (const f of FORBIDDEN) {
        expect(p.toLowerCase().includes(f.toLowerCase())).toBe(false)
        expect(f.toLowerCase().includes(p.toLowerCase())).toBe(false)
      }
    }
  })
})

describe('closed-won-lookalikes-watcher agent yaml', () => {
  const agentYamlPath = join(
    process.cwd(),
    'configs',
    'agents',
    'closed-won-lookalikes-watcher.yaml',
  )

  it('exists and parses', () => {
    expect(existsSync(agentYamlPath)).toBe(true)
    const raw = readFileSync(agentYamlPath, 'utf-8')
    expect(() => yaml.load(raw)).not.toThrow()
  })

  it('schedule format matches claap-weekly-recap (weekly weekday hour minute)', () => {
    const claap = yaml.load(
      readFileSync(
        join(process.cwd(), 'configs', 'agents', 'claap-weekly-recap.yaml'),
        'utf-8',
      ),
    ) as { schedule: Record<string, unknown> }
    const own = yaml.load(readFileSync(agentYamlPath, 'utf-8')) as {
      schedule: Record<string, unknown>
      maxRetries: number
      timeoutMs: number
      id: string
      steps: Array<{ skillId: string }>
    }

    // Same shape: weekly + weekday + hour + minute
    const claapKeys = new Set(Object.keys(claap.schedule))
    for (const k of Object.keys(own.schedule)) {
      expect(claapKeys.has(k)).toBe(true)
    }
    expect(own.schedule.type).toBe('weekly')
    expect(own.schedule.weekday).toBe('monday')
    expect(own.schedule.hour).toBe(9)
    expect(own.schedule.minute).toBe(0)
  })

  it('uses maxRetries 1 and timeoutMs 1800000', () => {
    const cfg = yaml.load(readFileSync(agentYamlPath, 'utf-8')) as {
      maxRetries: number
      timeoutMs: number
      id: string
      steps: Array<{ skillId: string }>
    }
    expect(cfg.maxRetries).toBe(1)
    expect(cfg.timeoutMs).toBe(1800000)
    expect(cfg.id).toBe('closed-won-lookalikes-watcher')
    expect(cfg.steps[0].skillId).toBe('closed-won-lookalikes-watcher')
  })
})
