/**
 * Trigger-now helper for `mode: on-demand` frameworks (D4).
 *
 * Owns the shared execution path used by `POST /api/today/trigger/:framework`
 * and the `yalc-gtm trigger <name>` CLI. Keeping the logic here means the
 * /today route handler stays small (so D3 + C5 can land alongside without
 * stepping on the same lines), and the CLI command is a thin shell.
 *
 * Responsibilities:
 *   1. Validate the named framework exists (`unknown`) and is on-demand
 *      (`not_on_demand`). Scheduled frameworks intentionally fall through
 *      so users have to use `framework:run` for those.
 *   2. Generate the run id ahead of time (matches the runner's
 *      `new Date().toISOString().replace(/[:.]/g, '-')` convention) so the
 *      caller can return it immediately and the SPA can poll for completion
 *      without waiting on the run to finish.
 *   3. Append a one-line audit entry to `~/.gtm-os/triggers.log`.
 *   4. Kick off `runFramework(name)` without awaiting the result. The runner
 *      already persists partial / final run JSONs and emits its own gate
 *      sentinels — there's no extra bookkeeping needed here.
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { findFramework } from './loader.js'

/** Reasons a trigger may be rejected before the runner starts. */
export type TriggerRejection =
  | { kind: 'unknown'; framework: string }
  | { kind: 'not_on_demand'; framework: string; mode: 'scheduled' }

/** Source label persisted in the audit log (and surfaced in HTTP responses). */
export type TriggerSource = 'spa' | 'cli'

export interface TriggerSuccess {
  ok: true
  framework: string
  runId: string
  source: TriggerSource
}

export type TriggerResult = TriggerSuccess | { ok: false; rejection: TriggerRejection }

/** Path to the global triggers audit log. Resolved at call time so HOME pivots in tests apply. */
export function triggersLogPath(): string {
  return join(homedir(), '.gtm-os', 'triggers.log')
}

/**
 * Append `<iso> <framework> source=<src> run_id=<id>\n` to the audit log.
 * Best-effort — never throws on filesystem errors so a transient log issue
 * cannot break a production trigger.
 */
export function appendTriggerLog(args: {
  framework: string
  runId: string
  source: TriggerSource
  now?: Date
}): void {
  const ts = (args.now ?? new Date()).toISOString()
  const line = `${ts} ${args.framework} source=${args.source} run_id=${args.runId}\n`
  try {
    const path = triggersLogPath()
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(path, line, 'utf-8')
  } catch {
    // Audit log failures must not break a trigger.
  }
}

/**
 * Validate + start an on-demand framework run.
 *
 * Resolves with `{ ok: true, runId }` after the audit line is written and
 * the runner has been kicked off. The runner runs detached — the returned
 * promise does NOT wait for completion. Use the existing /api/today/feed
 * polling to observe the resulting run JSON.
 */
export async function triggerOnDemandFramework(args: {
  framework: string
  source: TriggerSource
  /** Optional override hook for tests to capture the runner promise. */
  startRunner?: (name: string) => Promise<unknown>
  now?: Date
}): Promise<TriggerResult> {
  const def = findFramework(args.framework)
  if (!def) {
    return { ok: false, rejection: { kind: 'unknown', framework: args.framework } }
  }
  const mode = def.mode ?? 'scheduled'
  if (mode !== 'on-demand') {
    return {
      ok: false,
      rejection: { kind: 'not_on_demand', framework: args.framework, mode: 'scheduled' },
    }
  }

  // Predict the run id the runner will mint. The runner uses `new Date()` at
  // the top of `runFramework`, so we use the same instant here. The value
  // matches exactly when both calls land in the same millisecond (the common
  // case for fire-and-forget); a 1ms drift is acceptable for the audit log
  // and SPA polling — both treat the id as opaque.
  const ranAt = (args.now ?? new Date()).toISOString()
  const runId = ranAt.replace(/[:.]/g, '-')

  appendTriggerLog({ framework: args.framework, runId, source: args.source, now: args.now })

  // Kick off the runner without awaiting. The runner persists its own run
  // JSON (success / partial-on-failure / awaiting-gate sentinel), so callers
  // observe completion through /api/today/feed.
  const start =
    args.startRunner ??
    (async (name: string) => {
      const { runFramework } = await import('./runner.js')
      return runFramework(name)
    })
  // Floating promise on purpose — swallow runner errors to avoid an unhandled
  // rejection killing the host process. Errors are surfaced through the
  // run JSON the runner writes to disk.
  void start(args.framework).catch(() => {
    /* swallowed — runner persists its own error state */
  })

  return { ok: true, framework: args.framework, runId, source: args.source }
}
