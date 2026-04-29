/**
 * Tests for `framework:resume` (0.9.E).
 *
 * Exercises the in-process helper directly. Errors and conflict detection
 * should be deterministic and surface clear messages.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FrameworkGatePauseError,
  runFramework,
  type AwaitingGateRecord,
} from '../lib/frameworks/runner'
import { runFrameworkResume } from '../cli/commands/framework'
import {
  GateConflictError,
  writeApproved,
  writeRejected,
} from '../lib/frameworks/gates'
import {
  removeInstalledConfig,
  saveInstalledConfig,
} from '../lib/frameworks/registry'
import { getSkillRegistry } from '../lib/skills/registry'
import type { InstalledFrameworkConfig } from '../lib/frameworks/types'
import type { Skill } from '../lib/skills/types'

const sampleFramework = (name: string) => `
name: ${name}
display_name: "Resume Test"
description: "Throwaway framework with a single gate."
inputs:
  - name: who
    description: target
    default: "world"
schedule:
  cron: "0 8 * * *"
steps:
  - skill: resume-greet
    input:
      who: "{{who}}"
  - gate:
      id: review
      prompt: "Approve?"
      surface: ui-today
  - skill: resume-tail
    input:
      previous: "{{steps[0].output}}"
output:
  destination_choice:
    - dashboard: { route: "/frameworks/${name}" }
`

function makeGreet(seen: unknown[]): Skill {
  return {
    id: 'resume-greet',
    name: 'Resume Greet',
    version: '1.0.0',
    description: 'x',
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
function makeTail(seen: unknown[]): Skill {
  return {
    id: 'resume-tail',
    name: 'Resume Tail',
    version: '1.0.0',
    description: 'x',
    category: 'data',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    requiredCapabilities: [],
    async *execute(input) {
      seen.push(input)
      yield { type: 'result', data: { rows: [{ tail: true }] } }
    },
  }
}

describe('framework:resume (HOME-isolated)', () => {
  let prevHome: string | undefined
  let prevCwd: string
  let tempHome: string
  let frameworkName: string
  let frameworkPath: string

  beforeEach(() => {
    prevHome = process.env.HOME
    prevCwd = process.cwd()
    tempHome = join(tmpdir(), `yalc-resume-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
    frameworkName = `resume-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    frameworkPath = join(prevCwd, 'configs', 'frameworks', `${frameworkName}.yaml`)
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
      display_name: 'Resume Test',
      description: 'desc',
      installed_at: new Date().toISOString(),
      schedule: { cron: '0 8 * * *' },
      output: { destination: 'dashboard', dashboard_route: `/frameworks/${frameworkName}` },
      inputs: { who: 'world' },
    }
    saveInstalledConfig(cfg)
    return cfg
  }

  it('resume continues from the right step after approve', async () => {
    installCfg()
    const greetSeen: unknown[] = []
    const tailSeen: unknown[] = []
    const reg = getSkillRegistry()
    reg.register(makeGreet(greetSeen))
    reg.register(makeTail(tailSeen))
    try {
      await expect(runFramework(frameworkName)).rejects.toBeInstanceOf(FrameworkGatePauseError)
      const runsDir = join(tempHome, '.gtm-os', 'agents', `${frameworkName}.runs`)
      const awaitingFile = readdirSync(runsDir).find((f) => f.endsWith('.awaiting-gate.json'))!
      const runId = awaitingFile.replace(/\.awaiting-gate\.json$/, '')
      writeApproved(frameworkName, runId)
      const result = await runFrameworkResume(frameworkName, { fromGate: runId })
      expect(result.mode).toBe('approved')
      // Greet did NOT run again — the resume picked up after the gate.
      expect(greetSeen).toHaveLength(1)
      expect(tailSeen).toHaveLength(1)
      // Awaiting sentinel cleared after resume.
      expect(existsSync(join(runsDir, awaitingFile))).toBe(false)
    } finally {
      reg.unregister('resume-greet')
      reg.unregister('resume-tail')
      removeInstalledConfig(frameworkName)
    }
  })

  it('rejection retry exposes the rejection reason on the new awaiting gate', async () => {
    installCfg()
    const reg = getSkillRegistry()
    reg.register(makeGreet([]))
    reg.register(makeTail([]))
    try {
      await expect(runFramework(frameworkName)).rejects.toBeInstanceOf(FrameworkGatePauseError)
      const runsDir = join(tempHome, '.gtm-os', 'agents', `${frameworkName}.runs`)
      const awaitingFile = readdirSync(runsDir).find((f) => f.endsWith('.awaiting-gate.json'))!
      const runId = awaitingFile.replace(/\.awaiting-gate\.json$/, '')
      writeRejected(frameworkName, runId, 'try again with caps')
      // Retry pauses again at the gate — that's expected for this fixture.
      await expect(
        runFrameworkResume(frameworkName, { fromGate: runId }),
      ).rejects.toBeInstanceOf(FrameworkGatePauseError)
      const newAwaiting = readdirSync(runsDir).find((f) => f.endsWith('.awaiting-gate.json'))!
      const record = JSON.parse(
        readFileSync(join(runsDir, newAwaiting), 'utf-8'),
      ) as AwaitingGateRecord
      expect(record.inputs.rejection_reason).toBe('try again with caps')
    } finally {
      reg.unregister('resume-greet')
      reg.unregister('resume-tail')
      removeInstalledConfig(frameworkName)
    }
  })

  it('errors clearly when no gate sentinel exists for the given run id', async () => {
    installCfg()
    try {
      await expect(
        runFrameworkResume(frameworkName, { fromGate: 'nonexistent-run-id' }),
      ).rejects.toThrow(/No gate sentinel/i)
    } finally {
      removeInstalledConfig(frameworkName)
    }
  })

  it('approve-after-reject (and vice versa) raises GateConflictError (race / 409)', async () => {
    installCfg()
    const reg = getSkillRegistry()
    reg.register(makeGreet([]))
    reg.register(makeTail([]))
    try {
      await expect(runFramework(frameworkName)).rejects.toBeInstanceOf(FrameworkGatePauseError)
      const runsDir = join(tempHome, '.gtm-os', 'agents', `${frameworkName}.runs`)
      const awaitingFile = readdirSync(runsDir).find((f) => f.endsWith('.awaiting-gate.json'))!
      const runId = awaitingFile.replace(/\.awaiting-gate\.json$/, '')
      writeApproved(frameworkName, runId)
      expect(() => writeRejected(frameworkName, runId, 'too late')).toThrow(GateConflictError)
    } finally {
      reg.unregister('resume-greet')
      reg.unregister('resume-tail')
      removeInstalledConfig(frameworkName)
    }
  })
})
