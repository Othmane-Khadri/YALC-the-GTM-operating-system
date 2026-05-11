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

/**
 * Schema version for on-disk gate sentinels (A6).
 *
 * Writes always stamp `_v: CURRENT_SENTINEL_VERSION`. Reads accept missing
 * `_v` (treat as v1 — pre-A6 records, upgraded transparently on the next
 * write) and `_v === CURRENT_SENTINEL_VERSION`. Any other value throws so
 * a future schema bump never silently corrupts a stale record.
 */
export const CURRENT_SENTINEL_VERSION = 2

/**
 * Validate the schema version of a parsed sentinel record. Returns the
 * record unchanged on success.
 *
 * - `_v` missing → v1, accepted (will be upgraded on next write).
 * - `_v === CURRENT_SENTINEL_VERSION` → accepted.
 * - any other `_v` → throws with a clear, actionable message.
 */
export function parseSentinel<T extends object>(raw: T): T {
  const v = (raw as { _v?: unknown })._v
  if (v === undefined) return raw
  if (typeof v === 'number' && v === CURRENT_SENTINEL_VERSION) return raw
  throw new Error(`Unknown sentinel version ${String(v)}. Upgrade YALC.`)
}

/** Stamp the current schema version onto a record about to be written. */
function withVersion<T extends object>(record: T): T & { _v: number } {
  return { _v: CURRENT_SENTINEL_VERSION, ...record }
}

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

/**
 * Read the awaiting-gate sentinel. Null when not present or unparseable as
 * JSON. Throws (via parseSentinel) if `_v` is set to a value newer than
 * this build understands.
 */
export function readAwaitingGate(
  framework: string,
  runId: string,
): AwaitingGateRecord | null {
  const p = awaitingGatePath(framework, runId)
  if (!existsSync(p)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  return parseSentinel(raw as AwaitingGateRecord)
}

export interface ApprovedGateRecord {
  /** Schema version (A6). Missing in v1 records persisted before A6. */
  _v?: number
  run_id: string
  framework: string
  step_index: number
  gate_id: string
  /** The (possibly edited) payload that the runner will resume from. */
  payload: unknown
  /**
   * The original (pre-edit) payload from the awaiting-gate sentinel (D3).
   *
   * Captured on every new approval so the UI can render a side-by-side
   * diff of what the operator changed. Optional in the type because
   * pre-D3 approved records on disk don't carry it; readers MUST treat
   * `undefined` as "no diff available" rather than as `null`.
   */
  original_payload?: unknown
  /**
   * True iff the operator edited the payload before approving (D3).
   *
   * `undefined` for pre-D3 records (parser does not synthesise a value
   * to keep the absence detectable).
   */
  edits_applied?: boolean
  /** Index into `prior_step_outputs` the payload was sourced from (if any). */
  payload_step_index: number | null
  /** Snapshot of step outputs the gate captured. */
  prior_step_outputs: unknown[]
  inputs: Record<string, unknown>
  approved_at: string
}

export interface RejectedGateRecord {
  /** Schema version (A6). Missing in v1 records persisted before A6. */
  _v?: number
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
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
      } catch {
        // skip malformed files
        continue
      }
      if (!raw || typeof raw !== 'object') continue
      // parseSentinel throws on unknown _v; that's intentional — listing
      // surfaces the same upgrade hint downstream commands would.
      out.push(parseSentinel(raw as AwaitingGateRecord))
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
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(approved, 'utf-8'))
    } catch {
      return { kind: 'missing' }
    }
    if (!raw || typeof raw !== 'object') return { kind: 'missing' }
    return { kind: 'approved', record: parseSentinel(raw as ApprovedGateRecord) }
  }
  const rejected = rejectedGatePath(framework, runId)
  if (existsSync(rejected)) {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(rejected, 'utf-8'))
    } catch {
      return { kind: 'missing' }
    }
    if (!raw || typeof raw !== 'object') return { kind: 'missing' }
    return { kind: 'rejected', record: parseSentinel(raw as RejectedGateRecord) }
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
    const existing = parseSentinel(
      JSON.parse(readFileSync(approvedFile, 'utf-8')) as ApprovedGateRecord,
    )
    return { approved: existing, alreadyProcessed: true }
  }
  const awaiting = readAwaitingGate(framework, runId)
  if (!awaiting) {
    throw new GateNotFoundError(framework, runId)
  }
  const originalPayload = awaiting.payload
  let payload = originalPayload
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
  // D3 — diff persistence. We always capture `original_payload` so the UI
  // can render a side-by-side diff post-approval. `edits_applied` is true
  // only when the resolved payload actually differs from the original
  // (passing edits that happen to be identical is a no-op, not a diff).
  const editsApplied = !deepEqual(originalPayload, payload)
  const record: ApprovedGateRecord = withVersion({
    run_id: awaiting.run_id,
    framework: awaiting.framework,
    step_index: awaiting.step_index,
    gate_id: awaiting.gate_id,
    payload,
    original_payload: originalPayload,
    edits_applied: editsApplied,
    payload_step_index: awaiting.payload_step_index ?? null,
    prior_step_outputs: awaiting.prior_step_outputs,
    inputs: awaiting.inputs,
    approved_at: new Date().toISOString(),
  })
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
    const existing = parseSentinel(
      JSON.parse(readFileSync(rejectedFile, 'utf-8')) as RejectedGateRecord,
    )
    return { rejected: existing, alreadyProcessed: true }
  }
  const awaiting = readAwaitingGate(framework, runId)
  if (!awaiting) {
    throw new GateNotFoundError(framework, runId)
  }
  const record: RejectedGateRecord = withVersion({
    run_id: awaiting.run_id,
    framework: awaiting.framework,
    step_index: awaiting.step_index,
    gate_id: awaiting.gate_id,
    reason,
    inputs: awaiting.inputs,
    rejected_at: new Date().toISOString(),
  })
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

/**
 * Structural equality over JSON-shaped values (D3).
 *
 * Used to decide `edits_applied` on approve — a wholesale or per-key edit
 * that produces the same shape as the original counts as no edit.
 * Handles primitives, arrays (order-sensitive), and plain objects (key
 * order independent). NaN / functions / Date / symbols are out of scope
 * because awaiting-gate payloads round-trip through JSON.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  const aIsArr = Array.isArray(a)
  const bIsArr = Array.isArray(b)
  if (aIsArr !== bIsArr) return false
  if (aIsArr && bIsArr) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, k)) return false
    if (!deepEqual(aObj[k], bObj[k])) return false
  }
  return true
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
