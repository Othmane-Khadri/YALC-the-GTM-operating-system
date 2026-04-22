import { describe, it, expect, beforeEach } from 'vitest'
import { ProviderRegistry, ProviderNotFoundError } from '../lib/providers/registry'
import type { StepExecutor, ProviderCapability, WorkflowStepInput, ExecutionContext, RowBatch } from '../lib/providers/types'
import type { ColumnDef } from '../lib/ai/types'

/**
 * Tests for the provider registry: registration, resolution, fuzzy matching,
 * capability matching, and error handling.
 */

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function createMockProvider(
  id: string,
  opts: {
    type?: 'builtin' | 'mock'
    capabilities?: ProviderCapability[]
    canExecute?: (step: WorkflowStepInput) => boolean
    isAvailable?: () => boolean
  } = {},
): StepExecutor {
  return {
    id,
    name: `${id}-provider`,
    description: `Mock provider: ${id}`,
    type: opts.type ?? 'builtin',
    capabilities: opts.capabilities ?? ['search'],
    isAvailable: opts.isAvailable ?? (() => true),
    canExecute: opts.canExecute ?? (() => false),
    execute: async function* (_step: WorkflowStepInput, _ctx: ExecutionContext): AsyncGenerator<RowBatch> {
      yield { rows: [], batchIndex: 0, totalSoFar: 0 }
    },
    getColumnDefinitions: () => [] as ColumnDef[],
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

describe('ProviderRegistry — registration', () => {
  let registry: ProviderRegistry

  beforeEach(() => {
    registry = new ProviderRegistry()
  })

  it('registers and resolves a provider by exact id', () => {
    const provider = createMockProvider('crustdata')
    registry.register(provider)
    const resolved = registry.resolve({ stepType: 'search', provider: 'crustdata' })
    expect(resolved.id).toBe('crustdata')
  })

  it('overwrites a provider on re-registration', () => {
    registry.register(createMockProvider('crustdata', { type: 'mock' }))
    registry.register(createMockProvider('crustdata', { type: 'builtin' }))
    const resolved = registry.resolve({ stepType: 'search', provider: 'crustdata' })
    expect(resolved.type).toBe('builtin')
  })

  it('unregisters a provider', () => {
    registry.register(createMockProvider('crustdata'))
    registry.unregister('crustdata')
    expect(() =>
      registry.resolve({ stepType: 'search', provider: 'crustdata' }),
    ).toThrow(ProviderNotFoundError)
  })

  it('getAll returns metadata for all registered providers', () => {
    registry.register(createMockProvider('alpha'))
    registry.register(createMockProvider('beta'))
    const all = registry.getAll()
    expect(all).toHaveLength(2)
    expect(all.map(p => p.id).sort()).toEqual(['alpha', 'beta'])
  })
})

// ─── Resolution — Exact Match ─────────────────────────────────────────────────

describe('ProviderRegistry — exact resolution', () => {
  let registry: ProviderRegistry

  beforeEach(() => {
    registry = new ProviderRegistry()
    registry.register(createMockProvider('crustdata'))
    registry.register(createMockProvider('unipile'))
    registry.register(createMockProvider('firecrawl'))
  })

  it('resolves exact match case-sensitively', () => {
    const resolved = registry.resolve({ stepType: 'search', provider: 'crustdata' })
    expect(resolved.id).toBe('crustdata')
  })
})

// ─── Resolution — Normalized Match ────────────────────────────────────────────

describe('ProviderRegistry — normalized resolution', () => {
  let registry: ProviderRegistry

  beforeEach(() => {
    registry = new ProviderRegistry()
    registry.register(createMockProvider('full-enrich'))
  })

  it('resolves with different casing', () => {
    const resolved = registry.resolve({ stepType: 'enrich', provider: 'Full-Enrich' })
    expect(resolved.id).toBe('full-enrich')
  })

  it('resolves with underscores instead of hyphens', () => {
    const resolved = registry.resolve({ stepType: 'enrich', provider: 'full_enrich' })
    expect(resolved.id).toBe('full-enrich')
  })

  it('resolves with no separators', () => {
    const resolved = registry.resolve({ stepType: 'enrich', provider: 'fullenrich' })
    expect(resolved.id).toBe('full-enrich')
  })
})

// ─── Resolution — Capability Match ────────────────────────────────────────────

describe('ProviderRegistry — capability match', () => {
  let registry: ProviderRegistry

  beforeEach(() => {
    registry = new ProviderRegistry()
  })

  it('falls back to capability match when no exact/normalized match', () => {
    const provider = createMockProvider('crustdata', {
      type: 'builtin',
      canExecute: (step) => step.stepType === 'search',
    })
    registry.register(provider)
    const resolved = registry.resolve({ stepType: 'search', provider: 'auto' })
    expect(resolved.id).toBe('crustdata')
  })

  it('prefers builtin over mock when both can execute', () => {
    const mockProvider = createMockProvider('mock', {
      type: 'mock',
      canExecute: () => true,
    })
    const builtinProvider = createMockProvider('crustdata', {
      type: 'builtin',
      canExecute: () => true,
    })
    registry.register(mockProvider)
    registry.register(builtinProvider)
    const resolved = registry.resolve({ stepType: 'search', provider: 'unknown' })
    expect(resolved.type).toBe('builtin')
  })

  it('deterministic tiebreaker sorts by id when same type', () => {
    const beta = createMockProvider('beta', { type: 'builtin', canExecute: () => true })
    const alpha = createMockProvider('alpha', { type: 'builtin', canExecute: () => true })
    registry.register(beta)
    registry.register(alpha)
    const resolved = registry.resolve({ stepType: 'search', provider: 'anything' })
    expect(resolved.id).toBe('alpha') // alphabetically first
  })
})

// ─── Resolution — Error with Suggestion ───────────────────────────────────────

describe('ProviderRegistry — error with suggestion', () => {
  let registry: ProviderRegistry

  beforeEach(() => {
    registry = new ProviderRegistry()
    registry.register(createMockProvider('crustdata'))
    registry.register(createMockProvider('unipile'))
    registry.register(createMockProvider('firecrawl'))
  })

  it('throws ProviderNotFoundError for unknown provider', () => {
    expect(() =>
      registry.resolve({ stepType: 'search', provider: 'nonexistent' }),
    ).toThrow(ProviderNotFoundError)
  })

  it('includes available providers in error message', () => {
    try {
      registry.resolve({ stepType: 'search', provider: 'nonexistent' })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderNotFoundError)
      expect((err as Error).message).toContain('crustdata')
      expect((err as Error).message).toContain('unipile')
      expect((err as Error).message).toContain('firecrawl')
    }
  })

  it('suggests closest match for typos', () => {
    try {
      registry.resolve({ stepType: 'search', provider: 'crusdata' }) // missing 't'
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as Error).message).toContain("Did you mean 'crustdata'")
    }
  })

  it('suggests closest match for "unipil" typo', () => {
    try {
      registry.resolve({ stepType: 'search', provider: 'unipil' })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as Error).message).toContain("Did you mean 'unipile'")
    }
  })

  it('does not suggest when target is too different', () => {
    try {
      registry.resolve({ stepType: 'search', provider: 'zzzzzzzzzzz' })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as Error).message).not.toContain('Did you mean')
    }
  })
})

