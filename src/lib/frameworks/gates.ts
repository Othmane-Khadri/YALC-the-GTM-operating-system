/**
 * Framework human-gate plumbing.
 *
 * Sits between the runner (which writes the awaiting-gate sentinel) and
 * the CLI / HTTP surfaces (which approve, reject, and resume). All the
 * file-shape conventions live here so the runner, the `framework:resume`
 * CLI, and the `/api/gates/*` routes share one source of truth.
 *
 * On-disk shape under `~/.gtm-os/agents/<framework>.runs/`:
 *
 *   <run-id>.awaiting-gate.json   — written by the runner when it pauses
 *   <run-id>.gate-approved.json   — written by an approve POST
 *   <run-id>.gate-rejected.json   — written by a reject POST
 *
 * Idempotency contract:
 *   - second approve on the same run is a no-op (sentinel already exists).
 *   - approve after reject (or vice versa) is a 409 Conflict (`mismatch`).
 *
 * The agents/ root is walked at call time because tests pivot HOME mid-suite.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AwaitingGateRecord } from './runner.js'

/** Resolve `~/.gtm-os/agents/` at call time so HOME pivots take effect. */
function agentsDir(): string {
  return join(homedir(), '.gtm-os', 'agents')
}

function runsDirFor(framework: string): string {
  return join(agentsDir(), `${framework}.runs`)
}

export function awaitingGatePath(framework: string, runId: string): string {
  return join(runsDirFor(framework), `${runId}.awaiting-gate.json`)
}

export function approvedGatePath(framework: string, runId: string): string {
  return join(runsDirFor(framework), `${runId}.gate-approved.json`)
}

export function rejectedGatePath(framework: string, runId: string): string {
  return join(runsDirFor(framework), `${runId}.gate-rejected.json`)
}

