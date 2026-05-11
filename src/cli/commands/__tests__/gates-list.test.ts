/**
 * Tests for `yalc-gtm gates:list`.
 *
 * Mirrors the adapters:list test pattern: HOME-isolated tmpdir, seed an
 * awaiting-gate sentinel under `~/.gtm-os/agents/`, and assert the row /
 * JSON shape.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runGatesList } from '../gates-list'
import { CURRENT_SENTINEL_VERSION } from '../../../lib/frameworks/gates'
import type { AwaitingGateRecord } from '../../../lib/frameworks/runner'

function seedAwaiting(home: string, framework: string, runId: string, ageHours: number) {
  const dir = join(home, '.gtm-os', 'agents', `${framework}.runs`)
  mkdirSync(dir, { recursive: true })
  const created = new Date(Date.now() - ageHours * 3600 * 1000).toISOString()
  const record: AwaitingGateRecord = {
    _v: CURRENT_SENTINEL_VERSION,
    run_id: runId,
    framework,
    step_index: 1,
    gate_id: 'review',
    prompt: 'ok?',
    payload: { x: 1 },
    payload_step_index: 0,
    prior_step_outputs: [{ x: 1 }],
    inputs: {},
    created_at: created,
  }
  writeFileSync(
    join(dir, `${runId}.awaiting-gate.json`),
    JSON.stringify(record, null, 2),
    'utf-8',
  )
}

describe('gates:list CLI', () => {
  let prevHome: string | undefined
  let prevEnv: string | undefined
  let tempHome: string

  beforeEach(() => {
    prevHome = process.env.HOME
    prevEnv = process.env.YALC_DEFAULT_GATE_TIMEOUT_HOURS
    delete process.env.YALC_DEFAULT_GATE_TIMEOUT_HOURS
    tempHome = join(
      tmpdir(),
      `yalc-gates-list-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (prevEnv === undefined) delete process.env.YALC_DEFAULT_GATE_TIMEOUT_HOURS
    else process.env.YALC_DEFAULT_GATE_TIMEOUT_HOURS = prevEnv
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  it('emits an empty-state line when there are no awaiting gates', async () => {
    const r = await runGatesList()
    expect(r.exitCode).toBe(0)
    expect(r.output).toMatch(/No awaiting gates/i)
  })

  it('lists fresh and stale gates with header columns', async () => {
    // 1h old → fresh; 60h old (>= 80% of 72h) → stale.
    seedAwaiting(tempHome, 'fresh-fw', 'r-fresh', 1)
    seedAwaiting(tempHome, 'stale-fw', 'r-stale', 60)
    const r = await runGatesList()
    expect(r.exitCode).toBe(0)
    expect(r.output).toMatch(/STATUS\s+FRAMEWORK/)
    expect(r.output).toMatch(/fresh\s+fresh-fw/)
    expect(r.output).toMatch(/stale\s+stale-fw/)
    // Stale sorts before fresh.
    const staleIdx = r.output.indexOf('stale-fw')
    const freshIdx = r.output.indexOf('fresh-fw')
    expect(staleIdx).toBeLessThan(freshIdx)
  })

  it('emits JSON shape with rows + total when --json is set', async () => {
    seedAwaiting(tempHome, 'json-fw', 'r-json', 5)
    const r = await runGatesList({ json: true })
    expect(r.exitCode).toBe(0)
    const parsed = JSON.parse(r.output) as {
      rows: Array<{
        framework: string
        gate_id: string
        status: string
        age_hours: number
        timeout_hours: number
      }>
      total: number
    }
    expect(parsed.total).toBe(1)
    expect(parsed.rows[0].framework).toBe('json-fw')
    expect(parsed.rows[0].gate_id).toBe('review')
    expect(parsed.rows[0].timeout_hours).toBe(72)
    expect(parsed.rows[0].status).toBe('fresh')
    expect(parsed.rows[0].age_hours).toBeGreaterThan(4)
    expect(parsed.rows[0].age_hours).toBeLessThan(6)
  })

  it('omits already-expired gates (auto-rejects them before listing)', async () => {
    seedAwaiting(tempHome, 'expired-fw', 'r-expired', 100) // > 72h default
    const r = await runGatesList({ json: true })
    const parsed = JSON.parse(r.output) as { rows: unknown[]; total: number }
    expect(parsed.total).toBe(0)
  })
})
