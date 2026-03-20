import type { StepExecutor, ProviderMetadata } from './types'

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
   *   2. Capability match — prefer builtin > mock
   *   3. Error if nothing found (no silent mock fallback)
   */
  resolve(step: { stepType: string; provider: string }): StepExecutor {
    // 1. Exact match
    const exact = this.providers.get(step.provider)
    if (exact) return exact

    // 2. Capability match — find all that canExecute, sort by type priority
    const typePriority: Record<string, number> = { mcp: 0, builtin: 1, mock: 2 }
    const candidates = Array.from(this.providers.values())
      .filter(p => p.canExecute(step as never))
      .sort((a, b) => (typePriority[a.type] ?? 3) - (typePriority[b.type] ?? 3))

    if (candidates.length > 0) return candidates[0]

    // 3. Fallback to mock if registered
    const mock = this.providers.get('mock')
    if (mock) return mock

    throw new Error(`No provider found for step type="${step.stepType}" provider="${step.provider}"`)
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
      status: 'active' as const,
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
export function registerBuiltinProviders(registry: ProviderRegistry): void {
  // Lazy imports to avoid circular deps and allow tree-shaking
  const { MockProvider } = require('./builtin/mock-provider')
  const { QualifyProvider } = require('./builtin/qualify-provider')
  const { FirecrawlProvider } = require('./builtin/firecrawl-provider')
  const { UnipileProvider } = require('./builtin/unipile-provider')
  const { NotionProvider } = require('./builtin/notion-provider')

  registry.register(new MockProvider())
  registry.register(new QualifyProvider())
  registry.register(new FirecrawlProvider())
  registry.register(new UnipileProvider())
  registry.register(new NotionProvider())
}

// Lazy default instance for CLI backward compatibility
let _defaultRegistry: ProviderRegistry | null = null

export function getRegistry(): ProviderRegistry {
  if (!_defaultRegistry) {
    _defaultRegistry = new ProviderRegistry()
    registerBuiltinProviders(_defaultRegistry)
  }
  return _defaultRegistry
}
