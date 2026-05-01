/**
 * Per-gate notification idempotency (D2).
 *
 * Flag files live under `~/.gtm-os/notifications/`. A flag's existence
 * means we have already notified for that (gate, kind) pair so subsequent
 * ticks are a no-op.
 *
 * File name shape: `<framework>__<run-id>__<gate-id>.<kind>.flag`
 *
 * The directory root is resolved at call time so HOME pivots in tests apply.
 */

import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AwaitingGateRecord } from '../frameworks/runner.js'
import type { NotificationKind } from './types.js'

export function notificationsDir(): string {
  return join(homedir(), '.gtm-os', 'notifications')
}

function flagFileName(gate: AwaitingGateRecord, kind: NotificationKind): string {
  // Sanitize: only the run_id is user-controlled (timestamp). Drop any path
  // separator just in case.
  const safe = (s: string) => s.replace(/[\\/]/g, '_')
  return `${safe(gate.framework)}__${safe(gate.run_id)}__${safe(gate.gate_id)}.${kind}.flag`
}

export function flagPath(
  gate: AwaitingGateRecord,
  kind: NotificationKind,
): string {
  return join(notificationsDir(), flagFileName(gate, kind))
}

export function hasNotified(
  gate: AwaitingGateRecord,
  kind: NotificationKind,
): boolean {
  return existsSync(flagPath(gate, kind))
}

export function markNotified(
  gate: AwaitingGateRecord,
  kind: NotificationKind,
): void {
  const dir = notificationsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(flagPath(gate, kind), new Date().toISOString(), 'utf-8')
}

/**
 * Test-only: reset any in-memory state. Currently a no-op (state lives on
 * disk, scoped by HOME), but exported so test files can call it without
 * worrying about implementation details.
 */
export function __resetIdempotencyForTests(): void {
  // No in-memory state — the flag dir is HOME-scoped so tests pivoting
  // HOME automatically get a clean slate.
}

/** List existing flags (debug helper). */
export function listFlags(): string[] {
  const dir = notificationsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
}

/** Test-only / admin: clear a single flag. */
export function clearFlag(
  gate: AwaitingGateRecord,
  kind: NotificationKind,
): void {
  const p = flagPath(gate, kind)
  if (existsSync(p)) rmSync(p, { force: true })
}
