/**
 * Gate timeout semantics (D1).
 *
 * Awaiting-gate sentinels have a `created_at` ISO timestamp written by the
 * runner. If a human never approves or rejects the gate, the sentinel can
 * pile up forever. This module enforces a timeout: when an awaiting gate
 * is older than the resolved timeout window, it is auto-transitioned to a
 * `RejectedGateRecord` with reason `"timeout: <N>h elapsed without action"`.
 *
 * Timeout precedence (resolved per-framework):
 *   manifest `gate_timeout_hours` > `YALC_DEFAULT_GATE_TIMEOUT_HOURS` env > 72h fallback.
 *
 * The transition is idempotent: a stale gate is auto-rejected at most once.
 * Subsequent ticks observe the rejected sentinel (the awaiting one has been
 * removed) and do nothing.
 *
 * "Stale" (UI-only): a gate inside the last 20% of its timeout window is
 * surfaced with a stale badge — early warning before auto-rejection.
 */

import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  CURRENT_SENTINEL_VERSION,
  awaitingGatePath,
  approvedGatePath,
  rejectedGatePath,
  type RejectedGateRecord,
} from './gates.js'
import type { AwaitingGateRecord } from './runner.js'
import { findFramework } from './loader.js'

/** Hard fallback when no manifest field and no env override is set. */
export const DEFAULT_GATE_TIMEOUT_HOURS = 72

/** Fraction of the timeout window that triggers the "stale" UI badge. */
export const STALE_BADGE_THRESHOLD = 0.8

/**
 * Resolve the awaiting-gate timeout for a framework. Precedence:
 *   1. `manifestHours` (`gate_timeout_hours` from the framework yaml).
 *   2. `YALC_DEFAULT_GATE_TIMEOUT_HOURS` env, parsed as a positive number.
 *   3. `DEFAULT_GATE_TIMEOUT_HOURS` (72h).
 */
export function resolveGateTimeoutHours(manifestHours: number | undefined): number {
  if (typeof manifestHours === 'number' && Number.isFinite(manifestHours) && manifestHours > 0) {
    return manifestHours
  }
  const envRaw = process.env.YALC_DEFAULT_GATE_TIMEOUT_HOURS
  if (envRaw !== undefined && envRaw !== '') {
    const parsed = Number(envRaw)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_GATE_TIMEOUT_HOURS
}

/**
 * Return true when a gate's `created_at` is within the stale band
 * (>= STALE_BADGE_THRESHOLD of the timeout window). False if the gate has
 * already exceeded the full window — the caller normally treats those as
 * already timed-out via `enforceGateTimeouts`.
 */
export function isGateStale(
  createdAtIso: string,
  timeoutHours: number,
  nowMs: number = Date.now(),
): boolean {
  const created = Date.parse(createdAtIso)
  if (!Number.isFinite(created)) return false
  const elapsedMs = nowMs - created
  if (elapsedMs <= 0) return false
  const windowMs = timeoutHours * 3600 * 1000
  return elapsedMs >= windowMs * STALE_BADGE_THRESHOLD
}

/** True when elapsed time has fully exceeded the timeout window. */
export function isGateTimedOut(
  createdAtIso: string,
  timeoutHours: number,
  nowMs: number = Date.now(),
): boolean {
  const created = Date.parse(createdAtIso)
  if (!Number.isFinite(created)) return false
  const elapsedMs = nowMs - created
  return elapsedMs >= timeoutHours * 3600 * 1000
}

function agentsDir(): string {
  return join(homedir(), '.gtm-os', 'agents')
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function buildTimeoutReason(elapsedHours: number): string {
  // Round the elapsed-hours value so the reason text is human-friendly
  // ("timeout: 100h elapsed without action") instead of carrying floats.
  const rounded = Math.round(elapsedHours)
  return `timeout: ${rounded}h elapsed without action`
}

export interface EnforceGateTimeoutsResult {
  /** Number of awaiting sentinels that were auto-transitioned to rejected. */
  transitioned: number
  /** Per-framework counts (useful for surfacing in CLI / logs). */
  perFramework: Record<string, number>
}

/**
 * Walk every awaiting-gate sentinel on disk, transitioning ones older than
 * their resolved timeout to a RejectedGateRecord. Idempotent — re-running
 * after a transition does nothing because the awaiting file is removed and
 * a sibling rejected file already exists.
 */
export function enforceGateTimeouts(
  nowMs: number = Date.now(),
): EnforceGateTimeoutsResult {
  const root = agentsDir()
  if (!existsSync(root)) return { transitioned: 0, perFramework: {} }
  const result: EnforceGateTimeoutsResult = { transitioned: 0, perFramework: {} }
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
    const framework = entry.slice(0, -'.runs'.length)
    // Resolve the timeout window for this framework. findFramework reads
    // the bundled + user yamls; an unknown framework (legacy / orphaned
    // sentinel) falls through to the env / default precedence.
    const def = findFramework(framework)
    const timeoutHours = resolveGateTimeoutHours(def?.gate_timeout_hours)
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.awaiting-gate.json')) continue
      const runId = f.slice(0, -'.awaiting-gate.json'.length)
      // Skip when an approved / rejected sibling already exists. The
      // awaiting file might still be on disk if `clearAwaitingSentinel`
      // wasn't called (older code paths) — in that case the sibling wins.
      if (
        existsSync(approvedGatePath(framework, runId)) ||
        existsSync(rejectedGatePath(framework, runId))
      ) {
        continue
      }
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
      } catch {
        continue
      }
      if (!raw || typeof raw !== 'object') continue
      const record = raw as AwaitingGateRecord
      const createdAt = record.created_at
      if (typeof createdAt !== 'string') continue
      if (!isGateTimedOut(createdAt, timeoutHours, nowMs)) continue

      // Transition: write rejected, remove awaiting.
      const elapsedHours = (nowMs - Date.parse(createdAt)) / (3600 * 1000)
      const rejected: RejectedGateRecord = {
        _v: CURRENT_SENTINEL_VERSION,
        run_id: record.run_id,
        framework: record.framework ?? framework,
        step_index: record.step_index,
        gate_id: record.gate_id,
        reason: buildTimeoutReason(elapsedHours),
        inputs: record.inputs ?? {},
        rejected_at: new Date(nowMs).toISOString(),
      }
      ensureDir(dir)
      writeFileSync(
        rejectedGatePath(framework, runId),
        JSON.stringify(rejected, null, 2) + '\n',
        'utf-8',
      )
      const awaitingFile = awaitingGatePath(framework, runId)
      if (existsSync(awaitingFile)) rmSync(awaitingFile, { force: true })
      result.transitioned += 1
      result.perFramework[framework] = (result.perFramework[framework] ?? 0) + 1
    }
  }
  return result
}
