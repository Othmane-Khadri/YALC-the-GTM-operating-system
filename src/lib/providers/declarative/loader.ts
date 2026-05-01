/**
 * Declarative manifest loader.
 *
 * Reads `~/.gtm-os/adapters/*.yaml` (or a configurable root) at server
 * boot, compiles each manifest, and memoizes the result by
 * `(source, mtimeMs)` so the directory is read once per process.
 *
 * Compile errors are caught per-file: a single bad manifest must not
 * crash boot. Bad manifests are surfaced via the returned `errors[]`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import type { CompileOptions } from './compiler.js'
import { compileManifest } from './compiler.js'
import type { CompiledManifest } from './types.js'
import { ManifestValidationError } from './types.js'

export interface LoadResult {
  manifests: CompiledManifest[]
  errors: Array<{ source: string; message: string }>
}

export interface LoadOptions extends CompileOptions {
  /** Adapters directory. Default: `~/.gtm-os/adapters`. */
  rootDir?: string
  /** When true, skips the in-process cache. */
  bypassCache?: boolean
}

interface CacheEntry {
  mtimeMs: number
  compiled: CompiledManifest | null
  error: string | null
}

const cache = new Map<string, CacheEntry>()

export function defaultAdaptersDir(): string {
  return join(process.env.HOME ?? homedir(), '.gtm-os', 'adapters')
}

/**
 * Package-bundled declarative adapters that ship with YALC.
 *
 * Location: `<repo-root>/configs/adapters/`. Computed relative to this
 * source file so the path resolves the same in dev (running from
 * `src/`), in tests (vitest under `src/lib/...`), and once installed as
 * an npm package (`node_modules/yalc-gtm-os/configs/adapters`). The
 * `configs/` directory is whitelisted in `package.json -> files`.
 */
export function bundledAdaptersDir(): string {
  // src/lib/providers/declarative/loader.ts → up 4 dirs → repo root
  // (configs/adapters lives next to src/).
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '..', '..', '..', '..', 'configs', 'adapters')
}

export function loadDeclarativeManifests(opts: LoadOptions = {}): LoadResult {
  const dir = opts.rootDir ?? defaultAdaptersDir()
  const out: LoadResult = { manifests: [], errors: [] }
  if (!existsSync(dir)) return out

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!/\.ya?ml$/i.test(entry)) continue
    const source = join(dir, entry)
    let mtimeMs: number
    try {
      mtimeMs = statSync(source).mtimeMs
    } catch {
      continue
    }
    if (!opts.bypassCache) {
      const cached = cache.get(source)
      if (cached && cached.mtimeMs === mtimeMs) {
        if (cached.compiled) out.manifests.push(cached.compiled)
        if (cached.error) out.errors.push({ source, message: cached.error })
        continue
      }
    }

    let raw: string
    try {
      raw = readFileSync(source, 'utf-8')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      out.errors.push({ source, message: `read failed: ${msg}` })
      cache.set(source, { mtimeMs, compiled: null, error: msg })
      continue
    }

    try {
      const compiled = compileManifest(raw, source, opts)
      out.manifests.push(compiled)
      cache.set(source, { mtimeMs, compiled, error: null })
    } catch (err) {
      const msg =
        err instanceof ManifestValidationError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      out.errors.push({ source, message: msg })
      cache.set(source, { mtimeMs, compiled: null, error: msg })
    }
  }
  return out
}

/** Test hook — drop the in-process cache. */
export function resetDeclarativeLoaderCache(): void {
  cache.clear()
}

export interface LoadAllOptions extends CompileOptions {
  /** Override the bundled (package-shipped) adapters root. */
  bundledRootDir?: string
  /** Override the user-installed (`~/.gtm-os/adapters`) root. */
  userRootDir?: string
  bypassCache?: boolean
}

/**
 * Read manifests from BOTH the package-bundled directory AND the
 * user-installed directory, in that order. Order matters: the registry
 * integration relies on user manifests landing AFTER bundled ones via
 * `bucket.set()` last-write semantics, so a user-installed manifest can
 * override one shipped by YALC for the same `(capability, provider)`
 * pair.
 *
 * Errors from either root are merged; a bad bundled manifest does not
 * suppress good user manifests and vice versa.
 */
export function loadDeclarativeManifestsAll(opts: LoadAllOptions = {}): LoadResult {
  const bundledRoot = opts.bundledRootDir ?? bundledAdaptersDir()
  const userRoot = opts.userRootDir ?? defaultAdaptersDir()
  const bundled = loadDeclarativeManifests({
    rootDir: bundledRoot,
    fetchImpl: opts.fetchImpl,
    bypassCache: opts.bypassCache,
  })
  const user = loadDeclarativeManifests({
    rootDir: userRoot,
    fetchImpl: opts.fetchImpl,
    bypassCache: opts.bypassCache,
  })
  return {
    manifests: [...bundled.manifests, ...user.manifests],
    errors: [...bundled.errors, ...user.errors],
  }
}
