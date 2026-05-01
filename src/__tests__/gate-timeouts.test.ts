/**
 * Tests for D1 — awaiting-gate timeout semantics.
 *
 * Behaviour under test:
 *   - `parseAwaitingGate` (==`readAwaitingGate`) does not enforce timeouts;
 *     it returns whatever is on disk regardless of `created_at` age.
 *   - `enforceGateTimeouts()` walks every awaiting sentinel, transitions
 *     stale ones to `RejectedGateRecord` with reason
 *     `"timeout: <N>h elapsed without action"`, and removes the awaiting
 *     sentinel. Idempotent — re-running produces a single Rejected record.
 *   - `resolveGateTimeoutHours()` precedence: framework manifest field >
 *     `YALC_DEFAULT_GATE_TIMEOUT_HOURS` env > 72h fallback.
 *   - `isGateStale(record, timeoutHours, now)` returns true at >= 80% of
 *     the timeout window, false below.
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
  CURRENT_SENTINEL_VERSION,
  readAwaitingGate,
  awaitingGatePath,
  rejectedGatePath,
  type RejectedGateRecord,
} from '../lib/frameworks/gates'
import {
  DEFAULT_GATE_TIMEOUT_HOURS,
  enforceGateTimeouts,
  isGateStale,
  resolveGateTimeoutHours,
} from '../lib/frameworks/gate-timeouts'
import type { AwaitingGateRecord } from '../lib/frameworks/runner'

const framework = 'timeout-test'
const runId = 'rid-1'

function seedAwaiting(home: string, createdAtIso: string): AwaitingGateRecord {
  const dir = join(home, '.gtm-os', 'agents', `${framework}.runs`)
  mkdirSync(dir, { recursive: true })
  const record: AwaitingGateRecord = {
    _v: CURRENT_SENTINEL_VERSION,
    run_id: runId,
    framework,
    step_index: 1,
    gate_id: 'review',
    prompt: 'Approve?',
    payload: { x: 1 },
    payload_step_index: 0,
    prior_step_outputs: [{ x: 1 }],
    inputs: { who: 'world' },
    created_at: createdAtIso,
  }
  writeFileSync(
    join(dir, `${runId}.awaiting-gate.json`),
    JSON.stringify(record, null, 2),
    'utf-8',
  )
  return record
}

describe('gate timeouts (D1)', () => {
  let prevHome: string | undefined
  let prevEnvDefault: string | undefined
  let tempHome: string

  beforeEach(() => {
    prevHome = process.env.HOME
    prevEnvDefault = process.env.YALC_DEFAULT_GATE_TIMEOUT_HOURS
    delete process.env.YALC_DEFAULT_GATE_TIMEOUT_HOURS
    tempHome = join(
      tmpdir(),
      `yalc-timeout-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (prevEnvDefault === undefined) {
      delete process.env.YALC_DEFAULT_GATE_TIMEOUT_HOURS
    } else {
      process.env.YALC_DEFAULT_GATE_TIMEOUT_HOURS = prevEnvDefault
    }
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  it('exports a 72h DEFAULT_GATE_TIMEOUT_HOURS', () => {
    expect(DEFAULT_GATE_TIMEOUT_HOURS).toBe(72)
  })

  it('parseAwaitingGate accepts a sentinel older than the timeout', () => {
    const old = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString() // 100h
    seedAwaiting(tempHome, old)
    const r = readAwaitingGate(framework, runId)
    expect(r).not.toBeNull()
    expect(r!.created_at).toBe(old)
  })

  it('parseAwaitingGate accepts a sentinel younger than the timeout', () => {
    const recent = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString() // 10h
    seedAwaiting(tempHome, recent)
    const r = readAwaitingGate(framework, runId)
    expect(r).not.toBeNull()
    expect(r!.created_at).toBe(recent)
  })

  it('resolveGateTimeoutHours: env override beats 72h default', () => {
    process.env.YALC_DEFAULT_GATE_TIMEOUT_HOURS = '24'
    expect(resolveGateTimeoutHours(undefined)).toBe(24)
  })

  it('resolveGateTimeoutHours: manifest field beats env override', () => {
    process.env.YALC_DEFAULT_GATE_TIMEOUT_HOURS = '24'
    expect(resolveGateTimeoutHours(48)).toBe(48)
  })

  it('resolveGateTimeoutHours: falls back to 72h when nothing set', () => {
    expect(resolveGateTimeoutHours(undefined)).toBe(72)
  })

  it('resolveGateTimeoutHours: ignores invalid env values', () => {
    process.env.YALC_DEFAULT_GATE_TIMEOUT_HOURS = 'banana'
    expect(resolveGateTimeoutHours(undefined)).toBe(72)
  })

  it('isGateStale: 70% of window is not stale', () => {
    const now = Date.now()
    const seventyPct = new Date(now - 0.7 * 72 * 3600 * 1000).toISOString()
    expect(isGateStale(seventyPct, 72, now)).toBe(false)
  })

  it('isGateStale: 85% of window is stale', () => {
    const now = Date.now()
    const eightyFivePct = new Date(now - 0.85 * 72 * 3600 * 1000).toISOString()
    expect(isGateStale(eightyFivePct, 72, now)).toBe(true)
  })

  it('enforceGateTimeouts transitions a stale awaiting gate to Rejected', () => {
    const old = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString()
    seedAwaiting(tempHome, old)
    const result = enforceGateTimeouts()
    expect(result.transitioned).toBe(1)

    // Awaiting file removed, rejected file written.
    expect(existsSync(awaitingGatePath(framework, runId))).toBe(false)
    const rejPath = rejectedGatePath(framework, runId)
    expect(existsSync(rejPath)).toBe(true)
    const rec = JSON.parse(readFileSync(rejPath, 'utf-8')) as RejectedGateRecord
    expect(rec._v).toBe(CURRENT_SENTINEL_VERSION)
    expect(rec.run_id).toBe(runId)
    expect(rec.framework).toBe(framework)
    expect(rec.gate_id).toBe('review')
    expect(rec.reason).toMatch(/^timeout: \d+h elapsed without action$/)
  })

  it('enforceGateTimeouts is idempotent — second pass writes nothing new', () => {
    const old = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString()
    seedAwaiting(tempHome, old)
    const r1 = enforceGateTimeouts()
    expect(r1.transitioned).toBe(1)
    const rejContents = readFileSync(rejectedGatePath(framework, runId), 'utf-8')
    const r2 = enforceGateTimeouts()
    expect(r2.transitioned).toBe(0)
    // Rejected file unchanged byte-for-byte.
    expect(readFileSync(rejectedGatePath(framework, runId), 'utf-8')).toBe(rejContents)
    // Only one rejected file in the directory.
    const dir = join(tempHome, '.gtm-os', 'agents', `${framework}.runs`)
    const rejFiles = readdirSync(dir).filter((f) => f.endsWith('.gate-rejected.json'))
    expect(rejFiles.length).toBe(1)
  })

  it('enforceGateTimeouts leaves fresh gates untouched', () => {
    const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
    seedAwaiting(tempHome, recent)
    const r = enforceGateTimeouts()
    expect(r.transitioned).toBe(0)
    expect(existsSync(awaitingGatePath(framework, runId))).toBe(true)
    expect(existsSync(rejectedGatePath(framework, runId))).toBe(false)
  })
})
