/**
 * `yalc-gtm adapters:smoke <path>` — run the declarative manifest's
 * `smoke_test` block against the live vendor and report pass/fail.
 *
 * Used by:
 *   - operators verifying a manifest before dropping it in
 *     `~/.gtm-os/adapters/`
 *   - the provider-builder skill (B3) during the draft loop
 *
 * Exits 0 on green, 1 on red. Network failures still produce a clean
 * structured result — the CLI never throws raw stack traces.
 */

import { runSmoke, formatSmokeResult } from '../../lib/providers/declarative/smoke.js'

export interface AdaptersSmokeOptions {
  json?: boolean
}

export interface AdaptersSmokeResult {
  exitCode: number
  output: string
}

export async function runAdaptersSmoke(
  path: string,
  opts: AdaptersSmokeOptions = {},
): Promise<AdaptersSmokeResult> {
  if (!path) {
    return { exitCode: 1, output: 'Usage: yalc-gtm adapters:smoke <path>' }
  }
  const result = await runSmoke(path)
  const output = opts.json ? JSON.stringify(result, null, 2) : formatSmokeResult(result)
  return { exitCode: result.passed ? 0 : 1, output }
}
