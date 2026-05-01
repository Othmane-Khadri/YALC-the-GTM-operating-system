/**
 * A4 — flag-capture invokes the rich profile-builder tool-use schema during
 * the capture step so company_context.yaml lands populated with rich fields
 * (competitors[].weaknesses, segments[].buyingTriggers, segments[].objections,
 * keyDecisionMakers, signals) on the FIRST pass — not only after a separate
 * framework-derive run.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

let TMP: string

const RICH_TOOL_INPUT = {
  company: {
    name: 'Acme Inc',
    website: 'https://acme.com',
    industry: 'B2B SaaS',
    description: 'We build widgets for revenue teams.',
    stage: 'seed',
  },
  positioning: {
    valueProp: 'Fastest path to qualified pipeline',
    category: 'Sales intelligence',
    differentiators: ['real-time signals', 'no-code routing'],
    competitors: [
      {
        name: 'ZoomInfo',
        website: 'https://zoominfo.com',
        positioning: 'Legacy enterprise database',
        weaknesses: ['stale data', 'enterprise-only pricing'],
        battlecardNotes: 'Lead with freshness — show last-touch timestamps',
      },
      {
        name: 'Apollo',
        website: 'https://apollo.io',
        positioning: 'Mid-market all-in-one',
        weaknesses: ['noisy email deliverability', 'thin EU coverage'],
        battlecardNotes: 'Emphasize EU GDPR compliance and inbox reputation',
      },
    ],
  },
  segments: [
    {
      id: 'rev-ops-leads',
      name: 'RevOps leaders at scaling B2B SaaS',
      description: 'RevOps directors at $5M-$50M ARR companies',
      priority: 'primary',
      targetRoles: ['Director of RevOps', 'VP RevOps', 'Head of Revenue Ops'],
      targetCompanySizes: ['51-200', '201-500'],
      targetIndustries: ['B2B SaaS', 'Sales Tech'],
      keyDecisionMakers: ['VP RevOps', 'CRO', 'CFO'],
      painPoints: [
        'manual lead routing burns AE time',
        'data quality varies across tools',
      ],
      buyingTriggers: [
        'new RevOps leader hired',
        'Salesforce migration kickoff',
        'recent Series B round',
      ],
      disqualifiers: ['under 20 employees', 'agency / services business'],
    },
  ],
  signals: {
    buyingIntentSignals: ['VP RevOps job posted', 'Salesforce admin hire'],
    monitoringKeywords: ['lead routing', 'pipeline forecasting'],
    triggerEvents: ['Series B funding round', 'CRO hire'],
  },
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-a4-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
  mkdirSync(join(TMP, '.gtm-os'), { recursive: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.restoreAllMocks()
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.FIRECRAWL_API_KEY
  rmSync(TMP, { recursive: true, force: true })
})

describe('A4 — flag-capture rich profile synthesis', () => {
  it('runFlagCapture populates company_context.yaml with rich competitors[].weaknesses + segments[].buyingTriggers + objections via buildRichCompanyProfile', async () => {
    const longBody = 'Acme builds widgets for B2B revenue teams. '.repeat(40)
    vi.doMock('../lib/services/firecrawl', () => ({
      firecrawlService: {
        scrape: async () => `
          <html>
            <head>
              <meta property="og:site_name" content="Acme Inc" />
              <meta name="description" content="We build widgets for revenue teams." />
              <title>Acme Inc — Widgets</title>
            </head>
            <body>${longBody}</body>
          </html>
        `,
        isAvailable: () => true,
      },
    }))
    vi.doMock('../lib/env/claude-code', () => ({
      isClaudeCode: () => false,
      getWebFetchProvider: () => 'firecrawl',
    }))
    // Mock the Anthropic client used by buildRichCompanyProfile so the
    // tool-use response is deterministic (no real API call).
    vi.doMock('../lib/ai/client', () => ({
      PLANNER_MODEL: 'claude-haiku-4-5',
      QUALIFIER_MODEL: 'claude-haiku-4-5',
      getAnthropicClient: () => ({
        messages: {
          create: async () => ({
            content: [
              {
                type: 'tool_use',
                name: 'build_framework',
                input: RICH_TOOL_INPUT,
              },
            ],
          }),
        },
      }),
    }))

    process.env.FIRECRAWL_API_KEY = 'fake'
    process.env.ANTHROPIC_API_KEY = 'sk-fake'

    const { runFlagCapture, writeCapturedPreview } = await import(
      '../lib/onboarding/flag-capture'
    )
    const { previewPath } = await import('../lib/onboarding/preview')

    const result = await runFlagCapture({
      tenantId: 'default',
      website: 'https://acme.com',
      noCache: true,
    })
    writeCapturedPreview(result, { tenantId: 'default' })

    // Rich data must already be present on the captured context — this is
    // the contract the SPA / framework derivation relies on.
    expect(result.context.icp.competitors_detail).toBeDefined()
    expect(result.context.icp.competitors_detail!.length).toBe(2)
    const zi = result.context.icp.competitors_detail!.find(
      (c) => c.name === 'ZoomInfo',
    )!
    expect(zi.weaknesses).toContain('stale data')
    expect(zi.battlecardNotes).toMatch(/freshness/i)

    expect(result.context.icp.segments_detail).toBeDefined()
    expect(result.context.icp.segments_detail!.length).toBeGreaterThanOrEqual(1)
    const seg = result.context.icp.segments_detail![0]
    expect(seg.buyingTriggers).toContain('new RevOps leader hired')
    expect(seg.keyDecisionMakers).toContain('VP RevOps')
    expect(seg.disqualifiers).toContain('agency / services business')

    expect(result.context.signals).toBeDefined()
    expect(result.context.signals!.triggerEvents).toContain('Series B funding round')

    // The simple/back-compatible fields stay populated too.
    expect(result.context.icp.competitors).toEqual(
      expect.arrayContaining(['ZoomInfo', 'Apollo']),
    )
    expect(result.context.icp.pain_points).toEqual(
      expect.arrayContaining(['manual lead routing burns AE time']),
    )

    // YAML on disk preserves the structure.
    const ctxPath = previewPath('company_context.yaml', { tenantId: 'default' })
    const onDisk = yaml.load(readFileSync(ctxPath, 'utf-8')) as Record<
      string,
      unknown
    >
    expect(onDisk).toBeTruthy()
    const icp = onDisk.icp as Record<string, unknown>
    expect(Array.isArray(icp.competitors_detail)).toBe(true)
    expect(Array.isArray(icp.segments_detail)).toBe(true)
    const sig = onDisk.signals as Record<string, unknown> | undefined
    expect(sig).toBeDefined()
  })

  it('runFlagCapture without ANTHROPIC_API_KEY skips rich enrichment but still writes the thin context', async () => {
    const longBody = 'Acme builds widgets for B2B revenue teams. '.repeat(40)
    vi.doMock('../lib/services/firecrawl', () => ({
      firecrawlService: {
        scrape: async () => longBody,
        isAvailable: () => true,
      },
    }))
    vi.doMock('../lib/env/claude-code', () => ({
      isClaudeCode: () => false,
      getWebFetchProvider: () => 'firecrawl',
    }))

    process.env.FIRECRAWL_API_KEY = 'fake'
    delete process.env.ANTHROPIC_API_KEY

    const { runFlagCapture } = await import('../lib/onboarding/flag-capture')
    const result = await runFlagCapture({
      tenantId: 'default',
      website: 'https://acme.com',
      noCache: true,
    })

    expect(result.context.company.website).toBe('https://acme.com')
    // No rich enrichment without an LLM.
    expect(result.context.icp.competitors_detail ?? []).toEqual([])
    expect(result.context.icp.segments_detail ?? []).toEqual([])
  })

  it('CompanyContext type carries the rich fields from profile-builder schema', async () => {
    const { emptyCompanyContext } = await import(
      '../lib/framework/context-types'
    )
    const ctx = emptyCompanyContext()
    // Type-level: assign rich fields without TS errors.
    ctx.icp.competitors_detail = [
      {
        name: 'X',
        website: '',
        positioning: '',
        weaknesses: ['w'],
        battlecardNotes: 'bn',
      },
    ]
    ctx.icp.segments_detail = [
      {
        id: 's1',
        name: 'S1',
        description: '',
        priority: 'primary',
        targetRoles: [],
        targetCompanySizes: [],
        targetIndustries: [],
        keyDecisionMakers: ['VP'],
        painPoints: [],
        buyingTriggers: ['t'],
        disqualifiers: [],
      },
    ]
    ctx.signals = {
      buyingIntentSignals: [],
      monitoringKeywords: [],
      triggerEvents: [],
    }
    expect(ctx.icp.competitors_detail[0].weaknesses).toEqual(['w'])
    expect(ctx.icp.segments_detail[0].buyingTriggers).toEqual(['t'])
    expect(ctx.signals.triggerEvents).toEqual([])
  })

  it('writeSynthesizedPreview does not clobber rich pre-populated competitors when synthesis emits a thin list', async () => {
    // When flag-capture has already populated rich competitors_detail, a
    // subsequent synthesis run that only emits short string competitors
    // should NOT erase the rich array. The thin `icp.competitors` array can
    // be refreshed from synthesis, but the rich detail must persist.
    process.env.ANTHROPIC_API_KEY = 'sk-fake'

    vi.doMock('../lib/framework/section-prompts/index', async (orig) => {
      const real = (await orig()) as Record<string, unknown>
      return {
        ...real,
        runSectionPrompt: async () => 'segments: []\n__yalc_confidence: 5\n',
      }
    })

    const { writeSynthesizedPreview } = await import(
      '../lib/onboarding/synthesis'
    )
    const { emptyCompanyContext } = await import(
      '../lib/framework/context-types'
    )
    const ctx = emptyCompanyContext()
    ctx.company.name = 'Acme'
    ctx.icp.competitors_detail = [
      {
        name: 'ZoomInfo',
        website: 'https://zoominfo.com',
        positioning: 'Legacy database',
        weaknesses: ['stale data'],
        battlecardNotes: 'lead with freshness',
      },
    ]
    await writeSynthesizedPreview({
      context: ctx,
      tenant: { tenantId: 'default' },
      only: ['icp'],
    })

    expect(ctx.icp.competitors_detail).toBeDefined()
    expect(ctx.icp.competitors_detail!.length).toBe(1)
    expect(ctx.icp.competitors_detail![0].weaknesses).toEqual(['stale data'])
  })
})
