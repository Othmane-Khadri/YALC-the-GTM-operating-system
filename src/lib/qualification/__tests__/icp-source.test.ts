import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { GTMFramework, ICPSegment } from '../../framework/types'

// ─── Mocks ────────────────────────────────────────────────────────────────
// The resolver imports `loadFramework` from `../framework/context`. We mock it
// per-test via vi.mocked() so each scenario controls what comes back.

vi.mock('../../framework/context', () => ({
  loadFramework: vi.fn(),
}))

const { loadFramework } = await import('../../framework/context')
const { resolveClientICP, ICPSchemaError } = await import('../icp-source')

// ─── Fixture builders ─────────────────────────────────────────────────────

function makePrimarySegment(overrides: Partial<ICPSegment> = {}): ICPSegment {
  return {
    id: 'seg-1',
    name: 'Test segment',
    description: '',
    priority: 'primary',
    targetRoles: ['CRO', 'VP Sales'],
    targetCompanySizes: ['1000+ employees'],
    targetIndustries: ['HRIS', 'Payroll software'],
    targetGeographies: ['North America'],
    keyDecisionMakers: [],
    painPoints: ['Multi-country payroll complexity'],
    buyingTriggers: [],
    disqualifiers: ['Insurance broker', 'IT staffing'],
    voice: {
      tone: 'consultative',
      style: 'direct',
      keyPhrases: [],
      avoidPhrases: [],
      writingRules: [],
      exampleSentences: [],
    },
    messaging: {
      framework: '',
      elevatorPitch: 'short pitch',
      keyMessages: [],
      objectionHandling: [],
    },
    contentStrategy: {
      linkedinPostTypes: [],
      emailCadence: '',
      contentThemes: [],
      redditSubreddits: [],
      keyTopics: [],
    },
    ...overrides,
  }
}

function makeFramework(segments: ICPSegment[]): GTMFramework {
  return {
    company: {
      name: 'Acme',
      website: '',
      linkedinUrl: '',
      industry: '',
      subIndustry: '',
      stage: 'seed',
      description: '',
      teamSize: '',
      foundedYear: 2024,
      headquarters: '',
    },
    positioning: {
      valueProp: '',
      tagline: '',
      category: '',
      differentiators: [],
      proofPoints: [],
      competitors: [],
    },
    segments,
    channels: { active: [], preferences: {} },
    signals: { buyingIntentSignals: [], monitoringKeywords: [], triggerEvents: [] },
    objections: [],
    learnings: [],
    connectedProviders: [],
    onboardingComplete: true,
    lastUpdated: new Date().toISOString(),
    version: 1,
  }
}

// ─── Tmp dir helpers ──────────────────────────────────────────────────────

let tmpYamlDir: string

beforeEach(() => {
  vi.mocked(loadFramework).mockReset()
  tmpYamlDir = mkdtempSync(join(tmpdir(), 'icp-source-test-'))
})

afterEach(() => {
  rmSync(tmpYamlDir, { recursive: true, force: true })
})

