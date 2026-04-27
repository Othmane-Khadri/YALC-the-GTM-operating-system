import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

/**
 * Phase 1 (0.7.0) — targeted regression tests.
 *
 * Each block here covers one of the highest-stakes fixes called out in the
 * scope doc. The end-to-end flow is exercised by the verifier; these tests
 * lock in the discrete contracts so future edits cannot silently regress.
 */

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-phase1-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
  mkdirSync(join(TMP, '.gtm-os'), { recursive: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

// ─── Fix #1: Preview leak — Step 4 outputs land in _preview/ ────────────────
describe('Fix #1 — Step 4 writes through previewPath()', () => {
  it('configureSkills routes the four files to _preview/ and never to live root', async () => {
    // No Anthropic key → bodyForSection still tries the LLM path; we stub the
    // anthropic client so the call is a no-op deterministic stub.
    process.env.ANTHROPIC_API_KEY = 'sk-fake'

    vi.doMock('../lib/ai/client', () => ({
      PLANNER_MODEL: 'claude-haiku-4-5',
      getAnthropicClient: () => ({
        messages: {
          create: async () => ({
            content: [{ type: 'text', text: '(?i)(cto|ceo)\n(?i)(engineering)' }],
          }),
        },
      }),
    }))

    vi.doMock('../lib/framework/context', () => ({
      updateFramework: async () => ({}),
      loadFramework: async () => ({}),
    }))

    const { configureSkills } = await import('../lib/onboarding/skill-configurator')
    const { previewPath, livePath } = await import('../lib/onboarding/preview')

    const fakeFramework = {
      company: { name: 'Acme', industry: 'SaaS', stage: 'seed' },
      positioning: { valueProp: 'fast onboarding', competitors: [] },
      segments: [
        { name: 'CTOs', targetRoles: ['CTO'], targetIndustries: ['saas'], disqualifiers: [], voice: {} },
      ],
      signals: { monitoringKeywords: ['onboarding'], buyingIntentSignals: ['new hire'] },
      channels: { active: ['linkedin'] },
    } as unknown as Parameters<typeof configureSkills>[0]
    const fakeGoals = {
      primaryGoal: 'g',
      channels: ['linkedin'],
      targetVolume: 50,
      campaignStyle: 'volume' as const,
    }

    await configureSkills(fakeFramework, fakeGoals, { tenant: { tenantId: 'default' } })

    // The three files MUST land in preview, not live.
    expect(existsSync(previewPath('qualification_rules.md'))).toBe(true)
    expect(existsSync(previewPath('campaign_templates.yaml'))).toBe(true)
    expect(existsSync(previewPath('config.yaml'))).toBe(true)
    // Live root must NOT have them yet (Step 1 only wrote a default config).
    expect(existsSync(livePath('qualification_rules.md'))).toBe(false)
    expect(existsSync(livePath('campaign_templates.yaml'))).toBe(false)
  })
})

// ─── Fix #1 + #4: config.yaml goals stay null + TODO ────────────────────────
describe('Fix #4 — goals block written as null + TODO', () => {
  it('emits explicit null fields with TODO comments and never bakes Claude defaults', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-fake'

    vi.doMock('../lib/ai/client', () => ({
      PLANNER_MODEL: 'claude-haiku-4-5',
      getAnthropicClient: () => ({
        messages: {
          create: async () => ({ content: [{ type: 'text', text: 'rule line\n' }] }),
        },
      }),
    }))
    vi.doMock('../lib/framework/context', () => ({
      updateFramework: async () => ({}),
      loadFramework: async () => ({}),
    }))

    const { configureSkills } = await import('../lib/onboarding/skill-configurator')
    const { previewPath } = await import('../lib/onboarding/preview')

    await configureSkills(
      {
        company: { name: 'Acme', industry: 'SaaS', stage: 'seed' },
        positioning: { valueProp: 'x', competitors: [] },
        segments: [{ name: 'X', targetRoles: [], targetIndustries: [], disqualifiers: [], voice: {} }],
        signals: { monitoringKeywords: [], buyingIntentSignals: [] },
        channels: { active: [] },
      } as unknown as Parameters<typeof configureSkills>[0],
      { primaryGoal: 'recommended', channels: ['linkedin'], targetVolume: 50, campaignStyle: 'volume' },
      { tenant: { tenantId: 'default' } },
    )

    const written = readFileSync(previewPath('config.yaml'), 'utf-8')
    expect(written).toContain('# TODO')
    expect(written).toMatch(/primary:\s*null/)
    expect(written).toMatch(/campaign_style:\s*null/)
    // The Claude recommendation lives only in a comment, not in the YAML body.
    expect(written).toContain('# Recommended')
    expect(written).toContain('"recommended"')
  })
})

// ─── Fix #3: Synthesis input validation ─────────────────────────────────────
describe('Fix #3 — synthesis input validation', () => {
  it('returns ok when website fetch ≥ 500 chars', async () => {
    const { validateCaptureForSynthesis } = await import('../lib/onboarding/flag-capture')
    const big = 'a'.repeat(600)
    const r = validateCaptureForSynthesis({ websiteContent: big })
    expect(r.ok).toBe(true)
    expect(r.websiteChars).toBe(600)
  })

  it('returns ok when linkedin fetch ≥ 200 chars', async () => {
    const { validateCaptureForSynthesis } = await import('../lib/onboarding/flag-capture')
    const r = validateCaptureForSynthesis({ linkedinContent: 'a'.repeat(220) })
    expect(r.ok).toBe(true)
  })

  it('returns ok when docs has ≥ 1 file with ≥ 200 chars', async () => {
    const { validateCaptureForSynthesis } = await import('../lib/onboarding/flag-capture')
    const r = validateCaptureForSynthesis({
      docsContent: 'a'.repeat(220),
      docsFiles: ['/tmp/doc.md'],
    })
    expect(r.ok).toBe(true)
    expect(r.docsFilesOver200).toBeGreaterThanOrEqual(1)
  })

  it('refuses when all signals are below the bar', async () => {
    const { validateCaptureForSynthesis } = await import('../lib/onboarding/flag-capture')
    const r = validateCaptureForSynthesis({
      websiteContent: 'short',
      linkedinContent: '',
      docsContent: '',
      docsFiles: [],
    })
    expect(r.ok).toBe(false)
    expect(r.websiteChars).toBe(5)
  })
})

// ─── Fix #15: Channel opt-out propagates ────────────────────────────────────
describe('Fix #15 — channel opt-out helpers', () => {
  it('isChannelOptedOut returns false when config is missing', async () => {
    const { isChannelOptedOut } = await import('../lib/config/loader')
    expect(isChannelOptedOut('email')).toBe(false)
    expect(isChannelOptedOut('linkedin')).toBe(false)
  })

  it('isChannelOptedOut returns true for "none" sentinel', async () => {
    writeFileSync(
      join(TMP, '.gtm-os', 'config.yaml'),
      yaml.dump({ email: { provider: 'none' }, linkedin: { provider: 'unipile' } }),
    )
    const { isChannelOptedOut } = await import('../lib/config/loader')
    expect(isChannelOptedOut('email')).toBe(true)
    expect(isChannelOptedOut('linkedin')).toBe(false)
  })

  it('isChannelOptedOut returns true for empty/disabled sentinel', async () => {
    writeFileSync(
      join(TMP, '.gtm-os', 'config.yaml'),
      yaml.dump({ email: { provider: 'disabled' }, linkedin: { provider: '' } }),
    )
    const { isChannelOptedOut } = await import('../lib/config/loader')
    expect(isChannelOptedOut('email')).toBe(true)
    expect(isChannelOptedOut('linkedin')).toBe(true)
  })

  it('channelOptedOutMessage points users at the correct config slot', async () => {
    const { channelOptedOutMessage } = await import('../lib/config/loader')
    expect(channelOptedOutMessage('email')).toContain('email.provider')
    expect(channelOptedOutMessage('email')).toContain('instantly')
    expect(channelOptedOutMessage('linkedin')).toContain('linkedin.provider')
    expect(channelOptedOutMessage('linkedin')).toContain('unipile')
  })
})

// ─── Fix #10: selfHealthCheck contract ──────────────────────────────────────
describe('Fix #10 — providers expose selfHealthCheck', () => {
  it('Crustdata provider returns warn when key missing', async () => {
    delete process.env.CRUSTDATA_API_KEY
    const { CrustdataProvider } = await import('../lib/providers/builtin/crustdata-provider')
    const p = new CrustdataProvider()
    const r = await p.selfHealthCheck()
    expect(r.status).toBe('warn')
    expect(r.detail).toMatch(/CRUSTDATA_API_KEY/)
  })

  it('Notion provider returns warn when key missing', async () => {
    delete process.env.NOTION_API_KEY
    const { NotionProvider } = await import('../lib/providers/builtin/notion-provider')
    const p = new NotionProvider()
    const r = await p.selfHealthCheck()
    expect(r.status).toBe('warn')
    expect(r.detail).toMatch(/NOTION_API_KEY/)
  })

  it('Firecrawl provider returns warn when key missing', async () => {
    delete process.env.FIRECRAWL_API_KEY
    const { FirecrawlProvider } = await import('../lib/providers/builtin/firecrawl-provider')
    const p = new FirecrawlProvider()
    const r = await p.selfHealthCheck()
    expect(r.status).toBe('warn')
    expect(r.detail).toMatch(/FIRECRAWL_API_KEY/)
  })

  it('Unipile provider returns warn when env vars missing', async () => {
    delete process.env.UNIPILE_API_KEY
    delete process.env.UNIPILE_DSN
    const { UnipileProvider } = await import('../lib/providers/builtin/unipile-provider')
    const p = new UnipileProvider()
    const r = await p.selfHealthCheck()
    expect(r.status).toBe('warn')
    expect(r.detail).toMatch(/UNIPILE/)
  })
})

// ─── Fix #2: Bare scaffold-only short-circuit ───────────────────────────────
describe('Fix #2 — bare scaffold-only behaviour', () => {
  // We can't easily run the full runStart without DB plumbing, so we assert
  // the shape directly: when no capture flags are present, captureFlagsSet is
  // false, and the bare scaffold branch should fire BEFORE applyMigrations or
  // any of the LLM steps. The unit test asserts the helper that decides this.
  it('hasCaptureFlags returns false when nothing was passed', async () => {
    const { hasCaptureFlags } = await import('../lib/onboarding/flag-capture')
    expect(hasCaptureFlags({ tenantId: 'default' })).toBe(false)
  })

  it('hasCaptureFlags returns true when any capture flag is set', async () => {
    const { hasCaptureFlags } = await import('../lib/onboarding/flag-capture')
    expect(hasCaptureFlags({ tenantId: 'default', website: 'https://acme.test' })).toBe(true)
    expect(hasCaptureFlags({ tenantId: 'default', icpSummary: 'CTOs' })).toBe(true)
  })
})

// ─── Fix #9: classifyMcpError package extraction ────────────────────────────
describe('Fix #9 — extractNpmPackageFromError', () => {
  it('decodes %2f-encoded scope from the registry URL form', async () => {
    const { extractNpmPackageFromError } = await import('../lib/providers/mcp-adapter')
    const result = extractNpmPackageFromError(
      'npm error 404 Not Found - GET https://registry.npmjs.org/@no-such-org-xyz123%2fno-such-mcp - Not found',
    )
    expect(result).toBe('@no-such-org-xyz123/no-such-mcp')
  })

  it('handles colon-prefixed versioned spec', async () => {
    const { extractNpmPackageFromError } = await import('../lib/providers/mcp-adapter')
    const result = extractNpmPackageFromError('404 Not Found: @scope/pkg@1.2.3')
    expect(result).toBe('@scope/pkg@1.2.3')
  })

  it('returns empty when no package signal present', async () => {
    const { extractNpmPackageFromError } = await import('../lib/providers/mcp-adapter')
    expect(extractNpmPackageFromError('connection refused')).toBe('')
  })
})

// ─── Fix #13: Tool routing fails loudly ─────────────────────────────────────
describe('Fix #13 — MCP routing throws when no tool: is set', () => {
  // We can't spin up a real MCP server here, so we exercise the resolver
  // via a manual harness: construct an adapter, hand it a fake tools list,
  // then call the private resolver indirectly through execute() to verify the
  // throw shape.
  it('classifies missing tool errors with the help text', async () => {
    const { McpProviderAdapter } = await import('../lib/providers/mcp-adapter')
    const cfg = {
      name: 'fake',
      displayName: 'Fake',
      transport: 'stdio' as const,
      command: 'true',
      args: [],
      capabilities: ['search' as const],
    }
    const adapter = new McpProviderAdapter(cfg)
    // Inject a fake tool list onto the private state so resolveToolName has
    // something to compare against; calling execute without `tool:` should
    // produce the new error.
    ;(adapter as unknown as { tools: Array<{ name: string }>; available: boolean; client: unknown }).tools = [
      { name: 'search_companies' },
      { name: 'enrich_person' },
    ]
    ;(adapter as unknown as { available: boolean }).available = true
    ;(adapter as unknown as { client: unknown }).client = {
      callTool: () => Promise.resolve({ content: [] }),
    }
    const step = {
      stepIndex: 0,
      title: 'find people',
      stepType: 'search',
      provider: 'mcp:fake',
      description: '',
      config: {},
    }
    let caught: Error | null = null
    try {
      const it = adapter.execute(step as never, {
        frameworkContext: '',
        batchSize: 10,
        totalRequested: 10,
      })
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _b of it) {
        // drain
      }
    } catch (err) {
      caught = err as Error
    }
    expect(caught).toBeTruthy()
    expect(caught!.message).toMatch(/No tool specified for MCP provider 'fake'/)
    expect(caught!.message).toMatch(/search_companies/)
    expect(caught!.message).toMatch(/enrich_person/)
  })
})
