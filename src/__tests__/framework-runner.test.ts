import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import yaml from 'js-yaml'

import { substituteStepInput, FrameworkRunError, runFramework } from '../lib/frameworks/runner'
import { saveInstalledConfig, removeInstalledConfig } from '../lib/frameworks/registry'
import { getSkillRegistry } from '../lib/skills/registry'
import type { InstalledFrameworkConfig } from '../lib/frameworks/types'
import type { Skill } from '../lib/skills/types'

/**
 * The runner reads frameworks from `configs/frameworks/` and writes to
 * `~/.gtm-os/agents/<name>.runs/`. We isolate HOME so the test never
 * touches the user's real state, and we register a deterministic skill
 * directly with the registry to avoid network/provider concerns.
 */

const sampleFramework = (name: string) => `
name: ${name}
display_name: "Runner Test"
description: "A throwaway framework used by the runner tests."
inputs:
  - name: who
    description: "Salutation target."
    default: "world"
schedule:
  cron: "0 8 * * *"
steps:
  - skill: runner-greet
    input:
      who: "{{who}}"
  - skill: runner-tail
    input:
      previous: "{{steps[0].output}}"
output:
  destination_choice:
    - dashboard:
        route: "/frameworks/${name}"
seed_run:
  description: "Seed run for unit tests."
  override_inputs:
    who: "seeded"
`

function makeGreetSkill(): Skill {
  return {
    id: 'runner-greet',
    name: 'Runner Greet',
    version: '1.0.0',
    description: 'Test-only greet skill.',
    category: 'data',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    requiredCapabilities: [],
    async *execute(input) {
      const i = input as { who?: string }
      yield { type: 'result', data: { greeting: `hello ${i.who ?? 'unknown'}` } }
    },
  }
}

function makeTailSkill(seen: Array<unknown>): Skill {
  return {
    id: 'runner-tail',
    name: 'Runner Tail',
    version: '1.0.0',
    description: 'Test-only tail skill that records what was passed in.',
    category: 'data',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    requiredCapabilities: [],
    async *execute(input) {
      seen.push(input)
      yield { type: 'result', data: { rows: [{ ok: true }] } }
    },
  }
}

function makeFailingSkill(): Skill {
  return {
    id: 'runner-tail',
    name: 'Runner Tail',
    version: '1.0.0',
    description: 'Test-only failing skill.',
    category: 'data',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    requiredCapabilities: [],
    async *execute() {
      yield { type: 'error', message: 'simulated step failure' }
    },
  }
}

describe('substituteStepInput', () => {
  it('substitutes {{var}} from inputs', () => {
    expect(substituteStepInput('hello {{who}}', { who: 'world' }, [])).toBe('hello world')
  })
  it('substitutes whole-value {{steps[N].output}} with the array', () => {
    const out = substituteStepInput('{{steps[0].output}}', {}, [[{ a: 1 }]])
    expect(out).toEqual([{ a: 1 }])
  })
  it('recurses into nested objects + arrays', () => {
    const out = substituteStepInput({ k: ['{{x}}', { y: '{{x}}' }] }, { x: 'X' }, [])
    expect(out).toEqual({ k: ['X', { y: 'X' }] })
  })
})

describe('framework runner (HOME-isolated)', () => {
  let prevHome: string | undefined
  let prevCwd: string
  let tempHome: string
  let frameworkName: string
  let frameworkPath: string
  let bundledFwDir: string

  beforeEach(() => {
    prevHome = process.env.HOME
    prevCwd = process.cwd()
    tempHome = join(tmpdir(), `yalc-runner-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
    // Frameworks are loaded from PKG_ROOT/configs/frameworks. Drop a
    // throwaway file there with a unique name and clean it up after.
    frameworkName = `runner-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
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
      display_name: 'Runner Test',
      description: 'desc',
      installed_at: new Date().toISOString(),
      schedule: { cron: '0 8 * * *' },
      output: { destination: 'dashboard', dashboard_route: `/frameworks/${frameworkName}` },
      inputs: { who: 'world' },
    }
    saveInstalledConfig(cfg)
    return cfg
  }

  it('happy-path: executes both steps and writes a run JSON without error field', async () => {
    installCfg()
    const seen: unknown[] = []
    const reg = getSkillRegistry()
    reg.register(makeGreetSkill())
    reg.register(makeTailSkill(seen))
    try {
      const { path, run } = await runFramework(frameworkName)
      expect(existsSync(path)).toBe(true)
      const persisted = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
      expect(persisted.error).toBeUndefined()
      expect(run.rows.length).toBeGreaterThan(0)
      // Tail step received the substituted previous output (array shape).
      const tailInput = seen[0] as { previous: unknown }
      expect(tailInput.previous).toEqual({ greeting: 'hello world' })
    } finally {
      reg.unregister('runner-greet')
      reg.unregister('runner-tail')
      removeInstalledConfig(frameworkName)
    }
  })

  it('mid-run failure halts and writes a partial run JSON with error.step', async () => {
    installCfg()
    const reg = getSkillRegistry()
    reg.register(makeGreetSkill())
    reg.register(makeFailingSkill())
    try {
      await expect(runFramework(frameworkName)).rejects.toBeInstanceOf(FrameworkRunError)
      const runsDir = join(tempHome, '.gtm-os', 'agents', `${frameworkName}.runs`)
      const files = readdirSync(runsDir)
      expect(files.length).toBe(1)
      const persisted = JSON.parse(readFileSync(join(runsDir, files[0]), 'utf-8')) as {
        error?: { step: number; message: string }
      }
      expect(persisted.error).toBeTruthy()
      expect(persisted.error?.step).toBe(1)
      expect(persisted.error?.message).toMatch(/simulated step failure/)
    } finally {
      reg.unregister('runner-greet')
      reg.unregister('runner-tail')
      removeInstalledConfig(frameworkName)
    }
  })

  it('--seed flag uses seed_run.override_inputs', async () => {
    installCfg()
    const seen: unknown[] = []
    const reg = getSkillRegistry()
    const greetSeen: unknown[] = []
    const greet: Skill = {
      ...makeGreetSkill(),
      async *execute(input) {
        greetSeen.push(input)
        const i = input as { who?: string }
        yield { type: 'result', data: { greeting: `hello ${i.who ?? '?'}` } }
      },
    }
    reg.register(greet)
    reg.register(makeTailSkill(seen))
    try {
      const { run } = await runFramework(frameworkName, { seed: true })
      expect(greetSeen[0]).toEqual({ who: 'seeded' })
      expect((run.meta as { seed: boolean }).seed).toBe(true)
    } finally {
      reg.unregister('runner-greet')
      reg.unregister('runner-tail')
      removeInstalledConfig(frameworkName)
    }
  })

  it('manual and seed runs share the same output structure', async () => {
    installCfg()
    const reg = getSkillRegistry()
    reg.register(makeGreetSkill())
    reg.register(makeTailSkill([]))
    try {
      const manual = await runFramework(frameworkName)
      const seed = await runFramework(frameworkName, { seed: true })
      const manualKeys = Object.keys(manual.run).sort()
      const seedKeys = Object.keys(seed.run).sort()
      expect(seedKeys).toEqual(manualKeys)
      // Both paths must be valid persisted JSON files.
      expect(existsSync(manual.path)).toBe(true)
      expect(existsSync(seed.path)).toBe(true)
    } finally {
      reg.unregister('runner-greet')
      reg.unregister('runner-tail')
      removeInstalledConfig(frameworkName)
    }
  })
})

// silence unused import warning when the test file is read but skipped
void yaml
void vi
