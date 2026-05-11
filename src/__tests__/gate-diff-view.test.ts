/**
 * Tests for D3 — diff view for "approved with edits" gates.
 *
 * Server-side persistence:
 *   - `ApprovedGateRecord` carries `original_payload` + `edits_applied`.
 *   - `writeApproved` captures the awaiting payload as `original_payload`,
 *     and sets `edits_applied = original_payload !== final_payload`.
 *   - The new fields are optional so `parseSentinel` still round-trips
 *     pre-D3 (v1) approved records — `edits_applied` defaults to false.
 *
 * The `_v: 2` versioning from D1/A6 stays intact: D3 extends the
 * approved-gate record without bumping the wire version.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  approvedGatePath,
  awaitingGatePath,
  parseSentinel,
  readGateState,
  writeApproved,
  CURRENT_SENTINEL_VERSION,
  type ApprovedGateRecord,
} from '../lib/frameworks/gates'

describe('D3 — approved-gate diff persistence', () => {
  let prevHome: string | undefined
  let tempHome: string
  const framework = 'd3-diff-view-test'
  const runId = 'r-d3-001'

  beforeEach(() => {
    prevHome = process.env.HOME
    tempHome = join(tmpdir(), `yalc-d3-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
    mkdirSync(join(tempHome, '.gtm-os', 'agents', `${framework}.runs`), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  function seedAwaiting(payload: unknown): void {
    const sentinel = {
      _v: CURRENT_SENTINEL_VERSION,
      run_id: runId,
      framework,
      step_index: 1,
      gate_id: 'human_review',
      prompt: 'Approve?',
      payload,
      payload_step_index: 0,
      prior_step_outputs: [payload],
      inputs: {},
      created_at: '2026-04-30T00:00:00Z',
    }
    writeFileSync(awaitingGatePath(framework, runId), JSON.stringify(sentinel, null, 2), 'utf-8')
  }

  it('round-trips a v2 approved record with original_payload + edits_applied', () => {
    const original = { greeting: 'hello', tone: 'casual' }
    const final = { greeting: 'howdy', tone: 'casual' }
    const record: ApprovedGateRecord = {
      _v: CURRENT_SENTINEL_VERSION,
      run_id: runId,
      framework,
      step_index: 1,
      gate_id: 'human_review',
      payload: final,
      original_payload: original,
      edits_applied: true,
      payload_step_index: 0,
      prior_step_outputs: [original],
      inputs: {},
      approved_at: '2026-04-30T00:01:00Z',
    }
    const parsed = parseSentinel(record)
    expect(parsed.original_payload).toEqual(original)
    expect(parsed.edits_applied).toBe(true)
    expect(parsed.payload).toEqual(final)
    expect((parsed as { _v?: number })._v).toBe(2)
  })

  it('parser tolerates v1 approved records (no original_payload, no edits_applied)', () => {
    const v1Approved = {
      run_id: runId,
      framework,
      step_index: 1,
      gate_id: 'human_review',
      payload: { greeting: 'hello' },
      payload_step_index: 0,
      prior_step_outputs: [{ greeting: 'hello' }],
      inputs: {},
      approved_at: '2026-04-30T00:01:00Z',
    }
    const parsed = parseSentinel(v1Approved as ApprovedGateRecord)
    expect(parsed.payload).toEqual({ greeting: 'hello' })
    // No throw — v1 records remain readable.
    expect((parsed as ApprovedGateRecord).original_payload).toBeUndefined()
    expect((parsed as ApprovedGateRecord).edits_applied).toBeUndefined()
  })

  it('writeApproved captures original_payload and sets edits_applied: true when payloads differ', () => {
    const original = { greeting: 'hello', count: 1 }
    seedAwaiting(original)
    const result = writeApproved(framework, runId, { greeting: 'howdy' })
    expect(result.alreadyProcessed).toBe(false)
    const onDisk = JSON.parse(readFileSync(approvedGatePath(framework, runId), 'utf-8')) as ApprovedGateRecord
    expect(onDisk._v).toBe(2)
    expect(onDisk.original_payload).toEqual(original)
    expect(onDisk.payload).toEqual({ greeting: 'howdy', count: 1 })
    expect(onDisk.edits_applied).toBe(true)
  })

  it('writeApproved sets edits_applied: false when there were no edits', () => {
    const original = { greeting: 'hello', count: 1 }
    seedAwaiting(original)
    const result = writeApproved(framework, runId)
    expect(result.alreadyProcessed).toBe(false)
    const onDisk = JSON.parse(readFileSync(approvedGatePath(framework, runId), 'utf-8')) as ApprovedGateRecord
    expect(onDisk.edits_applied).toBe(false)
    expect(onDisk.original_payload).toEqual(original)
    expect(onDisk.payload).toEqual(original)
  })

  it('writeApproved sets edits_applied: false when edits are deep-equal to the original', () => {
    const original = { greeting: 'hello', meta: { tone: 'casual' } }
    seedAwaiting(original)
    // Pass an "edits" object that, after merge, produces a payload identical
    // to the original — no actual change.
    const result = writeApproved(framework, runId, { meta: { tone: 'casual' } })
    expect(result.alreadyProcessed).toBe(false)
    const onDisk = JSON.parse(readFileSync(approvedGatePath(framework, runId), 'utf-8')) as ApprovedGateRecord
    expect(onDisk.edits_applied).toBe(false)
  })

  it('readGateState returns the approved record with new fields populated', () => {
    seedAwaiting({ greeting: 'hello' })
    writeApproved(framework, runId, { greeting: 'howdy' })
    const state = readGateState(framework, runId)
    expect(state.kind).toBe('approved')
    if (state.kind !== 'approved') return
    expect(state.record.original_payload).toEqual({ greeting: 'hello' })
    expect(state.record.edits_applied).toBe(true)
    expect(state.record.payload).toEqual({ greeting: 'howdy' })
  })
})