// ─── getAvailableForPlanner ───────────────────────────────────────────────────

describe('ProviderRegistry — getAvailableForPlanner', () => {
  it('only includes available providers', () => {
    const registry = new ProviderRegistry()
    registry.register(createMockProvider('available', { isAvailable: () => true }))
    registry.register(createMockProvider('unavailable', { isAvailable: () => false }))
    const text = registry.getAvailableForPlanner()
    expect(text).toContain('available')
    expect(text).not.toContain('unavailable')
  })

  it('returns "No providers available" when all unavailable', () => {
    const registry = new ProviderRegistry()
    registry.register(createMockProvider('offline', { isAvailable: () => false }))
    expect(registry.getAvailableForPlanner()).toBe('No providers available.')
  })

  it('returns "No providers available" when registry empty', () => {
    const registry = new ProviderRegistry()
    expect(registry.getAvailableForPlanner()).toBe('No providers available.')
  })
})

// ─── resolveAsync ─────────────────────────────────────────────────────────────

describe('ProviderRegistry — resolveAsync', () => {
  it('resolves the same as sync resolve', async () => {
    const registry = new ProviderRegistry()
    registry.register(createMockProvider('crustdata'))
    const result = await registry.resolveAsync({ stepType: 'search', provider: 'crustdata' })
    expect(result.id).toBe('crustdata')
  })
})
