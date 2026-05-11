/**
 * Runner-side helpers wired into `runFramework` (D2).
 *
 * Kept in a separate file from `index.ts` so the runner can import only
 * the pieces it needs without pulling the whole notifications surface.
 */

import { listAwaitingGates } from '../frameworks/gates.js'
import { findFramework } from '../frameworks/loader.js'
import {
  isGateStale,
  isGateTimedOut,
  resolveGateTimeoutHours,
} from '../frameworks/gate-timeouts.js'
import { notifyAwaitingGate, notifyStaleGate } from './index.js'

export { notifyAwaitingGate }

/**
 * Walk every awaiting-gate sentinel currently on disk and dispatch a stale
 * notification for ones that have crossed the 80% threshold but have not
 * yet timed out. Idempotent via the flag file.
 *
 * Best-effort: swallows per-gate errors so a single bad sentinel never
 * stops the runner.
 */
export async function notifyStaleAwaitingGates(
  nowMs: number = Date.now(),
): Promise<void> {
  let records
  try {
    records = listAwaitingGates()
  } catch {
    return
  }
  for (const record of records) {
    try {
      const def = findFramework(record.framework)
      const timeoutHours = resolveGateTimeoutHours(def?.gate_timeout_hours)
      // Skip ones already timed out — `enforceGateTimeouts` will (or
      // already did) auto-reject them. Notifying as "stale" would be
      // misleading at that point.
      if (isGateTimedOut(record.created_at, timeoutHours, nowMs)) continue
      if (!isGateStale(record.created_at, timeoutHours, nowMs)) continue
      await notifyStaleGate(record)
    } catch {
      // per-gate failure — keep going
    }
  }
}
