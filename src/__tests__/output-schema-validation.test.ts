import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  runFramework,
  FrameworkRunError,
  unwrapForValidation,
  validateStepOutput,
} from '../lib/frameworks/runner'
import { saveInstalledConfig, removeInstalledConfig } from '../lib/frameworks/registry'
import { getSkillRegistry } from '../lib/skills/registry'
import { loadMarkdownSkill } from '../lib/skills/markdown-loader'
import type { InstalledFrameworkConfig } from '../lib/frameworks/types'
import type { Skill } from '../lib/skills/types'

/**
 * Validates the new `output_schema:` frontmatter field and its runtime
 * enforcement in the framework runner. Schemas are AJV-compiled (Draft 7
 * with strict:false). Skills without `output_schema:` (legacy) skip
 * validation entirely.
 */

const sampleFramework = (name: string) => `
name: ${name}
display_name: "Schema Test"
description: "A throwaway framework used by output-schema tests."
inputs:
  - name: who
    description: "Salutation target."
    default: "world"
schedule:
  cron: "0 8 * * *"
steps:
  - skill: schema-emit
    input:
      who: "{{who}}"
output:
  destination_choice:
    - dashboard:
        route: "/frameworks/${name}"
seed_run:
  description: "Seed."
  override_inputs:
    who: "seeded"
`

function makeSkillReturning(
  data: unknown,
  validationSchema: Record<string, unknown> | null | undefined,
): Skill {
  return {
    id: 'schema-emit',
    name: 'Schema Emit',
    version: '1.0.0',
    description: 'Emits a fixed value for schema-validation testing.',
    category: 'data',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    validationSchema,
    requiredCapabilities: [],
    async *execute() {
      yield { type: 'result', data }
    },
  }
}

describe('unwrapForValidation', () => {
  it('parses JSON out of a {text} reasoning result', () => {
    expect(unwrapForValidation({ text: '{"a":1}' })).toEqual({ a: 1 })
  })
  it('strips ```json fences before parsing', () => {
    expect(unwrapForValidation({ text: '```json\n{"a":1}\n```' })).toEqual({ a: 1 })
  })
  it('passes through arrays and objects unchanged', () => {
    expect(unwrapForValidation([{ a: 1 }])).toEqual([{ a: 1 }])
    expect(unwrapForValidation({ b: 2 })).toEqual({ b: 2 })
  })
  it('returns the original text when JSON parse fails', () => {
    expect(unwrapForValidation({ text: 'not json' })).toBe('not json')
  })
})

describe('validateStepOutput unit', () => {
  it('returns null for a skill with no validationSchema', () => {
    const skill = makeSkillReturning({ a: 1 }, undefined)
    expect(validateStepOutput(skill, { a: 1 })).toBeNull()
  })
  it('returns null for explicit pass-through (validationSchema = null)', () => {
    const skill = makeSkillReturning({ a: 1 }, null)
    expect(validateStepOutput(skill, { a: 1 })).toBeNull()
  })
  it('returns AJV errors when output violates the schema', () => {
    const schema = {
      type: 'object',
      properties: { count: { type: 'integer' } },
      required: ['count'],
      additionalProperties: false,
    }
    const skill = makeSkillReturning({ count: 'oops' }, schema)
    const errors = validateStepOutput(skill, { count: 'oops' })
    expect(errors).not.toBeNull()
    expect(errors!.length).toBeGreaterThan(0)
  })
  it('honors additionalProperties: false strictness', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'integer' } },
      required: ['a'],
      additionalProperties: false,
    }
    const skill = makeSkillReturning({ a: 1, surprise: true }, schema)
    const errors = validateStepOutput(skill, { a: 1, surprise: true })
    expect(errors).not.toBeNull()
    expect(errors!.some((e) => /additionalProperties|surprise/i.test(JSON.stringify(e)))).toBe(true)
  })
  it('validates arrays with nested object items', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: { score: { type: 'integer', minimum: 0, maximum: 100 } },
        required: ['score'],
      },
    }
    const skill = makeSkillReturning([{ score: 50 }], schema)
    expect(validateStepOutput(skill, [{ score: 50 }])).toBeNull()
    const bad = makeSkillReturning([{ score: 'high' }], schema)
    expect(validateStepOutput(bad, [{ score: 'high' }])).not.toBeNull()
  })
  it('resolves $defs / $ref refs', () => {
    const schema = {
      $defs: { Score: { type: 'integer', minimum: 0, maximum: 100 } },
      type: 'object',
      properties: { overall: { $ref: '#/$defs/Score' } },
      required: ['overall'],
    }
    const skill = makeSkillReturning({ overall: 80 }, schema)
    expect(validateStepOutput(skill, { overall: 80 })).toBeNull()
    expect(validateStepOutput(skill, { overall: 200 })).not.toBeNull()
  })
})