function writeYamlFixture(slug: string, content: unknown): string {
  const path = join(tmpYamlDir, `${slug}.yml`)
  writeFileSync(path, yaml.dump(content), 'utf8')
  return path
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('resolveClientICP — tenant framework path', () => {
  it('returns ClientICP from tenant framework when primary segment is usable', async () => {
    vi.mocked(loadFramework).mockResolvedValue(makeFramework([makePrimarySegment()]))

    const icp = await resolveClientICP('acme', { icpYamlDir: tmpYamlDir })

    expect(icp).not.toBeNull()
    expect(icp!.source).toBe('tenant_framework')
    expect(icp!.client_slug).toBe('acme')
    expect(icp!.primary_segment.target_industries).toEqual(['HRIS', 'Payroll software'])
    expect(icp!.primary_segment.disqualifiers).toEqual(['Insurance broker', 'IT staffing'])
    expect(icp!.primary_segment.target_roles).toEqual(['CRO', 'VP Sales'])
    expect(icp!.primary_segment.target_geographies).toEqual(['North America'])
    expect(icp!.primary_segment.voice).toBe('consultative')
    expect(icp!.primary_segment.messaging).toBe('short pitch')
  })

  it('throws ICPSchemaError when framework primary segment is missing required fields', async () => {
    // Has disqualifiers (so it counts as "usable") but missing targetRoles
    vi.mocked(loadFramework).mockResolvedValue(
      makeFramework([makePrimarySegment({ targetRoles: [] })]),
    )

    await expect(resolveClientICP('acme', { icpYamlDir: tmpYamlDir })).rejects.toThrow(
      ICPSchemaError,
    )
    await expect(resolveClientICP('acme', { icpYamlDir: tmpYamlDir })).rejects.toMatchObject({
      slug: 'acme',
      source: 'tenant_framework',
      missingFields: ['target_roles'],
    })
  })

  it('falls through to yaml when framework primary segment has no disqualifiers AND no targetIndustries', async () => {
    // Primary exists but is empty in the v1-relevant fields — fall through.
    vi.mocked(loadFramework).mockResolvedValue(
      makeFramework([
        makePrimarySegment({ disqualifiers: [], targetIndustries: [] }),
      ]),
    )
    writeYamlFixture('acme', {
      client_slug: 'acme',
      primary_segment: {
        name: 'Yaml segment',
        target_roles: ['CMO'],
        target_industries: ['SaaS'],
        disqualifiers: ['Agency'],
      },
    })

    const icp = await resolveClientICP('acme', { icpYamlDir: tmpYamlDir })

    expect(icp).not.toBeNull()
    expect(icp!.source).toBe('repo_yaml')
    expect(icp!.primary_segment.name).toBe('Yaml segment')
  })
})

describe('resolveClientICP — repo yaml fallback', () => {
  it('reads clients/<slug>.yml when loadFramework returns null', async () => {
    vi.mocked(loadFramework).mockResolvedValue(null)
    writeYamlFixture('datascalehr', {
      client_slug: 'datascalehr',
      primary_segment: {
        name: 'HR-tech vendors',
        target_roles: ['CRO', 'VP Sales'],
        target_industries: ['Payroll software', 'HRIS'],
        target_company_sizes: ['1000+ employees'],
        target_geographies: ['North America'],
        disqualifiers: ['Insurance broker', 'IT staffing'],
        pain_points: ['Implementation timeline'],
        voice: 'consultative',
        messaging: 'multi-country payroll',
      },
    })

    const icp = await resolveClientICP('datascalehr', { icpYamlDir: tmpYamlDir })

    expect(icp).not.toBeNull()
    expect(icp!.source).toBe('repo_yaml')
    expect(icp!.client_slug).toBe('datascalehr')
    expect(icp!.primary_segment.target_industries).toEqual(['Payroll software', 'HRIS'])
    expect(icp!.primary_segment.disqualifiers).toContain('Insurance broker')
    expect(icp!.primary_segment.target_company_sizes).toEqual(['1000+ employees'])
    expect(icp!.primary_segment.voice).toBe('consultative')
  })

  it('throws ICPSchemaError when yaml is missing required fields', async () => {
    vi.mocked(loadFramework).mockResolvedValue(null)
    writeYamlFixture('broken', {
      client_slug: 'broken',
      primary_segment: {
        name: 'Missing dq',
        target_roles: ['CRO'],
        target_industries: ['SaaS'],
        // disqualifiers intentionally missing
      },
    })

    await expect(resolveClientICP('broken', { icpYamlDir: tmpYamlDir })).rejects.toThrow(
      ICPSchemaError,
    )
    await expect(
      resolveClientICP('broken', { icpYamlDir: tmpYamlDir }),
    ).rejects.toMatchObject({
      slug: 'broken',
      source: 'repo_yaml',
      missingFields: ['disqualifiers'],
    })
  })

  it('falls back to slug when client_slug is missing in yaml root', async () => {
    vi.mocked(loadFramework).mockResolvedValue(null)
    writeYamlFixture('slugfallback', {
      primary_segment: {
        target_roles: ['CRO'],
        target_industries: ['SaaS'],
        disqualifiers: ['Agency'],
      },
    })

    const icp = await resolveClientICP('slugfallback', { icpYamlDir: tmpYamlDir })
    expect(icp!.client_slug).toBe('slugfallback')
  })
})

describe('resolveClientICP — precedence + null', () => {
  it('tenant framework wins over yaml when both are present and usable', async () => {
    vi.mocked(loadFramework).mockResolvedValue(makeFramework([makePrimarySegment()]))
    writeYamlFixture('acme', {
      client_slug: 'acme',
      primary_segment: {
        name: 'Yaml segment',
        target_roles: ['CMO'],
        target_industries: ['SaaS'],
        disqualifiers: ['Agency'],
      },
    })

    const icp = await resolveClientICP('acme', { icpYamlDir: tmpYamlDir })

    expect(icp).not.toBeNull()
    expect(icp!.source).toBe('tenant_framework')
    expect(icp!.primary_segment.name).toBe('Test segment')
  })

  it('returns null (does not throw) when neither framework nor yaml resolves', async () => {
    vi.mocked(loadFramework).mockResolvedValue(null)

    const icp = await resolveClientICP('unknown-tenant', { icpYamlDir: tmpYamlDir })
    expect(icp).toBeNull()
  })

  it('uses YALC_CLIENT_ICP_DIR env when icpYamlDir option is not passed', async () => {
    vi.mocked(loadFramework).mockResolvedValue(null)
    writeYamlFixture('envclient', {
      client_slug: 'envclient',
      primary_segment: {
        target_roles: ['CRO'],
        target_industries: ['SaaS'],
        disqualifiers: ['Agency'],
      },
    })

    const prev = process.env.YALC_CLIENT_ICP_DIR
    process.env.YALC_CLIENT_ICP_DIR = tmpYamlDir
    try {
      const icp = await resolveClientICP('envclient')
      expect(icp).not.toBeNull()
      expect(icp!.source).toBe('repo_yaml')
    } finally {
      if (prev === undefined) delete process.env.YALC_CLIENT_ICP_DIR
      else process.env.YALC_CLIENT_ICP_DIR = prev
    }
  })
})

describe('resolveClientICP — yaml field coercion', () => {
  it('filters non-string values out of array fields', async () => {
    vi.mocked(loadFramework).mockResolvedValue(null)
    writeYamlFixture('messy', {
      primary_segment: {
        target_roles: ['CRO', null, 42, 'VP Sales'],
        target_industries: [1, 'foo', null, 'bar'],
        disqualifiers: ['Agency'],
        pain_points: ['p1', { nested: true }, 'p2'],
      },
    })

    const icp = await resolveClientICP('messy', { icpYamlDir: tmpYamlDir })

    expect(icp!.primary_segment.target_roles).toEqual(['CRO', 'VP Sales'])
    expect(icp!.primary_segment.target_industries).toEqual(['foo', 'bar'])
    expect(icp!.primary_segment.pain_points).toEqual(['p1', 'p2'])
  })

  it('throws when yaml root is not an object', async () => {
    vi.mocked(loadFramework).mockResolvedValue(null)
    // Write a yaml that parses to a string (scalar root)
    const path = join(tmpYamlDir, 'scalar.yml')
    writeFileSync(path, '"just a string"\n', 'utf8')

    await expect(resolveClientICP('scalar', { icpYamlDir: tmpYamlDir })).rejects.toThrow(
      ICPSchemaError,
    )
  })
})
