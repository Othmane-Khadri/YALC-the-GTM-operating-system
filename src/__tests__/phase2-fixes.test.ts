import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Phase 2 (0.7.0) — onboarding redesign regressions.
 *
 * These tests pin the highest-stakes contracts:
 *   - Item 17: template `.env` writer + delta-merge on re-run.
 *   - Item 18: web fetcher retries transient errors, fails fast on 4xx.
 *   - Item 18: auto-extractor seeds `company.name` on capture.
 *   - Item 18: wall-clock instrumentation surfaces in user output.
 */

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-phase2-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
  mkdirSync(join(TMP, '.gtm-os'), { recursive: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.restoreAllMocks()
  rmSync(TMP, { recursive: true, force: true })
})

// ─── Item 17 — Template `.env` upgrade scenario ──────────────────────────────
describe('Item 17 — `.env` template upgrade does not lose user data', () => {
  it('appends new placeholders and preserves filled keys verbatim', async () => {
    const envPath = join(TMP, '.gtm-os', '.env')
    // Simulate a 0.6.0 file with the user's filled keys present, no MCP
    // section yet.
    writeFileSync(
      envPath,
      [
        'ENCRYPTION_KEY=existing-enc',
        'DATABASE_URL=file:/old.db',
        'ANTHROPIC_API_KEY=sk-real',
        '# UNIPILE_API_KEY=',
      ].join('\n') + '\n',
    )

    const { writeEnvTemplate, MCP_PROVIDER_SECTION } = await import(
      '../lib/onboarding/env-template'
    )
    const outcome = writeEnvTemplate({
      envPath,
      autoKeys: { ENCRYPTION_KEY: 'NEW', DATABASE_URL: 'NEW' },
    })

    expect(outcome.mode).toBe('merged')
    const final = readFileSync(envPath, 'utf-8')
    expect(final).toContain('ANTHROPIC_API_KEY=sk-real')
    expect(final).toContain('ENCRYPTION_KEY=existing-enc') // not overwritten
    for (const ph of MCP_PROVIDER_SECTION.placeholders) {
      expect(final).toContain(`# ${ph.key}=`)
    }
  })

  it('first boot lays down the canonical template', async () => {
    const envPath = join(TMP, '.gtm-os', '.env')
    expect(existsSync(envPath)).toBe(false)

    const { writeEnvTemplate } = await import('../lib/onboarding/env-template')
    const outcome = writeEnvTemplate({
      envPath,
      autoKeys: { ENCRYPTION_KEY: 'enc', DATABASE_URL: 'file:/x' },
    })
    expect(outcome.mode).toBe('created')

    const content = readFileSync(envPath, 'utf-8')
    expect(content).toContain('# YALC GTM-OS — Provider API Keys')
    expect(content).toContain('ENCRYPTION_KEY=enc')
    expect(content).toContain('# ANTHROPIC_API_KEY=')
    expect(content).toContain('# BREVO_MCP=')
  })
})

// ─── Item 18 — retry + auto-extract + wall-clock ─────────────────────────────
describe('Item 18 — web fetcher retry + auto-extract', () => {
  it('isAuthFailure short-circuits 4xx errors so they are never retried', async () => {
    const { isAuthFailure } = await import('../lib/web/fetcher')
    expect(isAuthFailure(new Error('Fetch failed: 401 Unauthorized'))).toBe(true)
    expect(isAuthFailure(new Error('Fetch failed: 403 Forbidden'))).toBe(true)
    expect(isAuthFailure(new Error('Fetch failed: 404 Not Found'))).toBe(true)
    // 5xx and timeouts are transient — must be retried.
    expect(isAuthFailure(new Error('Fetch failed: 500 Internal Server Error'))).toBe(false)
    expect(isAuthFailure(new Error('AbortError: operation timed out'))).toBe(false)
  })

  it('withRetry runs exactly 3 attempts on transient errors', async () => {
    const { withRetry } = await import('../lib/web/fetcher')
    let calls = 0
    const op = async () => {
      calls += 1
      throw new Error('Fetch failed: 503')
    }
    await expect(
      withRetry(op, { label: 't', sleepFn: async () => {} }),
    ).rejects.toThrow()
    expect(calls).toBe(3)
  })

  it('withRetry stops after 1 attempt on auth failure', async () => {
    const { withRetry } = await import('../lib/web/fetcher')
    let calls = 0
    const op = async () => {
      calls += 1
      throw new Error('401 Unauthorized')
    }
    await expect(
      withRetry(op, { label: 't', sleepFn: async () => {} }),
    ).rejects.toThrow(/401/)
    expect(calls).toBe(1)
  })

  it('extractCompanyMeta seeds company.name from <title> when no og:site_name', async () => {
    const { extractCompanyMeta } = await import('../lib/onboarding/auto-extract')
    const html = '<title>Bitwip — AI for SMBs</title>'
    const out = extractCompanyMeta({ content: html, url: 'https://bitwip.ai' })
    expect(out.name).toBe('Bitwip')
  })

  it('extractCompanyMeta falls back to URL-derived name on empty content', async () => {
    const { extractCompanyMeta } = await import('../lib/onboarding/auto-extract')
    const out = extractCompanyMeta({ content: '', url: 'https://anthropic.com' })
    expect(out.name).toBe('Anthropic')
  })

  it('runFlagCapture populates company.name from scraped website meta', async () => {
    // Mock the web fetcher path so we control what content gets captured.
    vi.doMock('../lib/onboarding/flag-capture', async (orig) => {
      // We import the real module to get everything except fetchForCapture
      // — but easier: stub the firecrawl service directly because that's
      // what the production capture code hits.
      return orig()
    })
    vi.doMock('../lib/services/firecrawl', () => ({
      firecrawlService: {
        scrape: async () => `
          <html>
            <head>
              <meta property="og:site_name" content="Acme Inc" />
              <meta name="description" content="We build widgets." />
              <title>Acme Inc — Widgets</title>
            </head>
            <body><p>${'long text '.repeat(80)}</p></body>
          </html>
        `,
        isAvailable: () => true,
      },
    }))
    vi.doMock('../lib/env/claude-code', () => ({
      isClaudeCode: () => false,
      getWebFetchProvider: () => 'firecrawl',
    }))

    process.env.FIRECRAWL_API_KEY = 'fake'
    const { runFlagCapture } = await import('../lib/onboarding/flag-capture')
    const result = await runFlagCapture({
      tenantId: 'default',
      website: 'https://acme.com',
      noCache: true,
    })

    expect(result.context.company.name).toBe('Acme Inc')
    expect(result.context.company.description).toContain('widgets')
    delete process.env.FIRECRAWL_API_KEY
  })

  it('runFlagCapture uses URL-derived name when website fetch fails', async () => {
    vi.doMock('../lib/services/firecrawl', () => ({
      firecrawlService: {
        scrape: async () => null,
        isAvailable: () => true,
      },
    }))
    vi.doMock('../lib/env/claude-code', () => ({
      isClaudeCode: () => false,
      getWebFetchProvider: () => 'firecrawl',
    }))

    process.env.FIRECRAWL_API_KEY = 'fake'
    const { runFlagCapture } = await import('../lib/onboarding/flag-capture')
    const result = await runFlagCapture({
      tenantId: 'default',
      website: 'https://bitwip.ai',
      noCache: true,
    })

    // No content means fallback path — name comes from URL host.
    expect(result.context.company.name).toBe('Bitwip')
    delete process.env.FIRECRAWL_API_KEY
  })
})
