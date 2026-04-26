/**
 * Package path helpers.
 *
 * `PKG_ROOT` resolves to the npm install root (the directory that contains
 * `bin/`, `configs/`, `scripts/`, `templates/`). It's anchored via
 * `import.meta.url` so it works both from a source checkout and from a
 * globally-installed tarball — unlike `process.cwd()` which depends on
 * where the user invoked the CLI.
 *
 * `GTM_OS_DIR` is the per-user state directory (`~/.gtm-os/`).
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'

// This file lives at `src/lib/paths.ts`. Two levels up is the package root.
export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const HOME_DIR = homedir()
export const GTM_OS_DIR = resolve(HOME_DIR, '.gtm-os')
