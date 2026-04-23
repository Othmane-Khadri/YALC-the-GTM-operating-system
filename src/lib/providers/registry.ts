import type { StepExecutor, ProviderMetadata } from './types'

export class ProviderNotFoundError extends Error {
  constructor(provider: string, available: string[], suggestion?: string) {
    const msg = suggestion
      ? `Provider '${provider}' not found. Available: ${available.join(', ')}. Did you mean '${suggestion}'?`
      : `Provider '${provider}' not found. Available: ${available.join(', ')}.`
    super(msg)
    this.name = 'ProviderNotFoundError'
  }
}

function normalize(id: string): string {
  return id.toLowerCase().replace(/[-_]/g, '').trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function findClosest(target: string, candidates: string[]): string | undefined {
  const norm = normalize(target)
  let best: string | undefined
  let bestDist = Infinity
  for (const c of candidates) {
    const dist = levenshtein(norm, normalize(c))
    if (dist < bestDist) {
      bestDist = dist
      best = c
    }
  }
  // Only suggest if reasonably close (distance < half the target length)
  return best && bestDist <= Math.ceil(target.length / 2) ? best : undefined
}

export class ProviderRegistry {
  private providers = new Map<string, StepExecutor>()

  register(executor: StepExecutor): void {
    this.providers.set(executor.id, executor)
  }

  unregister(id: string): void {
    this.providers.delete(id)
  }

  /**
   * Resolve the best executor for a given step.
   * Priority:
   *   1. Exact provider match by id
   *   2. Normalized match (lowercase, no hyphens/underscores)
   *   3. Capability match — prefer builtin > mock
   *   4. Error with suggestion (NEVER silently fall back to mock)
   */
  resolve(step: { stepType: string; provider: string }): StepExecutor {
    // 1. Exact match
    const exact = this.providers.get(step.provider)
    if (exact) return exact

    // 2. Normalized match
    const normalizedTarget = normalize(step.provider)
    for (const [id, executor] of this.providers) {
      if (normalize(id) === normalizedTarget) return executor
    }

    // 3. Capability match — find all that canExecute, sort by type priority
    const typePriority: Record<string, number> = { builtin: 0, mcp: 1, mock: 2 }
    const candidates = Array.from(this.providers.values())
      .filter(p => p.canExecute(step as never))
      // BUG-010: stable, deterministic tiebreaker on id so resolution is not
      // sensitive to registration order when multiple builtin providers claim
      // the same capability.
      .sort((a, b) => {
        const tp = (typePriority[a.type] ?? 2) - (typePriority[b.type] ?? 2)
        if (tp !== 0) return tp
        return a.id.localeCompare(b.id)
      })

    if (candidates.length > 0) return candidates[0]

    // 4. No match — throw with suggestion
    const available = Array.from(this.providers.keys())
    const suggestion = findClosest(step.provider, available)
    throw new ProviderNotFoundError(step.provider, available, suggestion)
  }

  async resolveAsync(step: { stepType: string; provider: string }): Promise<StepExecutor> {
    return this.resolve(step)
  }

  getAll(): ProviderMetadata[] {
    return Array.from(this.providers.values()).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type,
      capabilities: p.capabilities,
      status: p.isAvailable() ? 'active' as const : 'disconnected' as const,
    }))
  }

  /**
   * Generates the dynamic provider list string injected into
   * the workflow planner's system prompt.
   */
  getAvailableForPlanner(): string {
    const available = Array.from(this.providers.values()).filter(p => p.isAvailable())
    if (available.length === 0) return 'No providers available.'
    return available
      .map(p => `- ${p.name} (${p.id}): ${p.description} [capabilities: ${p.capabilities.join(', ')}]`)
      .join('\n')
  }
}

/**
 * Register all built-in providers on a registry instance.
 */
export async function registerBuiltinProviders(registry: ProviderRegistry): Promise<void> {
  const { MockProvider } = await import('./builtin/mock-provider')
  const { QualifyProvider } = await import('./builtin/qualify-provider')
  const { FirecrawlProvider } = await import('./builtin/firecrawl-provider')
  const { UnipileProvider } = await import('./builtin/unipile-provider')
  const { NotionProvider } = await import('./builtin/notion-provider')
  const { CrustdataProvider } = await import('./builtin/crustdata-provider')
  const { FullEnrichProvider } = await import('./builtin/fullenrich-provider')
  const { InstantlyProvider } = await import('./builtin/instantly-provider')
  const { OrthogonalProvider } = await import('./builtin/orthogonal-provider')
  const { ResearchProvider } = await import('./builtin/research-provider')

  registry.register(new MockProvider())
  registry.register(new QualifyProvider())
  registry.register(new FirecrawlProvider())
  registry.register(new UnipileProvider())
  registry.register(new NotionProvider())
  registry.register(new CrustdataProvider())
  registry.register(new FullEnrichProvider())
  registry.register(new InstantlyProvider())
  registry.register(new OrthogonalProvider())
  registry.register(new ResearchProvider())
}

/**
 * Register MCP providers discovered in ~/.gtm-os/mcp/*.json.
 * Runs after builtins so MCP providers never shadow core providers.
 */
export async function registerMcpProviders(registry: ProviderRegistry): Promise<void> {
  try {
    const { loadMcpProviders } = await import('./mcp-loader')
    await loadMcpProviders(registry)
  } catch (err) {
    // MCP loading is best-effort — never crash the CLI
    // eslint-disable-next-line no-console
    console.warn(`[registry] MCP provider loading failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Lazy default instance for CLI backward compatibility
let _defaultRegistry: ProviderRegistry | null = null

let _initPromise: Promise<void> | null = null

export function getRegistry(): ProviderRegistry {
  if (!_defaultRegistry) {
    _defaultRegistry = new ProviderRegistry()
    _initPromise = (async () => {
      await registerBuiltinProviders(_defaultRegistry!)
      await registerMcpProviders(_defaultRegistry!)
    })()
  }
  return _defaultRegistry
}

export async function getRegistryReady(): Promise<ProviderRegistry> {
  const registry = getRegistry()
  if (_initPromise) await _initPromise
  return registry
}
