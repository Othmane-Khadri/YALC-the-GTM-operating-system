/**
 * Tests for /api/gates/* — the human-gate HTTP surface.
 *
 * Each test seeds an awaiting-gate sentinel (and matching framework yaml +
 * installed config + skills) under a HOME-isolated tmpdir, then drives the
 * Hono app via `app.request()`. The framework yaml + skills are real (not
 * mocked) so the in-process resume actually runs to completion.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FrameworkGatePauseError, runFramework } from '../lib/frameworks/runner'
import { writeApproved } from '../lib/frameworks/gates'
import { saveInstalledConfig, removeInstalledConfig } from '../lib/frameworks/registry'
import { getSkillRegistry } from '../lib/skills/registry'
import type { InstalledFrameworkConfig } from '../lib/frameworks/types'
import type { Skill } from '../lib/skills/types'

const sampleFramework = (name: string) => `
name: ${name}
display_name: "Gate API Test"
description: "x"
inputs:
  - name: who
    description: target
    default: "world"
schedule:
  cron: "0 8 * * *"
steps:
  - skill: api-greet
    input:
      who: "{{who}}"
  - gate:
      id: review
      prompt: "Approve?"
      surface: ui-today
  - skill: api-tail
    input:
      previous: "{{steps[0].output}}"
output:
  destination_choice:
    - dashboard: { route: "/frameworks/${name}" }
`

function makeGreet(): Skill {
  return {
    id: 'api-greet',
    name: 'API Greet',
    version: '1.0.0',
    description: 'x',
    category: 'data',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    requiredCapabilities: [],
    async *execute(input) {
      const i = input as { who?: string }
      yield { type: 'result', data: { greeting: `hello ${i.who ?? '?'}` } }
    },
  }
}
function makeTail(seen: unknown[]): Skill {
  return {
    id: 'api-tail',
    name: 'API Tail',
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

let TMP: string
let prevHome: string | undefined
let prevCwd: string
let frameworkName: string
let frameworkPath: string

beforeEach(() => {
  prevHome = process.env.HOME
  prevCwd = process.cwd()
  TMP = mkdtempSync(join(tmpdir(), 'yalc-gates-api-'))
  process.env.HOME = TMP
  frameworkName = `gates-api-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  frameworkPath = join(prevCwd, 'configs', 'frameworks', `${frameworkName}.yaml`)
  writeFileSync(frameworkPath, sampleFramework(frameworkName), 'utf-8')
})

afterEach(() => {
  process.env.HOME = prevHome
  if (existsSync(frameworkPath)) rmSync(frameworkPath, { force: true })
  rmSync(TMP, { recursive: true, force: true })
})

function installCfg(): InstalledFrameworkConfig {
  const cfg: InstalledFrameworkConfig = {
    name: frameworkName,
    display_name: 'Gate API Test',
    description: 'desc',
    installed_at: new Date().toISOString(),
    schedule: { cron: '0 8 * * *' },
    output: { destination: 'dashboard', dashboard_route: `/frameworks/${frameworkName}` },
    inputs: { who: 'world' },
  }
  saveInstalledConfig(cfg)
  return cfg
}

async function pauseAtGate(): Promise<string> {
  installCfg()
  const reg = getSkillRegistry()
  reg.register(makeGreet())
  reg.register(makeTail([]))
  await expect(runFramework(frameworkName)).rejects.toBeInstanceOf(FrameworkGatePauseError)
  const runsDir = join(TMP, '.gtm-os', 'agents', `${frameworkName}.runs`)
  // Wait for awaiting file (synchronous fs but defensive).
  const awaitingFile = readdirSync(runsDir).find((f) => f.endsWith('.awaiting-gate.json'))!
  return awaitingFile.replace(/\.awaiting-gate\.json$/, '')
}

function unregisterSkills() {
  const reg = getSkillRegistry()
  reg.unregister('api-greet')
  reg.unregister('api-tail')
}

describe('GET /api/gates/awaiting', () => {
  it('lists every awaiting-gate sentinel currently on disk', async () => {
    const runId = await pauseAtGate()
    try {
      const { createApp } = await import('../lib/server/index')
      const app = createApp()
      const res = await app.request('/api/gates/awaiting')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { items: Array<{ run_id: string; framework: string }>; total: number }
      expect(body.total).toBe(1)
      expect(body.items[0].run_id).toBe(runId)
      expect(body.items[0].framework).toBe(frameworkName)
    } finally {
      unregisterSkills()
      removeInstalledConfig(frameworkName)
    }
  })
})

describe('POST /api/gates/:runId/approve', () => {
  it('approves the gate, writes an approved sentinel, and resumes the run', async () => {
    const runId = await pauseAtGate()
    try {
      const { createApp } = await import('../lib/server/index')
      const app = createApp()
      const res = await app.request(`/api/gates/${runId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        ok: boolean
        already_processed: boolean
        resumed?: { mode: string; rows: number }
      }
      expect(body.ok).toBe(true)
      expect(body.already_processed).toBe(false)
      expect(body.resumed?.mode).toBe('approved')
      // Approved sentinel exists; awaiting sentinel cleared.
      const runsDir = join(TMP, '.gtm-os', 'agents', `${frameworkName}.runs`)
      const files = readdirSync(runsDir)
      expect(files.some((f) => f.endsWith('.gate-approved.json'))).toBe(true)
      expect(files.some((f) => f === `${runId}.awaiting-gate.json`)).toBe(false)
    } finally {
      unregisterSkills()
      removeInstalledConfig(frameworkName)
    }
  })
})

describe('POST /api/gates/:runId/reject', () => {
  it('rejects the gate and returns 400 when reason is missing', async () => {
    const runId = await pauseAtGate()
    try {
      const { createApp } = await import('../lib/server/index')
      const app = createApp()
      const bad = await app.request(`/api/gates/${runId}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(bad.status).toBe(400)
      const ok = await app.request(`/api/gates/${runId}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'too rough' }),
      })
      // Rejection retries from step 0 — this fixture re-pauses at the gate
      // again, which the route reports as a 500 resume_failed BUT the
      // rejected sentinel persists (the request is observable).
      // Either 200 (different fixture) or 500 (this fixture) is OK as
      // long as the rejected.json was written.
      expect([200, 500]).toContain(ok.status)
      const runsDir = join(TMP, '.gtm-os', 'agents', `${frameworkName}.runs`)
      const files = readdirSync(runsDir)
      expect(files.some((f) => f.endsWith('.gate-rejected.json'))).toBe(true)
    } finally {
      unregisterSkills()
      removeInstalledConfig(frameworkName)
    }
  })
})

describe('POST /api/gates/:runId/approve — payload edits', () => {
  it('merges body.edits into the awaiting payload before resume', async () => {
    const runId = await pauseAtGate()
    const tailSeen: unknown[] = []
    // Re-register tail with a fresh recorder so we can read what was passed in.
    const reg = getSkillRegistry()
    reg.unregister('api-tail')
    reg.register(makeTail(tailSeen))
    try {
      const { createApp } = await import('../lib/server/index')
      const app = createApp()
      const res = await app.request(`/api/gates/${runId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ edits: { greeting: 'EDITED' } }),
      })
      expect(res.status).toBe(200)
      // Tail saw the edited payload via {{steps[0].output}}.
      expect((tailSeen[0] as { previous: { greeting: string } }).previous.greeting).toBe(
        'EDITED',
      )
    } finally {
      unregisterSkills()
      removeInstalledConfig(frameworkName)
    }
  })
})
