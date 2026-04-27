import { describe, it, expect } from 'vitest'
import {
  checkRequires,
  checkRecommendedWhen,
  contextFieldHasValue,
  recommendFrameworks,
  type RecommendationEnvironment,
} from '../lib/frameworks/recommend'
import type { CompanyContext } from '../lib/framework/context-types'
import type { FrameworkDefinition } from '../lib/frameworks/types'

const ctx: CompanyContext = {
  company: { name: 'Acme', website: 'https://acme.com', description: 'desc' },
  founder: { name: '', linkedin: '' },
  icp: {
    segments_freeform: 'mid-market SaaS founders',
    pain_points: ['slow onboarding'],
    competitors: ['Foo', 'Bar'],
  },
  voice: { description: '', examples_path: '' },
  sources: {},
  meta: { captured_at: '', last_updated_at: '' },
} as CompanyContext

const baseFramework: FrameworkDefinition = {
  name: 'test-framework',
  display_name: 'Test Framework',
  description: 'For tests',
  requires: { providers: ['firecrawl'], any_of_keys: ['ANTHROPIC_API_KEY'] },
  inputs: [],
  schedule: { cron: '0 8 * * *' },
  steps: [{ skill: 'noop', input: {} }],
  output: { destination_choice: [{ dashboard: { route: '/test' } }] },
}

const fullEnv = (over?: Partial<RecommendationEnvironment>): RecommendationEnvironment => ({
  providers: ['firecrawl'],
  envKeys: ['ANTHROPIC_API_KEY'],
  context: ctx,
  installed: [],
  ...over,
})

describe('checkRequires', () => {
  it('passes when providers, keys, and context fields are all present', () => {
    const f: FrameworkDefinition = {
      ...baseFramework,
      requires: {
        providers: ['firecrawl'],
        any_of_keys: ['ANTHROPIC_API_KEY'],
        context_fields: ['icp.competitors'],
      },
    }
    expect(checkRequires(f, fullEnv())).toBeNull()
  })

  it('fails when required provider missing', () => {
    const reason = checkRequires(baseFramework, fullEnv({ providers: [] }))
    expect(reason).not.toBeNull()
    expect(reason?.rule).toBe('providers')
    expect(reason?.detail).toContain('firecrawl')
  })

  it('fails when no any_of_keys is set', () => {
    const reason = checkRequires(baseFramework, fullEnv({ envKeys: [] }))
    expect(reason).not.toBeNull()
    expect(reason?.rule).toBe('any_of_keys')
  })

  it('fails when context_fields path is empty', () => {
    const f: FrameworkDefinition = {
      ...baseFramework,
      requires: { context_fields: ['icp.competitors'] },
    }
    const empty: CompanyContext = { ...ctx, icp: { ...ctx.icp, competitors: [] } }
    const reason = checkRequires(f, fullEnv({ context: empty }))
    expect(reason).not.toBeNull()
    expect(reason?.rule).toBe('context_fields')
  })

  it('fails when context is missing entirely', () => {
    const f: FrameworkDefinition = {
      ...baseFramework,
      requires: { context_fields: ['icp.competitors'] },
    }
    const reason = checkRequires(f, fullEnv({ context: null }))
    expect(reason?.rule).toBe('context_fields')
  })
})

describe('checkRecommendedWhen', () => {
  it('returns null when there is no recommended_when block', () => {
    expect(checkRecommendedWhen(baseFramework, fullEnv())).toBeNull()
  })

  it('rejects when has_competitors_in_context expects true but none', () => {
    const f: FrameworkDefinition = {
      ...baseFramework,
      recommended_when: { has_competitors_in_context: true },
    }
    const empty: CompanyContext = { ...ctx, icp: { ...ctx.icp, competitors: [] } }
    expect(checkRecommendedWhen(f, fullEnv({ context: empty }))).not.toBeNull()
  })

  it('rejects when not_has_active_framework matches an installed one', () => {
    const f: FrameworkDefinition = {
      ...baseFramework,
      recommended_when: { not_has_active_framework: 'already-installed' },
    }
    expect(
      checkRecommendedWhen(f, fullEnv({ installed: ['already-installed'] })),
    ).not.toBeNull()
  })

  it('rejects when has_provider clause does not match', () => {
    const f: FrameworkDefinition = {
      ...baseFramework,
      recommended_when: { has_provider: 'unipile' },
    }
    expect(checkRecommendedWhen(f, fullEnv())).not.toBeNull()
  })

  it('passes when all clauses align with the env', () => {
    const f: FrameworkDefinition = {
      ...baseFramework,
      recommended_when: {
        has_competitors_in_context: true,
        has_provider: 'firecrawl',
        not_has_active_framework: 'something-else',
      },
    }
    expect(checkRecommendedWhen(f, fullEnv())).toBeNull()
  })
})

describe('contextFieldHasValue', () => {
  it('returns true for a non-empty array', () => {
    expect(contextFieldHasValue(ctx, 'icp.competitors')).toBe(true)
  })

  it('returns false for missing path', () => {
    expect(contextFieldHasValue(ctx, 'icp.totally_missing')).toBe(false)
  })

  it('returns false for empty string', () => {
    const empty: CompanyContext = {
      ...ctx,
      company: { ...ctx.company, name: '' },
    }
    expect(contextFieldHasValue(empty, 'company.name')).toBe(false)
  })
})

describe('recommendFrameworks', () => {
  it('ranks higher when more required providers are matched', () => {
    const a: FrameworkDefinition = {
      ...baseFramework,
      name: 'a',
      requires: { providers: ['firecrawl'] },
    }
    const b: FrameworkDefinition = {
      ...baseFramework,
      name: 'b',
      requires: {},
    }
    const env = fullEnv()
    const out = recommendFrameworks(env, [b, a])
    // a uses firecrawl (a registered provider), so it should rank above b
    expect(out.recommended[0].framework.name).toBe('a')
  })

  it('separates eligible-but-not-recommended from ineligible', () => {
    const eligible: FrameworkDefinition = {
      ...baseFramework,
      name: 'eligible-only',
      requires: { providers: ['firecrawl'] },
      recommended_when: { not_has_active_framework: 'eligible-only' },
    }
    const ineligible: FrameworkDefinition = {
      ...baseFramework,
      name: 'ineligible',
      requires: { providers: ['unipile'] },
    }
    const env = fullEnv({ installed: ['eligible-only'] })
    const out = recommendFrameworks(env, [eligible, ineligible])
    expect(out.recommended).toHaveLength(0)
    expect(out.eligibleOnly.map((r) => r.framework.name)).toContain('eligible-only')
    expect(out.ineligible.map((r) => r.framework)).toContain('ineligible')
  })

  it('reports notion preferred destination when NOTION_API_KEY is set', () => {
    const env = fullEnv({ envKeys: ['ANTHROPIC_API_KEY', 'NOTION_API_KEY'] })
    const out = recommendFrameworks(env, [baseFramework])
    expect(out.recommended[0]?.preferredDestination).toBe('notion')
  })

  it('falls back to dashboard when NOTION_API_KEY missing', () => {
    const env = fullEnv()
    const out = recommendFrameworks(env, [baseFramework])
    expect(out.recommended[0]?.preferredDestination).toBe('dashboard')
  })
})
