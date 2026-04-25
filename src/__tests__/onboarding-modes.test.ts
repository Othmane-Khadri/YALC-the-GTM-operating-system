import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for the onboarding mode picker, the long-form regex fallback parser,
 * and the dryRun branch of deriveFramework.
 *
 * The interactive helpers (askLongform, askContextOnly, askInterview) are
 * not tested end-to-end here — those depend on $EDITOR and live network
 * calls. We cover the deterministic seams: dispatch, parse, and dry-run.
 */

// ─── pickOnboardingMode ───────────────────────────────────────────────────────

describe('pickOnboardingMode', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns qa when nonInteractive=true (no prompt fired)', async () => {
    const selectSpy = vi.fn(async () => 'longform')
    vi.doMock('@inquirer/prompts', () => ({
      input: vi.fn(),
      confirm: vi.fn(),
      select: selectSpy,
      editor: vi.fn(),
      checkbox: vi.fn(),
    }))
    const { pickOnboardingMode } = await import('../lib/context/onboarding')
    const mode = await pickOnboardingMode({ tenantId: 't', nonInteractive: true })
    expect(mode).toBe('qa')
    expect(selectSpy).not.toHaveBeenCalled()
  })

  it('routes to qa when the user picks A', async () => {
    vi.doMock('@inquirer/prompts', () => ({
      input: vi.fn(),
      confirm: vi.fn(),
      select: vi.fn(async () => 'qa'),
      editor: vi.fn(),
      checkbox: vi.fn(),
    }))
    const { pickOnboardingMode } = await import('../lib/context/onboarding')
    expect(await pickOnboardingMode({ tenantId: 't' })).toBe('qa')
  })

  it('routes to longform when the user picks B', async () => {
    vi.doMock('@inquirer/prompts', () => ({
      input: vi.fn(),
      confirm: vi.fn(),
      select: vi.fn(async () => 'longform'),
      editor: vi.fn(),
      checkbox: vi.fn(),
    }))
    const { pickOnboardingMode } = await import('../lib/context/onboarding')
    expect(await pickOnboardingMode({ tenantId: 't' })).toBe('longform')
  })

  it('routes to context-only when the user picks C', async () => {
    vi.doMock('@inquirer/prompts', () => ({
      input: vi.fn(),
      confirm: vi.fn(),
      select: vi.fn(async () => 'context-only'),
      editor: vi.fn(),
      checkbox: vi.fn(),
    }))
    const { pickOnboardingMode } = await import('../lib/context/onboarding')
    expect(await pickOnboardingMode({ tenantId: 't' })).toBe('context-only')
  })
})

// ─── parseLongformMarkdown (regex fallback) ───────────────────────────────────

describe('parseLongformMarkdown', () => {
  it('extracts answers from the canonical template headings', async () => {
    const { parseLongformMarkdown } = await import('../lib/context/onboarding')
    const sample = `# YALC Onboarding — Long-form

## Company name
Acme Corp

## Company website URL
https://acme.io

## One-sentence value proposition (who you sell to + what you solve)
We help RevOps teams automate their pipeline.

## Primary ICP(s) — industries, company sizes, roles
B2B SaaS, 50-500 employees, RevOps leaders.

## Top 3 pain points your buyers are trying to solve
Manual data entry, broken handoffs, missed signals.

## Main competitors (comma separated)
Clay, Apollo, Outreach

## GTM channels you use (LinkedIn, email, Reddit, events, ...)
LinkedIn, cold email

## Voice description — tone, phrases to use, phrases to avoid
Direct, no buzzwords. Avoid "synergy".

## One or two customer wins to reference
Helped Loom cut prospecting time by 40%.

## Auto-disqualifiers (buyers you do NOT want)
Single-founder agencies, sub-$1M ARR.
`
    const parsed = parseLongformMarkdown(sample)
    expect(parsed.companyName).toBe('Acme Corp')
    expect(parsed.companyUrl).toBe('https://acme.io')
    expect(parsed.valueProp).toContain('RevOps teams')
    expect(parsed.icps).toContain('B2B SaaS')
    expect(parsed.painPoints).toContain('Manual data entry')
    expect(parsed.competitors).toContain('Clay')
    expect(parsed.channels).toContain('LinkedIn')
    expect(parsed.voice).toContain('Direct')
    expect(parsed.successStories).toContain('Loom')
    expect(parsed.disqualifiers).toContain('agencies')
  })

  it('strips HTML comment hints from values', async () => {
    const { parseLongformMarkdown } = await import('../lib/context/onboarding')
    const sample = `## Company name
<!-- e.g., Acme Corp -->
Real Company
`
    const parsed = parseLongformMarkdown(sample)
    expect(parsed.companyName).toBe('Real Company')
  })

  it('returns an empty object when no headings match', async () => {
    const { parseLongformMarkdown } = await import('../lib/context/onboarding')
    expect(parseLongformMarkdown('## Random heading\nfoo\n')).toEqual({})
  })

  it('ignores empty headings', async () => {
    const { parseLongformMarkdown } = await import('../lib/context/onboarding')
    const sample = `## Company name
Acme

## Voice description
`
    const parsed = parseLongformMarkdown(sample)
    expect(parsed.companyName).toBe('Acme')
    expect(parsed.voice).toBeUndefined()
  })
})

// ─── deriveFramework({ dryRun: true }) ────────────────────────────────────────

describe('deriveFramework dryRun', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns a framework without calling saveFramework when dryRun=true', async () => {
    const saveSpy = vi.fn(async () => {})
    vi.doMock('../lib/framework/context.js', () => ({
      saveFramework: saveSpy,
      loadFramework: vi.fn(),
      updateFramework: vi.fn(),
      buildFrameworkContext: vi.fn(),
      frameworkPathFor: vi.fn(),
    }))
    vi.doMock('../lib/memory/store.js', () => ({
      MemoryStore: class {
        constructor(public tenantId: string) {}
        async listNodes() {
          return []
        }
      },
    }))
    const { deriveFramework } = await import('../lib/framework/derive')
    const result = await deriveFramework({ tenantId: 'test-dry', dryRun: true })
    expect(saveSpy).not.toHaveBeenCalled()
    expect(result.framework).toBeDefined()
    expect(result.nodesConsidered).toBe(0)
  })

  it('still saves when dryRun is false (legacy path)', async () => {
    const saveSpy = vi.fn(async () => {})
    vi.doMock('../lib/framework/context.js', () => ({
      saveFramework: saveSpy,
      loadFramework: vi.fn(),
      updateFramework: vi.fn(),
      buildFrameworkContext: vi.fn(),
      frameworkPathFor: vi.fn(),
    }))
    vi.doMock('../lib/memory/store.js', () => ({
      MemoryStore: class {
        constructor(public tenantId: string) {}
        async listNodes() {
          return []
        }
      },
    }))
    const { deriveFramework } = await import('../lib/framework/derive')
    await deriveFramework({ tenantId: 'test-save', dryRun: false })
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('accepts a string tenantId for backwards compat', async () => {
    const saveSpy = vi.fn(async () => {})
    vi.doMock('../lib/framework/context.js', () => ({
      saveFramework: saveSpy,
      loadFramework: vi.fn(),
      updateFramework: vi.fn(),
      buildFrameworkContext: vi.fn(),
      frameworkPathFor: vi.fn(),
    }))
    vi.doMock('../lib/memory/store.js', () => ({
      MemoryStore: class {
        constructor(public tenantId: string) {}
        async listNodes() {
          return []
        }
      },
    }))
    const { deriveFramework } = await import('../lib/framework/derive')
    await deriveFramework('test-legacy')
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
})
