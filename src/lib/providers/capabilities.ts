/**
 * Capability registry — the provider-agnostic abstraction for skills.
 *
 * Skills declare WHAT they need (`capability: icp-company-search`); this
 * registry resolves an installed PROVIDER that satisfies the capability,
 * via a per-capability priority list. Resolution order:
 *
 *   1. User-supplied priority — `~/.gtm-os/config.yaml`:
 *        capabilities:
 *          icp-company-search:
 *            priority: [crustdata, apollo]
 *   2. Capability-declared default priority (registered by the adapter).
 *
 * The first provider in the priority list whose `StepExecutor` is present
 * in the provider registry (and `isAvailable()`) wins. If none match a
 * `CapabilityUnsatisfied` error is thrown with a list of what was tried
 * and an actionable next step.
 *
 * Adapters delegate to existing service modules (CrustdataService,
 * UnipileService, etc.) so we don't duplicate provider-specific code —
 * the adapter only translates the capability's structured input into the
 * service call and the service result back into the capability output.
 *
 * Schema validation is documentation-only in 0.8.0 (per the design doc);
 * runtime validation is sub-phase 0.8.D.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { StepExecutor } from './types.js'
import { getRegistryReady, type ProviderRegistry } from './registry.js'

/**
 * Lightweight structural alias for a JSON Schema. Capability schemas are
 * documentation in 0.8.0; ajv-style runtime validation lands in 0.8.D.
 * Keeping this loose avoids a new dep just to type-annotate a doc field.
 */
export type JSONSchema = Record<string, unknown>

export interface Capability {
  id: string
  description: string
  inputSchema: JSONSchema
  outputSchema: JSONSchema
  /** Default provider order when config.yaml has no override for this capability. */
  defaultPriority: string[]
}

export interface AdapterContext {
  /**
   * Resolved provider executor for this adapter's `providerId`. Present
   * when the provider id matches a registered StepExecutor in the
   * provider registry; null for adapters that talk to a service module
   * directly (e.g. `anthropic`, `openai` — no StepExecutor in the
   * registry, just an env-var-gated SDK call).
   */
  executor: StepExecutor | null
  /** The provider registry the executor was resolved from. */
  registry: ProviderRegistry
  /** Tenant slug for downstream service calls (defaults to 'default'). */
  tenantId?: string
}

export interface CapabilityAdapter {
  capabilityId: string
  providerId: string
  /**
   * Whether the underlying provider/service is configured (e.g. has the
   * required env vars). The capability registry uses this to skip
   * unavailable adapters during priority resolution. Defaults to looking
   * the `providerId` up in the provider registry's `isAvailable()` if
   * the adapter doesn't override.
   */
  isAvailable?(): boolean
  execute(input: unknown, ctx: AdapterContext): Promise<unknown>
}

export class CapabilityUnsatisfied extends Error {
  readonly capabilityId: string
  readonly tried: string[]
  constructor(capabilityId: string, tried: string[]) {
    const list = tried.length > 0 ? `[${tried.join(', ')}]` : '[]'
    super(
      `Capability '${capabilityId}' has no satisfied provider. Tried (in order): ${list}. ` +
      `Install one with: yalc-gtm provider:add --mcp <name> OR yalc-gtm connect-provider <name> (in 0.8.E).`,
    )
    this.name = 'CapabilityUnsatisfied'
    this.capabilityId = capabilityId
    this.tried = tried
  }
}

/** Read `~/.gtm-os/config.yaml → capabilities.<id>.priority` if present. */
function readConfiguredPriority(capabilityId: string): string[] | null {
  const configPath = join(homedir(), '.gtm-os', 'config.yaml')
  if (!existsSync(configPath)) return null
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf-8')
  } catch {
    return null
  }
  let cfg: unknown
  try {
    cfg = yaml.load(raw)
  } catch {
    return null
  }
  if (!cfg || typeof cfg !== 'object') return null
  const caps = (cfg as Record<string, unknown>).capabilities
  if (!caps || typeof caps !== 'object') return null
  const slot = (caps as Record<string, unknown>)[capabilityId]
  if (!slot || typeof slot !== 'object') return null
  const priority = (slot as Record<string, unknown>).priority
  if (!Array.isArray(priority)) {
    throw new Error(
      `Invalid 'capabilities.${capabilityId}.priority' in ~/.gtm-os/config.yaml — expected array, got ${typeof priority}`,
    )
  }
  const out: string[] = []
  for (const item of priority) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error(
        `Invalid 'capabilities.${capabilityId}.priority' entry — every item must be a non-empty provider id string`,
      )
    }
    out.push(item.trim())
  }
  return out
}

