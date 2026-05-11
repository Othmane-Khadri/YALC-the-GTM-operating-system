/**
 * `yalc-gtm adapters:list` — show every adapter the registry can resolve,
 * grouped by capability, with each provider's source (built-in vs.
 * declarative manifest path) and resolution priority. Useful for
 * confirming a freshly-installed declarative manifest actually loaded.
 */

import { getCapabilityRegistryReady } from '../../lib/providers/capabilities.js'
import {
  bundledAdaptersDir,
  defaultAdaptersDir,
  loadDeclarativeManifestsAll,
} from '../../lib/providers/declarative/loader.js'

export interface AdaptersListOptions {
  /** When true, emit JSON instead of the human table. */
  json?: boolean
  /** Override adapters dir for tests. */
  rootDir?: string
}

export interface AdaptersListResult {
  exitCode: number
  output: string
}

interface RowOut {
  capability: string
  provider: string
  source: 'builtin' | 'bundled' | 'user'
  manifestPath?: string
  priorityIndex: number | null
  available: boolean
}

export async function runAdaptersList(
  opts: AdaptersListOptions = {},
): Promise<AdaptersListResult> {
  const registry = await getCapabilityRegistryReady()
  // Identify declarative-sourced (capability, provider) pairs by reading
  // BOTH the package-bundled `configs/adapters/` and the user-installed
  // `~/.gtm-os/adapters/` dirs. Per Option A, when the same key exists
  // in both forms, user wins (last write to bucket.set()).
  const decl = loadDeclarativeManifestsAll(opts.rootDir ? { userRootDir: opts.rootDir } : {})
  const bundledRoot = bundledAdaptersDir()
  const userRoot = opts.rootDir ?? defaultAdaptersDir()
  // Map "cap/provider" -> { source path, origin }. User entries land
  // after bundled in `decl.manifests` order, so a Map.set on the same
  // key naturally captures the user override.
  const declarativeKeys = new Map<string, { path: string; origin: 'bundled' | 'user' }>()
  for (const m of decl.manifests) {
    const origin: 'bundled' | 'user' = m.source.startsWith(userRoot)
      ? 'user'
      : m.source.startsWith(bundledRoot)
        ? 'bundled'
        : 'user'
    declarativeKeys.set(`${m.capabilityId}/${m.providerId}`, { path: m.source, origin })
  }

  const rows: RowOut[] = []
  for (const cap of registry.listCapabilities()) {
    const adapters = registry.listAdapters(cap.id)
    const priority = cap.defaultPriority
    for (const a of adapters) {
      const key = `${cap.id}/${a.providerId}`
      const declEntry = declarativeKeys.get(key)
      rows.push({
        capability: cap.id,
        provider: a.providerId,
        source: declEntry ? declEntry.origin : 'builtin',
        manifestPath: declEntry?.path,
        priorityIndex: priority.indexOf(a.providerId) === -1 ? null : priority.indexOf(a.providerId),
        available: typeof a.isAvailable === 'function' ? a.isAvailable() : true,
      })
    }
  }
  rows.sort((a, b) => {
    if (a.capability !== b.capability) return a.capability.localeCompare(b.capability)
    const ap = a.priorityIndex ?? 999
    const bp = b.priorityIndex ?? 999
    if (ap !== bp) return ap - bp
    return a.provider.localeCompare(b.provider)
  })

  if (opts.json) {
    return { exitCode: 0, output: JSON.stringify({ rows, declarativeErrors: decl.errors }, null, 2) }
  }

  const lines: string[] = []
  let lastCap = ''
  for (const r of rows) {
    if (r.capability !== lastCap) {
      lines.push('')
      lines.push(r.capability)
      lastCap = r.capability
    }
    const prio = r.priorityIndex === null ? '·' : `#${r.priorityIndex + 1}`
    const tag =
      r.source === 'bundled' ? 'bundled' : r.source === 'user' ? 'user' : 'built-in'
    const flag = r.available ? '✓' : '✗'
    const trailer = r.manifestPath ? `  (${r.manifestPath})` : ''
    lines.push(`  ${prio.padEnd(3)} ${flag} ${r.provider.padEnd(20)} [${tag}]${trailer}`)
  }
  if (decl.errors.length > 0) {
    lines.push('')
    lines.push('Declarative load errors:')
    for (const e of decl.errors) lines.push(`  ${e.source}: ${e.message}`)
  }
  return { exitCode: 0, output: lines.join('\n').trimStart() }
}
