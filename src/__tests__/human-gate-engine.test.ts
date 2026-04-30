/**
 * Tests for the runner's human-gate behaviour (0.9.E).
 *
 * Pattern mirrors framework-runner.test.ts: HOME-isolated tmpdir, a
 * throwaway framework yaml dropped into `configs/frameworks/`, and
 * deterministic skills registered with the live registry.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EXIT_CODE_AWAITING_GATE,
  FrameworkGatePauseError,
  runFramework,
  type AwaitingGateRecord,
} from '../lib/frameworks/runner'
import {
  removeInstalledConfig,
  saveInstalledConfig,
} from '../lib/frameworks/registry'
import { writeApproved, writeRejected } from '../lib/frameworks/gates'
import { getSkillRegistry } from '../lib/skills/registry'
import type { InstalledFrameworkConfig } from '../lib/frameworks/types'
import type { Skill } from '../lib/skills/types'

const sampleGateFramework = (name: string) => `
name: ${name}
display_name: "Gate Test"
description: "Throwaway framework with a human-gate step."
inputs:
  - name: who
    description: "Salutation target."
    default: "world"
schedule:
  cron: "0 8 * * *"
steps:
  - skill: gate-greet
    input:
      who: "{{who}}"
  - gate:
      id: human_review
      prompt: "Approve the greeting?"
      surface: ui-today
      payload_from_step: 0
  - skill: gate-tail
    input:
      previous: "{{steps[0].output}}"
      reason: "{{rejection_reason}}"
output:
  destination_choice:
    - dashboard:
        route: "/frameworks/${name}"
`

function makeGreetSkill(seen: Array<unknown>): Skill {
  return {
    id: 'gate-greet',
    name: 'Gate Greet',
    version: '1.0.0',
    description: 'Test-only greet skill.',
    category: 'data',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    requiredCapabilities: [],
    async *execute(input) {
      seen.push(input)
      const i = input as { who?: string }
      yield { type: 'result', data: { greeting: `hello ${i.who ?? '?'}` } }
    },
  }
}

function makeTailSkill(seen: Array<unknown>): Skill {
  return {
    id: 'gate-tail',
    name: 'Gate Tail',
    version: '1.0.0',
    description: 'Test-only tail skill that records its input.',
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

describe('framework runner — human-gate (HOME-isolated)', () => {
  let prevHome: string | undefined
  let prevCwd: string
  let tempHome: string
  let frameworkName: string
  let frameworkPath: string
  let bundledFwDir: string

  beforeEach(() => {
    prevHome = process.env.HOME
    prevCwd = process.cwd()
    tempHome = join(tmpdir(), `yalc-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
    frameworkName = `gate-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    bundledFwDir = join(prevCwd, 'configs', 'frameworks')
    frameworkPath = join(bundledFwDir, `${frameworkName}.yaml`)
    writeFileSync(frameworkPath, sampleGateFramework(frameworkName), 'utf-8')
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(frameworkPath)) rmSync(frameworkPath, { force: true })
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  function installCfg(): InstalledFrameworkConfig {
    const cfg: InstalledFrameworkConfig = {
      name: frameworkName,
      display_name: 'Gate Test',
      description: 'desc',
      installed_at: new Date().toISOString(),
      schedule: { cron: '0 8 * * *' },
      output: { destination: 'dashboard', dashboard_route: `/frameworks/${frameworkName}` },
      inputs: { who: 'world' },
    }
    saveInstalledConfig(cfg)
    return cfg
  }

  it('writes an awaiting-gate JSON sentinel with the documented shape', async () => {
    installCfg()
    const reg = getSkillRegistry()
    reg.register(makeGreetSkill([]))
    reg.register(makeTailSkill([]))
    try {
      await expect(runFramework(frameworkName)).rejects.toBeInstanceOf(FrameworkGatePauseError)
      const runsDir = join(tempHome, '.gtm-os', 'agents', `${frameworkName}.runs`)
      const files = readdirSync(runsDir).filter((f) => f.endsWith('.awaiting-gate.json'))
      expect(files.length).toBe(1)
      const record = JSON.parse(
        readFileSync(join(runsDir, files[0]), 'utf-8'),
      ) as AwaitingGateRecord
      expect(record.framework).toBe(frameworkName)
      expect(record.gate_id).toBe('human_review')
      expect(record.step_index).toBe(1)
      expect(record.payload).toEqual({ greeting: 'hello world' })
      expect(record.payload_step_index).toBe(0)
      expect(record.run_id).toBe(files[0].replace(/\.awaiting-gate\.json$/, ''))
    } finally {
      reg.unregister('gate-greet')
      reg.unregister('gate-tail')
      removeInstalledConfig(frameworkName)
    }
  })

  it('throws FrameworkGatePauseError carrying the EXIT_CODE_AWAITING_GATE constant (30)', async () => {
    installCfg()
    const reg = getSkillRegistry()
    reg.register(makeGreetSkill([]))
    reg.register(makeTailSkill([]))
    try {
      // Sanity: the constant matches the documented exit code.
      expect(EXIT_CODE_AWAITING_GATE).toBe(30)
      await expect(runFramework(frameworkName)).rejects.toMatchObject({
        name: 'FrameworkGatePauseError',
        gateId: 'human_review',
      })
    } finally {
      reg.unregister('gate-greet')
      reg.unregister('gate-tail')
      removeInstalledConfig(frameworkName)
    }
  })

  it('approve with no edits resumes from the next step using the original payload', async () => {
    installCfg()
    const tailSeen: unknown[] = []
    const reg = getSkillRegistry()
    reg.register(makeGreetSkill([]))
    reg.register(makeTailSkill(tailSeen))
    try {
      await expect(runFramework(frameworkName)).rejects.toBeInstanceOf(FrameworkGatePauseError)
      const runsDir = join(tempHome, '.gtm-os', 'agents', `${frameworkName}.runs`)
      const awaitingFile = readdirSync(runsDir).find((f) => f.endsWith('.awaiting-gate.json'))!
      const runId = awaitingFile.replace(/\.awaiting-gate\.json$/, '')
      const r = writeApproved(frameworkName, runId)
      expect(r.alreadyProcessed).toBe(false)
      const { runFrameworkResume } = await import('../cli/commands/framework')
      const resume = await runFrameworkResume(frameworkName, { fromGate: runId })
      expect(resume.mode).toBe('approved')
      // Tail step ran exactly once and saw the original (unedited) payload.
      expect(tailSeen).toHaveLength(1)
      expect((tailSeen[0] as { previous: unknown }).previous).toEqual({ greeting: 'hello world' })
    } finally {
      reg.unregister('gate-greet')
      reg.unregister('gate-tail')
      removeInstalledConfig(frameworkName)
    }
  })

  it('approve with edits applies the merged payload to the resumed run', async () => {
    installCfg()
    const tailSeen: unknown[] = []
    const reg = getSkillRegistry()
    reg.register(makeGreetSkill([]))
    reg.register(makeTailSkill(tailSeen))
    try {
      await expect(runFramework(frameworkName)).rejects.toBeInstanceOf(FrameworkGatePauseError)
      const runsDir = join(tempHome, '.gtm-os', 'agents', `${frameworkName}.runs`)
      const awaitingFile = readdirSync(runsDir).find((f) => f.endsWith('.awaiting-gate.json'))!
      const runId = awaitingFile.replace(/\.awaiting-gate\.json$/, '')
      writeApproved(frameworkName, runId, { greeting: 'EDITED' })
      const { runFrameworkResume } = await import('../cli/commands/framework')
      await runFrameworkResume(frameworkName, { fromGate: runId })
      expect((tailSeen[0] as { previous: unknown }).previous).toEqual({ greeting: 'EDITED' })
    } finally {
      reg.unregister('gate-greet')
      reg.unregister('gate-tail')
      removeInstalledConfig(frameworkName)
    }
  })

  it('reject + retry restarts from step 0 with rejection_reason in the context', async () => {
    installCfg()
    const greetSeen: unknown[] = []
    const tailSeen: unknown[] = []
    const reg = getSkillRegistry()
    reg.register(makeGreetSkill(greetSeen))
    reg.register(makeTailSkill(tailSeen))
    try {
      await expect(runFramework(frameworkName)).rejects.toBeInstanceOf(FrameworkGatePauseError)
      const runsDir = join(tempHome, '.gtm-os', 'agents', `${frameworkName}.runs`)
      const awaitingFile = readdirSync(runsDir).find((f) => f.endsWith('.awaiting-gate.json'))!
      const runId = awaitingFile.replace(/\.awaiting-gate\.json$/, '')
      writeRejected(frameworkName, runId, 'wrong tone of voice')
      const { runFrameworkResume } = await import('../cli/commands/framework')
      // The retry will hit the gate AGAIN (this framework still has a gate
      // step); we expect that pause to be observable.
      await expect(
        runFrameworkResume(frameworkName, { fromGate: runId }),
      ).rejects.toBeInstanceOf(FrameworkGatePauseError)
      // Greet ran twice (initial + retry).
      expect(greetSeen.length).toBeGreaterThanOrEqual(2)
      // Tail did not run on the retry — gate paused before it.
      expect(tailSeen.length).toBe(0)
      // Retry's awaiting-gate sentinel records the reason in `inputs`.
      const newAwaiting = readdirSync(runsDir).find((f) => f.endsWith('.awaiting-gate.json'))
      expect(newAwaiting).toBeDefined()
      const record = JSON.parse(
        readFileSync(join(runsDir, newAwaiting!), 'utf-8'),
      ) as AwaitingGateRecord
      expect(record.inputs.rejection_reason).toBe('wrong tone of voice')
    } finally {
      reg.unregister('gate-greet')
      reg.unregister('gate-tail')
      removeInstalledConfig(frameworkName)
    }
  })

  it('double-approve is a no-op (alreadyProcessed=true on the second call)', async () => {
    installCfg()
    const reg = getSkillRegistry()
    reg.register(makeGreetSkill([]))
    reg.register(makeTailSkill([]))
    try {
      await expect(runFramework(frameworkName)).rejects.toBeInstanceOf(FrameworkGatePauseError)
      const runsDir = join(tempHome, '.gtm-os', 'agents', `${frameworkName}.runs`)
      const awaitingFile = readdirSync(runsDir).find((f) => f.endsWith('.awaiting-gate.json'))!
      const runId = awaitingFile.replace(/\.awaiting-gate\.json$/, '')
      const first = writeApproved(frameworkName, runId, { greeting: 'one' })
      const second = writeApproved(frameworkName, runId, { greeting: 'two' })
      expect(first.alreadyProcessed).toBe(false)
      expect(second.alreadyProcessed).toBe(true)
      // The persisted approved record reflects the first call's payload.
      expect((second.approved.payload as { greeting: string }).greeting).toBe('one')
    } finally {
      reg.unregister('gate-greet')
      reg.unregister('gate-tail')
      removeInstalledConfig(frameworkName)
    }
  })
})
