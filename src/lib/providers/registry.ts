import type { StepExecutor, ProviderMetadata } from './types'
import { MockProvider } from './builtin/mock-provider'

class ProviderRegistry {
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
   *   2. Provider Intelligence recommendation (if stats exist)
   *   3. Capability match — prefer MCP > builtin > mock
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

  /**
   * Async resolve that uses Provider Intelligence to pick the best provider.
   * Falls back to synchronous resolve() if no intelligence exists.
   */
  async resolveAsync(step: { stepType: string; provider: string }, segment?: string): Promise<StepExecutor> {
    try {
      const { ProviderIntelligence } = await import('./intelligence')
      const pi = new ProviderIntelligence()
      const capabilities = Array.from(this.providers.values())
        .filter(p => p.canExecute(step as never))
        .flatMap(p => p.capabilities)

      const best = await pi.getBestProvider({
        stepType: step.stepType,
        capabilities: capabilities as string[],
        segment,
      })

      if (best) {
        const executor = this.providers.get(best.providerId)
        if (executor) return executor
      }
    } catch {
      // No stats yet — fall through to sync resolve
    }

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
    const providers = this.getAll()
    if (providers.length === 0) return 'No providers available.'
    return providers
      .map(p => `- ${p.name} (${p.id}): ${p.description} [capabilities: ${p.capabilities.join(', ')}]`)
      .join('\n')
  }
}

// Module-level singleton
const registry = new ProviderRegistry()

// Auto-register mock provider
registry.register(new MockProvider())

export function getRegistry(): ProviderRegistry {
  return registry
}

export { ProviderRegistry }