export class CapabilityRegistry {
  private capabilities = new Map<string, Capability>()
  /** capabilityId -> providerId -> adapter */
  private adapters = new Map<string, Map<string, CapabilityAdapter>>()

  registerCapability(capability: Capability): void {
    this.capabilities.set(capability.id, capability)
    if (!this.adapters.has(capability.id)) {
      this.adapters.set(capability.id, new Map())
    }
  }

  register(adapter: CapabilityAdapter): void {
    let bucket = this.adapters.get(adapter.capabilityId)
    if (!bucket) {
      bucket = new Map()
      this.adapters.set(adapter.capabilityId, bucket)
    }
    bucket.set(adapter.providerId, adapter)
  }

  getCapability(id: string): Capability | null {
    return this.capabilities.get(id) ?? null
  }

  listCapabilities(): Capability[] {
    return Array.from(this.capabilities.values()).sort((a, b) => a.id.localeCompare(b.id))
  }

  /** Adapters registered for a capability id (any provider). */
  listAdapters(capabilityId: string): CapabilityAdapter[] {
    const bucket = this.adapters.get(capabilityId)
    if (!bucket) return []
    return Array.from(bucket.values())
  }

  /**
   * Resolve a capability to the highest-priority installed adapter.
   * Throws `CapabilityUnsatisfied` when none of the priority providers
   * are present + available in the provider registry.
   */
  async resolve(capabilityId: string): Promise<CapabilityAdapter> {
    const cap = this.capabilities.get(capabilityId)
    if (!cap) {
      throw new CapabilityUnsatisfied(capabilityId, [])
    }
    const configured = readConfiguredPriority(capabilityId)
    const priority = configured ?? cap.defaultPriority
    if (priority.length === 0) {
      throw new CapabilityUnsatisfied(capabilityId, [])
    }
    const providerRegistry = await getRegistryReady()
    const bucket = this.adapters.get(capabilityId) ?? new Map<string, CapabilityAdapter>()
    const tried: string[] = []
    for (const providerId of priority) {
      tried.push(providerId)
      const adapter = bucket.get(providerId)
      if (!adapter) continue
      if (!isAdapterAvailable(adapter, providerRegistry)) continue
      return adapter
    }
    throw new CapabilityUnsatisfied(capabilityId, tried)
  }

  /** Resolve plus return the executor + provider registry for adapter execution. */
  async resolveWithContext(
    capabilityId: string,
    tenantId?: string,
  ): Promise<{ adapter: CapabilityAdapter; ctx: AdapterContext }> {
    const adapter = await this.resolve(capabilityId)
    const providerRegistry = await getRegistryReady()
    const executor = lookupExecutor(adapter.providerId, providerRegistry)
    return { adapter, ctx: { executor, registry: providerRegistry, tenantId } }
  }
}

function lookupExecutor(providerId: string, registry: ProviderRegistry): StepExecutor | null {
  try {
    return registry.resolve({ stepType: 'custom', provider: providerId })
  } catch {
    return null
  }
}

function isAdapterAvailable(adapter: CapabilityAdapter, registry: ProviderRegistry): boolean {
  if (typeof adapter.isAvailable === 'function') {
    return adapter.isAvailable()
  }
  const executor = lookupExecutor(adapter.providerId, registry)
  return !!executor && executor.isAvailable()
}

let _defaultRegistry: CapabilityRegistry | null = null
let _initPromise: Promise<void> | null = null

export function getCapabilityRegistry(): CapabilityRegistry {
  if (!_defaultRegistry) {
    _defaultRegistry = new CapabilityRegistry()
    _initPromise = (async () => {
      const { registerBuiltinCapabilities } = await import('./adapters/index.js')
      await registerBuiltinCapabilities(_defaultRegistry!)
      // Declarative manifests run AFTER built-ins so a declarative entry
      // for the same (capability, provider) wins via last-write to
      // bucket.set(). Failures are logged but never crash boot.
      try {
        const { registerDeclarativeAdapters } = await import('./declarative/registry-integration.js')
        registerDeclarativeAdapters(_defaultRegistry!)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[declarative] loader failed: ${msg}`)
      }
    })()
  }
  return _defaultRegistry
}

export async function getCapabilityRegistryReady(): Promise<CapabilityRegistry> {
  const registry = getCapabilityRegistry()
  if (_initPromise) await _initPromise
  return registry
}

/** Test hook — drops the singleton so a fresh registry is built next call. */
export function resetCapabilityRegistry(): void {
  _defaultRegistry = null
  _initPromise = null
}
