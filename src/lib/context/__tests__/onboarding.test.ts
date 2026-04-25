import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runOnboarding } from '../onboarding'

const ENV_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
  'WEB_FETCH_PROVIDER',
  'FIRECRAWL_API_KEY',
] as const

describe('runOnboarding website ingestion handoff', () => {
  const saved: Record<string, string | undefined> = {}
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('emits a Claude Code handoff line per target URL when CC is detected and no Firecrawl key', async () => {
    process.env.CLAUDECODE = '1'

    const tenantId = `test-cc-${Date.now()}`
    const report = await runOnboarding({
      tenantId,
      scrapeWebsite: true,
      nonInteractive: true,
      answers: {
        companyName: 'Acme',
        companyUrl: 'https://acme.example.com',
        valueProp: 'v',
        icps: 'i',
        painPoints: 'p',
        competitors: 'c',
        channels: 'ch',
        voice: 'vo',
        successStories: 's',
        disqualifiers: 'd',
      },
    })

    expect(report.websiteChunks).toBe(0)

    const allLogs = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(allLogs).toContain('[onboard] Claude Code WebFetch handoff')
    expect(allLogs).toContain('https://acme.example.com')
    expect(allLogs).toContain('/about')
    expect(allLogs).toContain('/pricing')
    expect(allLogs).toContain('/customers')
  })

  it('logs a skip notice when no fetch backend is available', async () => {
    // No CC env, no Firecrawl key.
    const tenantId = `test-none-${Date.now()}`
    const report = await runOnboarding({
      tenantId,
      scrapeWebsite: true,
      nonInteractive: true,
      answers: {
        companyName: 'Acme',
        companyUrl: 'https://acme.example.com',
        valueProp: 'v',
        icps: 'i',
        painPoints: 'p',
        competitors: 'c',
        channels: 'ch',
        voice: 'vo',
        successStories: 's',
        disqualifiers: 'd',
      },
    })

    expect(report.websiteChunks).toBe(0)
    const allWarns = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(allWarns).toContain('No web fetch capability available')
  })
})