describe('output_schema in markdown frontmatter (load-time)', () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = join(tmpdir(), `yalc-md-schema-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
  })
  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('parses a nested output_schema and stashes it on the skill', async () => {
    const file = join(tmpDir, 'with-schema.md')
    writeFileSync(
      file,
      `---
name: with-schema
description: A schema-bearing skill
provider: mock
inputs:
  - name: q
    description: query
    required: true
output_schema:
  type: object
  properties:
    score:
      type: integer
  required:
    - score
---

Use {{q}}.
`,
      'utf-8',
    )
    const result = await loadMarkdownSkill(file)
    expect(result.errors).toEqual([])
    expect(result.skill).not.toBeNull()
    expect(result.skill!.validationSchema).toEqual({
      type: 'object',
      properties: { score: { type: 'integer' } },
      required: ['score'],
    })
  })

  it('treats output_schema: null as explicit pass-through', async () => {
    const file = join(tmpDir, 'null-schema.md')
    writeFileSync(
      file,
      `---
name: null-schema
description: A pass-through skill
provider: mock
inputs:
  - name: q
    description: query
    required: true
output_schema: null
---

Body.
`,
      'utf-8',
    )
    const result = await loadMarkdownSkill(file)
    expect(result.errors).toEqual([])
    expect(result.skill!.validationSchema).toBeNull()
  })

  it('flags a malformed schema at load time', async () => {
    const file = join(tmpDir, 'bad-schema.md')
    writeFileSync(
      file,
      `---
name: bad-schema
description: Has a bad schema
provider: mock
inputs:
  - name: q
    description: query
    required: true
output_schema:
  type: not-a-real-type
---

Body.
`,
      'utf-8',
    )
    const result = await loadMarkdownSkill(file)
    expect(result.errors.some((e) => /output_schema/.test(e))).toBe(true)
  })
})

describe('framework runner: output_schema enforcement', () => {
  let prevHome: string | undefined
  let prevCwd: string
  let tempHome: string
  let frameworkName: string
  let frameworkPath: string
  let bundledFwDir: string

  beforeEach(() => {
    prevHome = process.env.HOME
    prevCwd = process.cwd()
    tempHome = join(tmpdir(), `yalc-schema-runner-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
    frameworkName = `schema-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    bundledFwDir = join(prevCwd, 'configs', 'frameworks')
    frameworkPath = join(bundledFwDir, `${frameworkName}.yaml`)
    writeFileSync(frameworkPath, sampleFramework(frameworkName), 'utf-8')
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(frameworkPath)) rmSync(frameworkPath, { force: true })
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  function installCfg(): InstalledFrameworkConfig {
    const cfg: InstalledFrameworkConfig = {
      name: frameworkName,
      display_name: 'Schema Test',
      description: 'desc',
      installed_at: new Date().toISOString(),
      schedule: { cron: '0 8 * * *' },
      output: { destination: 'dashboard', dashboard_route: `/frameworks/${frameworkName}` },
      inputs: { who: 'world' },
    }
    saveInstalledConfig(cfg)
    return cfg
  }

  it('halts the run when a step output fails its declared schema', async () => {
    installCfg()
    const reg = getSkillRegistry()
    const schema = {
      type: 'object',
      properties: { score: { type: 'integer' } },
      required: ['score'],
      additionalProperties: false,
    }
    reg.register(makeSkillReturning({ score: 'not-a-number' }, schema))
    try {
      await expect(runFramework(frameworkName)).rejects.toBeInstanceOf(FrameworkRunError)
      const runsDir = join(tempHome, '.gtm-os', 'agents', `${frameworkName}.runs`)
      const files = readdirSync(runsDir)
      expect(files.length).toBe(1)
      const persisted = JSON.parse(readFileSync(join(runsDir, files[0]), 'utf-8')) as {
        error?: { step: number; message: string; validation_errors?: unknown[] }
      }
      expect(persisted.error).toBeTruthy()
      expect(persisted.error?.step).toBe(0)
      expect(persisted.error?.message).toMatch(/schema validation failed/i)
      expect(Array.isArray(persisted.error?.validation_errors)).toBe(true)
      expect((persisted.error?.validation_errors ?? []).length).toBeGreaterThan(0)
    } finally {
      reg.unregister('schema-emit')
      removeInstalledConfig(frameworkName)
    }
  })

  it('completes the run when output matches the schema', async () => {
    installCfg()
    const reg = getSkillRegistry()
    const schema = {
      type: 'object',
      properties: { score: { type: 'integer' } },
      required: ['score'],
    }
    reg.register(makeSkillReturning({ score: 80 }, schema))
    try {
      const { run } = await runFramework(frameworkName)
      expect((run as unknown as { error?: unknown }).error).toBeUndefined()
    } finally {
      reg.unregister('schema-emit')
      removeInstalledConfig(frameworkName)
    }
  })

  it('completes the run when validationSchema is undefined (legacy skills not validated)', async () => {
    installCfg()
    const reg = getSkillRegistry()
    // Returns a "wrong" shape — no schema means no enforcement.
    reg.register(makeSkillReturning({ random: 'shape' }, undefined))
    try {
      const { run } = await runFramework(frameworkName)
      expect((run as unknown as { error?: unknown }).error).toBeUndefined()
    } finally {
      reg.unregister('schema-emit')
      removeInstalledConfig(frameworkName)
    }
  })

  it('completes the run when validationSchema is null (explicit pass-through)', async () => {
    installCfg()
    const reg = getSkillRegistry()
    reg.register(makeSkillReturning({ anything: 1 }, null))
    try {
      const { run } = await runFramework(frameworkName)
      expect((run as unknown as { error?: unknown }).error).toBeUndefined()
    } finally {
      reg.unregister('schema-emit')
      removeInstalledConfig(frameworkName)
    }
  })
})
