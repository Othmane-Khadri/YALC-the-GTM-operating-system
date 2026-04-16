/**
 * Adapter registry — Phase 1 / C1.
 *
 * Simple id-keyed registry for context adapters, patterned after
 * `src/lib/providers/registry.ts`. Adapters register themselves at
 * module-load time via `registerAdapter()` and are looked up by id.
 *
 * `listAvailableAdapters(tenantId)` returns only the adapters whose
 * `isAvailable()` returns truthy for that tenant — the CLI uses this
 * to decide which adapters to run during `context:sync`.
 */

import type { ContextAdapter } from './types.js'

const registry = new Map<string, ContextAdapter>()

export function registerAdapter(adapter: ContextAdapter): void {
  if (registry.has(adapter.id)) {
    throw new Error(`Adapter ${adapter.id} is already registered`)
  }
  registry.set(adapter.id, adapter)
}

export function getAdapter(id: string): ContextAdapter | undefined {
  return registry.get(id)
}

export function listAllAdapters(): ContextAdapter[] {
  return Array.from(registry.values())
}

export async function listAvailableAdapters(tenantId: string): Promise<ContextAdapter[]> {
  const out: ContextAdapter[] = []
  for (const adapter of registry.values()) {
    if (await adapter.isAvailable(tenantId)) out.push(adapter)
  }
  return out
}

/** Test helper — clears the registry. Not for production use. */
export function _resetRegistryForTests(): void {
  registry.clear()
}
