#!/usr/bin/env node
/**
 * smoke.mjs — run a manifest's `smoke_test` block via the upstream
 * `yalc-gtm` CLI, which contributors should already have installed.
 *
 * Usage:
 *   node scripts/smoke.mjs manifests/icp-company-search/apollo.yaml
 *
 * This wrapper exists so contributors can paste a single command into
 * their PR description. It does NOT bundle yalc-gtm-os — that would
 * create a circular install (the community repo depending on the engine
 * it ships manifests for). Install separately:
 *
 *   pnpm add -g yalc-gtm-os
 *
 * Then set the relevant API key in `~/.gtm-os/.env` and rerun smoke.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: node scripts/smoke.mjs <path-to-manifest.yaml>')
  process.exit(1)
}
const path = resolve(process.cwd(), arg)
if (!existsSync(path)) {
  console.error(`Manifest not found: ${path}`)
  process.exit(1)
}

const child = spawn('pnpm', ['exec', 'yalc-gtm', 'adapters:smoke', path], {
  stdio: 'inherit',
})
child.on('error', (err) => {
  console.error(
    `Failed to invoke yalc-gtm. Install it with \`pnpm add -g yalc-gtm-os\` and try again.\n${err.message}`,
  )
  process.exit(1)
})
child.on('exit', (code) => process.exit(code ?? 1))
