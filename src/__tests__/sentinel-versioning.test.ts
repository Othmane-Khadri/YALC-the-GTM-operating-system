/**
 * Tests for sentinel `_v: 2` schema versioning (A6, Part 1).
 *
 * Gate sentinels (awaiting / approved / rejected) carry a `_v` field so
 * future schema changes don't silently break old sentinels. The parser
 * accepts:
 *   - records without `_v` (treat as v1, upgrade-on-next-write),
 *   - records with `_v === 2`,
 * and fails with a clear error for any other version.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseSentinel,
  readAwaitingGate,
  readGateState,
  awaitingGatePath,
  approvedGatePath,
  writeApproved,
  writeRejected,
  CURRENT_SENTINEL_VERSION,
} from '../lib/frameworks/gates'

describe('sentinel _v versioning', () => {
  let prevHome: string | undefined
  let tempHome: string
  const framework = 'sentinel-version-test'
  const runId = 'r-001'

  beforeEach(() => {
    prevHome = process.env.HOME
    tempHome = join(tmpdir(), `yalc-sent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
    mkdirSync(join(tempHome, '.gtm-os', 'agents', `${framework}.runs`), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  it('exports a CURRENT_SENTINEL_VERSION constant equal to 2', () => {
    expect(CURRENT_SENTINEL_VERSION).toBe(2)
  })

  it('parseSentinel accepts a v1 (missing _v) record without errors', () => {
    const v1 = {
      run_id: runId,
      framework,
      step_index: 1,
      gate_id: 'human_review',
      prompt: 'Approve?',
      payload: { greeting: 'hello' },
      payload_step_index: 0,
      prior_step_outputs: [{ greeting: 'hello' }],
      inputs: { who: 'world' },
      created_at: '2026-04-30T00:00:00Z',
    }
    const parsed = parseSentinel(v1)
    expect(parsed.gate_id).toBe('human_review')
  })

  it('parseSentinel accepts a v2 record', () => {
    const v2 = {
      _v: 2,
      run_id: runId,
      framework,
      step_index: 1,
      gate_id: 'human_review',
      prompt: 'Approve?',
      payload: null,
      payload_step_index: null,
      prior_step_outputs: [],
      inputs: {},
      created_at: '2026-04-30T00:00:00Z',
    }
    const parsed = parseSentinel(v2)
    expect((parsed as { _v?: number })._v).toBe(2)
  })

  it('parseSentinel throws "Unknown sentinel version N. Upgrade YALC." for unknown _v', () => {
    const v999 = {
      _v: 999,
      run_id: runId,
      framework,
      step_index: 0,
      gate_id: 'g',
      prompt: '',
      payload: null,
      payload_step_index: null,
      prior_step_outputs: [],
      inputs: {},
      created_at: '2026-04-30T00:00:00Z',
    }
    expect(() => parseSentinel(v999)).toThrow(/Unknown sentinel version 999\. Upgrade YALC\./)
  })

  it('readAwaitingGate round-trips a v1 sentinel without _v field on disk', () => {
    const v1 = {
      run_id: runId,
      framework,
      step_index: 1,
      gate_id: 'human_review',
      prompt: 'Approve?',
      payload: { greeting: 'hello' },
      payload_step_index: 0,
      prior_step_outputs: [{ greeting: 'hello' }],
      inputs: { who: 'world' },
      created_at: '2026-04-30T00:00:00Z',
    }
    writeFileSync(awaitingGatePath(framework, runId), JSON.stringify(v1, null, 2), 'utf-8')
    const record = readAwaitingGate(framework, runId)
    expect(record).not.toBeNull()
    expect(record?.gate_id).toBe('human_review')
  })

  it('writeApproved upgrades a v1 sentinel to v2 on the next write', () => {
    const v1 = {
      run_id: runId,
      framework,
      step_index: 1,
      gate_id: 'human_review',
      prompt: 'Approve?',
      payload: { hello: 'world' },
      payload_step_index: 0,
      prior_step_outputs: [{ hello: 'world' }],
      inputs: {},
      created_at: '2026-04-30T00:00:00Z',
    }
    writeFileSync(awaitingGatePath(framework, runId), JSON.stringify(v1, null, 2), 'utf-8')
    const result = writeApproved(framework, runId)
    expect(result.alreadyProcessed).toBe(false)
    const onDisk = JSON.parse(readFileSync(approvedGatePath(framework, runId), 'utf-8'))
    expect(onDisk._v).toBe(2)
  })

  it('writeRejected writes _v: 2', () => {
    const v1 = {
      run_id: runId,
      framework,
      step_index: 0,
      gate_id: 'g',
      prompt: '',
      payload: null,
      payload_step_index: null,
      prior_step_outputs: [],
      inputs: {},
      created_at: '2026-04-30T00:00:00Z',
    }
    writeFileSync(awaitingGatePath(framework, runId), JSON.stringify(v1, null, 2), 'utf-8')
    writeRejected(framework, runId, 'nope')
    const rejPath = join(tempHome, '.gtm-os', 'agents', `${framework}.runs`, `${runId}.gate-rejected.json`)
    const onDisk = JSON.parse(readFileSync(rejPath, 'utf-8'))
    expect(onDisk._v).toBe(2)
  })

  it('readGateState fails clearly when an awaiting sentinel has unknown _v', () => {
    const bad = {
      _v: 7,
      run_id: runId,
      framework,
      step_index: 0,
      gate_id: 'g',
      prompt: '',
      payload: null,
      payload_step_index: null,
      prior_step_outputs: [],
      inputs: {},
      created_at: '2026-04-30T00:00:00Z',
    }
    writeFileSync(awaitingGatePath(framework, runId), JSON.stringify(bad, null, 2), 'utf-8')
    expect(() => readGateState(framework, runId)).toThrow(/Unknown sentinel version 7\. Upgrade YALC\./)
  })
})
