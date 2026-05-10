#!/usr/bin/env node
/**
 * Bin entry for `yalc-update`.
 *
 * Registers tsx's ESM loader, then imports the TypeScript command entry.
 * Works on Linux, macOS, and Windows without a build step.
 */
import { tsImport } from 'tsx/esm/api'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const entry = resolve(here, '../src/cli/yalc-update/index.ts')

await tsImport(entry, import.meta.url)
