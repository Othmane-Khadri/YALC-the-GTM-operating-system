/**
 * Tests for `POST /api/today/trigger/:framework` and the `yalc-gtm trigger`
 * CLI command (D4).
 *
 * Trigger-now is the on-demand counterpart to `/api/today/retry/:framework`:
 * any registered `mode: on-demand` framework can be fired manually. Scheduled
 * frameworks fall through with 400 to keep manual launches off the cron path.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string
let prevHome: string | undefined
let prevCwd: string
let frameworkPath: string | null = null

const onDemandYaml = (name: string) => `
name: ${name}
display_name: "Trigger Test"
description: "x"
mode: on-demand
inputs:
  - name: who
    description: target
    default: "world"
steps:
  - skill: trigger-test-noop
    input:
      who: "{{who}}"
output:
  destination_choice:
    - dashboard: { route: "/frameworks/${name}" }
`

const scheduledYaml = (name: string) => `
name: ${name}
display_name: "Scheduled Test"
description: "x"
mode: scheduled
inputs:
  - name: who
    description: target
    default: "world"
schedule:
  cron: "0 8 * * *"
steps:
  - skill: trigger-test-noop
    input:
      who: "{{who}}"
output:
  destination_choice:
    - dashboard: { route: "/frameworks/${name}" }
`

function writeFrameworkYaml(name: string, body: string): string {
  const p = join(prevCwd, 'configs', 'frameworks', `${name}.yaml`)
  writeFileSync(p, body, 'utf-8')
  return p
}

beforeEach(() => {
  prevHome = process.env.HOME
  prevCwd = process.cwd()
  TMP = mkdtempSync(join(tmpdir(), 'yalc-trigger-'))
  process.env.HOME = TMP
  frameworkPath = null
})

afterEach(() => {
  process.env.HOME = prevHome
  if (frameworkPath && existsSync(frameworkPath)) rmSync(frameworkPath, { force: true })
  rmSync(TMP, { recursive: true, force: true })
})

describe('POST /api/today/trigger/:framework', () => {
  it('returns 200 with a run id and starts a runner for an on-demand framework', async () => {
    const name = `trigger-on-demand-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    frameworkPath = writeFrameworkYaml(name, onDemandYaml(name))

    let runnerStarted = false
    const { triggerOnDemandFramework } = await import('../lib/frameworks/trigger')
    // Use the helper directly to assert the contract that the route is built on,
    // including the audit log line + runner kick-off.
    const result = await triggerOnDemandFramework({
      framework: name,
      source: 'spa',
      startRunner: async () => {
        runnerStarted = true
        return { ok: true }
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.runId.length).toBeGreaterThan(0)
      expect(result.framework).toBe(name)
    }
    // The runner is fire-and-forget; allow the microtask queue to drain.
    await new Promise((r) => setImmediate(r))
    expect(runnerStarted).toBe(true)

    // Now drive the full HTTP route too, with the runner stubbed via dynamic
    // import side-effects — we just need the response shape to be right.
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request(`/api/today/trigger/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; framework: string; run_id: string }
    expect(body.ok).toBe(true)
    expect(body.framework).toBe(name)
    expect(typeof body.run_id).toBe('string')
    expect(body.run_id.length).toBeGreaterThan(0)
  })

  it('returns 400 when the framework is mode: scheduled', async () => {
    const name = `trigger-scheduled-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    frameworkPath = writeFrameworkYaml(name, scheduledYaml(name))
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request(`/api/today/trigger/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('not_on_demand')
  })

  it('returns 404 for an unknown framework', async () => {
    const { createApp } = await import('../lib/server/index')
    const app = createApp()
    const res = await app.request(`/api/today/trigger/this-does-not-exist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(404)
  })

  it('writes a one-line audit entry to ~/.gtm-os/triggers.log', async () => {
    const name = `trigger-audit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    frameworkPath = writeFrameworkYaml(name, onDemandYaml(name))
    const { triggerOnDemandFramework, triggersLogPath } = await import(
      '../lib/frameworks/trigger'
    )
    await triggerOnDemandFramework({
      framework: name,
      source: 'spa',
      startRunner: async () => ({ ok: true }),
    })
    const logPath = triggersLogPath()
    expect(existsSync(logPath)).toBe(true)
    const text = readFileSync(logPath, 'utf-8')
    const lines = text.trim().split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(1)
    const last = lines[lines.length - 1]
    // ISO timestamp + framework + source + run_id key.
    expect(last).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(last).toContain(name)
    expect(last).toContain('source=spa')
    expect(last).toContain('run_id=')
    // No emails / inputs / payloads in the audit line.
    expect(last).not.toContain('@')
    expect(last).not.toMatch(/who=/)
  })
})

describe('yalc-gtm trigger CLI command', () => {
  it('returns the new run id for an on-demand framework', async () => {
    const name = `trigger-cli-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    frameworkPath = writeFrameworkYaml(name, onDemandYaml(name))
    const { runTrigger } = await import('../cli/commands/trigger')
    const lines: string[] = []
    const result = await runTrigger(name, {
      log: (m: string) => lines.push(m),
      startRunner: async () => ({ ok: true }),
    })
    expect(result.exitCode).toBe(0)
    expect(typeof result.runId).toBe('string')
    expect(result.runId && result.runId.length > 0).toBe(true)
    // The CLI prints the run id on stdout.
    expect(lines.join('\n')).toContain(result.runId!)
  })

  it('exits non-zero when the framework is scheduled or unknown', async () => {
    const { runTrigger } = await import('../cli/commands/trigger')
    const unknown = await runTrigger('definitely-not-a-real-framework-xx', {
      log: () => {},
      startRunner: async () => ({ ok: true }),
    })
    expect(unknown.exitCode).not.toBe(0)

    const sname = `trigger-cli-sched-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    frameworkPath = writeFrameworkYaml(sname, scheduledYaml(sname))
    const sched = await runTrigger(sname, {
      log: () => {},
      startRunner: async () => ({ ok: true }),
    })
    expect(sched.exitCode).not.toBe(0)
  })

  it('writes a source=cli line to the audit log', async () => {
    const name = `trigger-cli-audit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    frameworkPath = writeFrameworkYaml(name, onDemandYaml(name))
    const { runTrigger } = await import('../cli/commands/trigger')
    const { triggersLogPath } = await import('../lib/frameworks/trigger')
    await runTrigger(name, {
      log: () => {},
      startRunner: async () => ({ ok: true }),
    })
    expect(existsSync(triggersLogPath())).toBe(true)
    const last = readFileSync(triggersLogPath(), 'utf-8').trim().split('\n').pop() ?? ''
    expect(last).toContain('source=cli')
    expect(last).toContain(name)
  })
})
