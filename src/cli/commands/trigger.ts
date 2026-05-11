/**
 * `yalc-gtm trigger <framework>` — fire an on-demand framework run from CLI.
 *
 * Mirrors `POST /api/today/trigger/:framework` so that scripted triggers
 * (cron, ops scripts, quick local tests) see the same validation +
 * audit-log behaviour as the SPA.
 */

import { triggerOnDemandFramework } from '../../lib/frameworks/trigger.js'

export interface RunTriggerOptions {
  /** Optional logger (defaults to console.log). Used in tests. */
  log?: (message: string) => void
  /** Optional logger for errors (defaults to console.error). Used in tests. */
  logError?: (message: string) => void
  /** Test hook: stub the runner kickoff. */
  startRunner?: (name: string) => Promise<unknown>
}

export interface RunTriggerResult {
  exitCode: number
  runId?: string
}

export async function runTrigger(
  framework: string,
  opts: RunTriggerOptions = {},
): Promise<RunTriggerResult> {
  const log = opts.log ?? ((m: string) => console.log(m))
  const logError = opts.logError ?? ((m: string) => console.error(m))

  const result = await triggerOnDemandFramework({
    framework,
    source: 'cli',
    startRunner: opts.startRunner,
  })

  if (result.ok) {
    log(`  Triggered ${result.framework}.`)
    log(`  run_id: ${result.runId}`)
    log(`  Watch: http://localhost:3847/today`)
    return { exitCode: 0, runId: result.runId }
  }

  if (result.rejection.kind === 'unknown') {
    logError(`Unknown framework: ${framework}`)
    return { exitCode: 1 }
  }
  logError(
    `Framework "${framework}" is mode: scheduled. Use \`yalc-gtm framework:run ${framework}\` ` +
      `to fire scheduled frameworks manually.`,
  )
  return { exitCode: 1 }
}
