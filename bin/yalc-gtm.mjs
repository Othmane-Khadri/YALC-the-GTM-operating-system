#!/usr/bin/env node
/**
 * Portable bin entry for `yalc-gtm`.
 *
 * Registers tsx's ESM loader, then imports the TypeScript CLI entry.
 * Works on Linux, macOS, and Windows without a build step because we
 * never rely on a shebang inside the .ts file.
 */
import { tsImport } from 'tsx/esm/api'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const cliEntry = resolve(here, '../src/cli/index.ts')

await tsImport(cliEntry, import.meta.url)
