/**
 * Wire declarative manifests into the capability registry.
 *
 * MUST run AFTER `registerBuiltinCapabilities()` so that — per Option A
 * in the spec — when the same `(capability, provider)` exists in both
 * forms, the declarative manifest's `bucket.set()` lands last and wins.
 * Each override is logged so users see the swap at startup.
 *
 * Declarative adapters bypass the provider registry: their availability
 * is "every `${env:VAR}` referenced is set in the live process env".
 */

import type {
  CapabilityRegistry,
  CapabilityAdapter,
  AdapterContext,
} from '../capabilities.js'
import {
  loadDeclarativeManifests,
  loadDeclarativeManifestsAll,
  type LoadOptions,
} from './loader.js'
import type { CompiledManifest } from './types.js'

export interface RegisterDeclarativeResult {
  registered: Array<{ capabilityId: string; providerId: string; source: string }>
  overrides: Array<{ capabilityId: string; providerId: string; source: string }>
  errors: Array<{ source: string; message: string }>
  skipped: Array<{ capabilityId: string; providerId: string; source: string; reason: string }>
}

export interface RegisterDeclarativeOptions extends LoadOptions {
  /** Override the logger (defaults to console.warn / console.log). */
  logger?: { warn: (msg: string) => void; info: (msg: string) => void }
  /** Suppress all logging (tests). */
  silent?: boolean
  /**
   * When true, ONLY load from the legacy single `rootDir`/user dir and
   * skip the bundled directory. Default false — production boot loads
   * bundled THEN user so user manifests override bundled per Option A.
   *
   * Existing tests that pass `rootDir: <tmpdir>` to isolate from the
   * real `~/.gtm-os/adapters` need this on, otherwise the live bundled
   * manifests leak into the test registry.
   */
  userOnly?: boolean
}

export function registerDeclarativeAdapters(
  registry: CapabilityRegistry,
  opts: RegisterDeclarativeOptions = {},
): RegisterDeclarativeResult {
  const log = opts.silent
    ? { warn: () => {}, info: () => {} }
    : (opts.logger ?? { warn: (m: string) => console.warn(m), info: (m: string) => console.log(m) })

  const result: RegisterDeclarativeResult = {
    registered: [],
    overrides: [],
    errors: [],
    skipped: [],
  }
  // Resolution order: built-in TS (already registered) → bundled YAML →
  // user YAML. We forward to `loadDeclarativeManifestsAll` for the dual
  // root, EXCEPT when the caller pinned a specific `rootDir` (legacy /
  // test isolation) — in that case load only that one dir.
  const useDualRoot = !opts.userOnly && opts.rootDir === undefined
  const { manifests, errors } = useDualRoot
    ? loadDeclarativeManifestsAll({
        fetchImpl: opts.fetchImpl,
        bypassCache: opts.bypassCache,
      })
    : loadDeclarativeManifests(opts)
  for (const e of errors) {
    log.warn(`[declarative] ${e.source}: ${e.message}`)
    result.errors.push(e)
  }
  for (const compiled of manifests) {
    const cap = registry.getCapability(compiled.capabilityId)
    if (!cap) {
      log.warn(
        `[declarative:${compiled.providerId}] unknown capability '${compiled.capabilityId}' — skipping (${compiled.source})`,
      )
      result.skipped.push({
        capabilityId: compiled.capabilityId,
        providerId: compiled.providerId,
        source: compiled.source,
        reason: 'unknown capability',
      })
      continue
    }
    const existing = registry.listAdapters(compiled.capabilityId).find(
      (a) => a.providerId === compiled.providerId,
    )
    const adapter = buildAdapter(compiled)
    registry.register(adapter)
    if (existing) {
      log.info(
        `[declarative] ${compiled.capabilityId}/${compiled.providerId} → manifest at ${compiled.source} overrides built-in TS adapter`,
      )
      result.overrides.push({
        capabilityId: compiled.capabilityId,
        providerId: compiled.providerId,
        source: compiled.source,
      })
    }
    if (!adapter.isAvailable!()) {
      const missing = compiled.envVars.filter((v) => !process.env[v])
      log.warn(
        `[declarative:${compiled.providerId}] ${missing.join(', ')} missing — adapter registered but unavailable`,
      )
    }
    result.registered.push({
      capabilityId: compiled.capabilityId,
      providerId: compiled.providerId,
      source: compiled.source,
    })
  }
  return result
}

function buildAdapter(compiled: CompiledManifest): CapabilityAdapter {
  return {
    capabilityId: compiled.capabilityId,
    providerId: compiled.providerId,
    isAvailable() {
      for (const v of compiled.envVars) {
        if (!process.env[v]) return false
      }
      return true
    },
    async execute(input: unknown, _ctx: AdapterContext) {
      return compiled.invoke(input)
    },
  }
}

/** Test/CLI helper — extract metadata for `adapters:list`. */
export function describeDeclarativeAdapter(c: CompiledManifest): {
  capabilityId: string
  providerId: string
  version: string
  source: string
  envVars: string[]
  available: boolean
} {
  return {
    capabilityId: c.capabilityId,
    providerId: c.providerId,
    version: c.version,
    source: c.source,
    envVars: c.envVars,
    available: c.envVars.every((v) => !!process.env[v]),
  }
}