/** Locate the framework that owns a given run-id. Null when not found. */
export function findFrameworkByRunId(runId: string): string | null {
  const root = agentsDir()
  if (!existsSync(root)) return null
  for (const entry of readdirSync(root)) {
    if (!entry.endsWith('.runs')) continue
    const dir = join(root, entry)
    let st
    try {
      st = statSync(dir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    if (
      existsSync(join(dir, `${runId}.awaiting-gate.json`)) ||
      existsSync(join(dir, `${runId}.gate-approved.json`)) ||
      existsSync(join(dir, `${runId}.gate-rejected.json`))
    ) {
      return entry.slice(0, -'.runs'.length)
    }
  }
  return null
}

/** Read the awaiting-gate sentinel. Null when not present or unparseable. */
export function readAwaitingGate(
  framework: string,
  runId: string,
): AwaitingGateRecord | null {
  const p = awaitingGatePath(framework, runId)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as AwaitingGateRecord
  } catch {
    return null
  }
}

export interface ApprovedGateRecord {
  run_id: string
  framework: string
  step_index: number
  gate_id: string
  /** The (possibly edited) payload that the runner will resume from. */
  payload: unknown
  /** Index into `prior_step_outputs` the payload was sourced from (if any). */
  payload_step_index: number | null
  /** Snapshot of step outputs the gate captured. */
  prior_step_outputs: unknown[]
  inputs: Record<string, unknown>
  approved_at: string
}

export interface RejectedGateRecord {
  run_id: string
  framework: string
  step_index: number
  gate_id: string
  reason: string
  inputs: Record<string, unknown>
  rejected_at: string
}

/** List every awaiting-gate sentinel currently on disk. */
export function listAwaitingGates(): AwaitingGateRecord[] {
  const root = agentsDir()
  if (!existsSync(root)) return []
  const out: AwaitingGateRecord[] = []
  for (const entry of readdirSync(root)) {
    if (!entry.endsWith('.runs')) continue
    const dir = join(root, entry)
    let st
    try {
      st = statSync(dir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.awaiting-gate.json')) continue
      const runId = f.slice(0, -'.awaiting-gate.json'.length)
      // Hide gates that have already been processed (their sibling exists).
      if (
        existsSync(join(dir, `${runId}.gate-approved.json`)) ||
        existsSync(join(dir, `${runId}.gate-rejected.json`))
      ) {
        continue
      }
      try {
        out.push(
          JSON.parse(readFileSync(join(dir, f), 'utf-8')) as AwaitingGateRecord,
        )
      } catch {
        // skip malformed files
      }
    }
  }
  return out
}

export type GateState =
  | { kind: 'awaiting'; record: AwaitingGateRecord }
  | { kind: 'approved'; record: ApprovedGateRecord }
  | { kind: 'rejected'; record: RejectedGateRecord }
  | { kind: 'missing' }

export function readGateState(framework: string, runId: string): GateState {
  const approved = approvedGatePath(framework, runId)
  if (existsSync(approved)) {
    try {
      return {
        kind: 'approved',
        record: JSON.parse(readFileSync(approved, 'utf-8')) as ApprovedGateRecord,
      }
    } catch {
      return { kind: 'missing' }
    }
  }
  const rejected = rejectedGatePath(framework, runId)
  if (existsSync(rejected)) {
    try {
      return {
        kind: 'rejected',
        record: JSON.parse(readFileSync(rejected, 'utf-8')) as RejectedGateRecord,
      }
    } catch {
      return { kind: 'missing' }
    }
  }
  const awaiting = readAwaitingGate(framework, runId)
  if (awaiting) return { kind: 'awaiting', record: awaiting }
  return { kind: 'missing' }
}

export interface ApproveResult {
  approved: ApprovedGateRecord
  alreadyProcessed: boolean
}

/**
 * Persist an approved-gate sentinel. The optional `edits` object replaces
 * keys on the awaiting payload; if `edits` itself is provided as a wholesale
 * value (not an object), it replaces the payload entirely.
 *
 * Idempotency:
 *   - already-approved → return existing record with `alreadyProcessed: true`.
 *   - already-rejected → throw `GateConflictError` ("rejected").
 */
export function writeApproved(
  framework: string,
  runId: string,
  edits?: unknown,
): ApproveResult {
  const approvedFile = approvedGatePath(framework, runId)
  const rejectedFile = rejectedGatePath(framework, runId)
  if (existsSync(rejectedFile)) {
    throw new GateConflictError('rejected', framework, runId)
  }
  if (existsSync(approvedFile)) {
    const existing = JSON.parse(
      readFileSync(approvedFile, 'utf-8'),
    ) as ApprovedGateRecord
    return { approved: existing, alreadyProcessed: true }
  }
  const awaiting = readAwaitingGate(framework, runId)
  if (!awaiting) {
    throw new GateNotFoundError(framework, runId)
  }
  let payload = awaiting.payload
  if (edits !== undefined) {
    if (
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      edits &&
      typeof edits === 'object' &&
      !Array.isArray(edits)
    ) {
      payload = { ...(payload as Record<string, unknown>), ...(edits as Record<string, unknown>) }
    } else {
      payload = edits
    }
  }
  const record: ApprovedGateRecord = {
    run_id: awaiting.run_id,
    framework: awaiting.framework,
    step_index: awaiting.step_index,
    gate_id: awaiting.gate_id,
    payload,
    payload_step_index: awaiting.payload_step_index ?? null,
    prior_step_outputs: awaiting.prior_step_outputs,
    inputs: awaiting.inputs,
    approved_at: new Date().toISOString(),
  }
  ensureDir(runsDirFor(framework))
  writeFileSync(approvedFile, JSON.stringify(record, null, 2) + '\n', 'utf-8')
  return { approved: record, alreadyProcessed: false }
}

export interface RejectResult {
  rejected: RejectedGateRecord
  alreadyProcessed: boolean
}

/**
 * Persist a rejected-gate sentinel.
 *
 * Idempotency:
 *   - already-rejected → return existing record with `alreadyProcessed: true`.
 *   - already-approved → throw `GateConflictError` ("approved").
 */
export function writeRejected(
  framework: string,
  runId: string,
  reason: string,
): RejectResult {
  const approvedFile = approvedGatePath(framework, runId)
  const rejectedFile = rejectedGatePath(framework, runId)
  if (existsSync(approvedFile)) {
    throw new GateConflictError('approved', framework, runId)
  }
  if (existsSync(rejectedFile)) {
    const existing = JSON.parse(
      readFileSync(rejectedFile, 'utf-8'),
    ) as RejectedGateRecord
    return { rejected: existing, alreadyProcessed: true }
  }
  const awaiting = readAwaitingGate(framework, runId)
  if (!awaiting) {
    throw new GateNotFoundError(framework, runId)
  }
  const record: RejectedGateRecord = {
    run_id: awaiting.run_id,
    framework: awaiting.framework,
    step_index: awaiting.step_index,
    gate_id: awaiting.gate_id,
    reason,
    inputs: awaiting.inputs,
    rejected_at: new Date().toISOString(),
  }
  ensureDir(runsDirFor(framework))
  writeFileSync(rejectedFile, JSON.stringify(record, null, 2) + '\n', 'utf-8')
  return { rejected: record, alreadyProcessed: false }
}

/**
 * Remove the awaiting-gate sentinel after resume. Approved / rejected
 * sentinels are left in place so the run history is auditable.
 */
export function clearAwaitingSentinel(framework: string, runId: string): void {
  const p = awaitingGatePath(framework, runId)
  if (existsSync(p)) rmSync(p, { force: true })
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export class GateConflictError extends Error {
  readonly conflictWith: 'approved' | 'rejected'
  readonly framework: string
  readonly runId: string
  constructor(conflictWith: 'approved' | 'rejected', framework: string, runId: string) {
    super(`Gate for run ${runId} (framework ${framework}) is already ${conflictWith}.`)
    this.name = 'GateConflictError'
    this.conflictWith = conflictWith
    this.framework = framework
    this.runId = runId
  }
}

export class GateNotFoundError extends Error {
  readonly framework: string
  readonly runId: string
  constructor(framework: string, runId: string) {
    super(`No awaiting-gate sentinel for run ${runId} (framework ${framework}).`)
    this.name = 'GateNotFoundError'
    this.framework = framework
    this.runId = runId
  }
}
