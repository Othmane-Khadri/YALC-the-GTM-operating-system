/**
 * `yalc-gtm gates:list` — show every awaiting human-gate sentinel with
 * framework, gate id, age, time-until-timeout, and stale/fresh status.
 *
 * Mirrors the `adapters:list` style: human table by default, `--json` for
 * machine-readable output. Runs `enforceGateTimeouts` first so timed-out
 * sentinels never appear in the listing — they're auto-rejected on the spot.
 */

import { listAwaitingGates } from '../../lib/frameworks/gates.js'
import type { AwaitingGateRecord } from '../../lib/frameworks/runner.js'
import {
  enforceGateTimeouts,
  isGateStale,
  resolveGateTimeoutHours,
} from '../../lib/frameworks/gate-timeouts.js'
import { findFramework } from '../../lib/frameworks/loader.js'

export interface GatesListOptions {
  /** When true, emit JSON instead of the human table. */
  json?: boolean
}

export interface GatesListResult {
  exitCode: number
  output: string
}

interface GateRow {
  framework: string
  run_id: string
  gate_id: string
  step_index: number
  created_at: string
  age_hours: number
  timeout_hours: number
  hours_until_timeout: number
  status: 'fresh' | 'stale'
}

function buildRows(now: number): GateRow[] {
  // listAwaitingGates intentionally returns the on-disk records as-is.
  // We pull each one and resolve the framework manifest to get the
  // per-framework timeout, falling back to env / 72h when not set.
  const records: AwaitingGateRecord[] = listAwaitingGates()
  const rows: GateRow[] = []
  for (const r of records) {
    const created = Date.parse(r.created_at)
    if (!Number.isFinite(created)) continue
    const def = findFramework(r.framework)
    const timeoutHours = resolveGateTimeoutHours(def?.gate_timeout_hours)
    const ageHours = Math.max(0, (now - created) / (3600 * 1000))
    const hoursUntilTimeout = Math.max(0, timeoutHours - ageHours)
    rows.push({
      framework: r.framework,
      run_id: r.run_id,
      gate_id: r.gate_id,
      step_index: r.step_index,
      created_at: r.created_at,
      age_hours: round1(ageHours),
      timeout_hours: timeoutHours,
      hours_until_timeout: round1(hoursUntilTimeout),
      status: isGateStale(r.created_at, timeoutHours, now) ? 'stale' : 'fresh',
    })
  }
  rows.sort((a, b) => {
    // Stale first (urgent), then oldest first.
    if (a.status !== b.status) return a.status === 'stale' ? -1 : 1
    return a.created_at.localeCompare(b.created_at)
  })
  return rows
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export async function runGatesList(
  opts: GatesListOptions = {},
): Promise<GatesListResult> {
  // Auto-reject expired sentinels before listing so the table never shows
  // gates that are already past the timeout window.
  try {
    enforceGateTimeouts()
  } catch {
    // best-effort
  }
  const rows = buildRows(Date.now())
  if (opts.json) {
    return { exitCode: 0, output: JSON.stringify({ rows, total: rows.length }, null, 2) }
  }
  if (rows.length === 0) {
    return { exitCode: 0, output: 'No awaiting gates.' }
  }
  const lines: string[] = []
  lines.push(
    `${'STATUS'.padEnd(7)} ${'FRAMEWORK'.padEnd(28)} ${'GATE'.padEnd(18)} ${'AGE'.padEnd(8)} ${'TIMEOUT'.padEnd(8)} ${'LEFT'.padEnd(8)} RUN_ID`,
  )
  for (const r of rows) {
    lines.push(
      `${r.status.padEnd(7)} ${r.framework.padEnd(28)} ${r.gate_id.padEnd(18)} ${(r.age_hours + 'h').padEnd(8)} ${(r.timeout_hours + 'h').padEnd(8)} ${(r.hours_until_timeout + 'h').padEnd(8)} ${r.run_id}`,
    )
  }
  return { exitCode: 0, output: lines.join('\n') }
}
