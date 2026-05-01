/**
 * Tests for `yalc-gtm start` (no flags) — SPA-as-default routing (A1).
 *
 * Today: `start` (no flags) falls through to a 4-step terminal interview.
 * After A1: `start` (no flags) prompts ONLY for the company website URL,
 * then delegates to the same flag-capture path that
 * `start --non-interactive --website <url>` already uses, which auto-opens
 * the SPA at /setup/review.
 *
 * `start --review-in-chat` still triggers the legacy CLI walk (regression
 * guard).
 */

import { describe, it, expect, vi } from 'vitest'

describe('start (SPA default) — no-flag routing', () => {
  it('prompts for website URL and delegates to runStart with nonInteractive + website', async () => {
    const promptUrl = vi.fn(async () => 'https://acme.com')
    const runStart = vi.fn(async (_opts: any) => {})

    const { runStartSpaDefault } = await import('../cli/commands/start-spa-default')
    const result = await runStartSpaDefault({
      tenantId: 'default',
      promptUrl,
      runStart,
    })

    expect(promptUrl).toHaveBeenCalledTimes(1)
    expect(runStart).toHaveBeenCalledTimes(1)
    const callArgs = runStart.mock.calls[0]?.[0]
    expect(callArgs).toMatchObject({
      tenantId: 'default',
      nonInteractive: true,
      website: 'https://acme.com',
    })
    expect(result.exitCode).toBe(0)
    expect(result.website).toBe('https://acme.com')
  })

  it('passes through serverUrl/openHook/noOpen/noOpenEnv to runStart', async () => {
    const promptUrl = vi.fn(async () => 'https://acme.com')
    const runStart = vi.fn(async (_opts: any) => {})
    const openHook = vi.fn(() => ({ attempted: true, launched: true }))

    const { runStartSpaDefault } = await import('../cli/commands/start-spa-default')
    await runStartSpaDefault({
      tenantId: 'default',
      promptUrl,
      runStart,
      serverUrl: 'http://localhost:9999',
      openHook,
      noOpen: true,
      noOpenEnv: true,
    })

    const callArgs = runStart.mock.calls[0]?.[0]
    expect(callArgs.serverUrl).toBe('http://localhost:9999')
    expect(callArgs.openHook).toBe(openHook)
    expect(callArgs.noOpen).toBe(true)
    expect(callArgs.noOpenEnv).toBe(true)
  })

  it('re-prompts when the user supplies an invalid URL, then accepts a valid one', async () => {
    const responses = ['not-a-url', '   ', 'https://acme.com']
    let i = 0
    const promptUrl = vi.fn(async (): Promise<string> => {
      // Simulates re-prompting: caller validates and re-asks until URL parses.
      // In practice the helper drives the prompt loop; this fake just hands
      // back successive values so the helper can observe failures.
      const next = responses[i] ?? ''
      i += 1
      return next
    })
    const runStart = vi.fn(async (_opts: any) => {})

    const { runStartSpaDefault } = await import('../cli/commands/start-spa-default')
    const result = await runStartSpaDefault({
      tenantId: 'default',
      promptUrl,
      runStart,
      maxAttempts: 5,
    })

    // Helper kept asking until it got a valid URL.
    expect(promptUrl).toHaveBeenCalledTimes(3)
    expect(runStart).toHaveBeenCalledTimes(1)
    const callArgs = runStart.mock.calls[0]?.[0]
    expect(callArgs.website).toBe('https://acme.com')
    expect(result.website).toBe('https://acme.com')
  })

  it('aborts cleanly when the user never supplies a valid URL within maxAttempts', async () => {
    const promptUrl = vi.fn(async () => 'never-valid')
    const runStart = vi.fn(async () => {})

    const { runStartSpaDefault } = await import('../cli/commands/start-spa-default')
    const result = await runStartSpaDefault({
      tenantId: 'default',
      promptUrl,
      runStart,
      maxAttempts: 3,
    })

    expect(promptUrl).toHaveBeenCalledTimes(3)
    expect(runStart).not.toHaveBeenCalled()
    expect(result.exitCode).toBe(1)
    expect(result.website).toBeNull()
  })
})

describe('start — routing predicate', () => {
  it('shouldUseSpaDefault returns true when no flags are set', async () => {
    const { shouldUseSpaDefault } = await import('../cli/commands/start-spa-default')
    expect(shouldUseSpaDefault({})).toBe(true)
  })

  it('shouldUseSpaDefault returns false when --review-in-chat is set (legacy guard)', async () => {
    const { shouldUseSpaDefault } = await import('../cli/commands/start-spa-default')
    expect(shouldUseSpaDefault({ reviewInChat: true })).toBe(false)
  })

  it('shouldUseSpaDefault returns false when --non-interactive is set', async () => {
    const { shouldUseSpaDefault } = await import('../cli/commands/start-spa-default')
    expect(shouldUseSpaDefault({ nonInteractive: true })).toBe(false)
  })

  it('shouldUseSpaDefault returns false when any capture flag is set', async () => {
    const { shouldUseSpaDefault } = await import('../cli/commands/start-spa-default')
    expect(shouldUseSpaDefault({ website: 'https://x.com' })).toBe(false)
    expect(shouldUseSpaDefault({ companyName: 'ACME' })).toBe(false)
    expect(shouldUseSpaDefault({ linkedin: 'https://linkedin.com/in/x' })).toBe(false)
    expect(shouldUseSpaDefault({ docs: ['./brand.md'] })).toBe(false)
    expect(shouldUseSpaDefault({ icpSummary: 'engineers' })).toBe(false)
    expect(shouldUseSpaDefault({ voice: './voice.txt' })).toBe(false)
  })

  it('shouldUseSpaDefault returns false for preview-lifecycle flags', async () => {
    const { shouldUseSpaDefault } = await import('../cli/commands/start-spa-default')
    expect(shouldUseSpaDefault({ commitPreview: true })).toBe(false)
    expect(shouldUseSpaDefault({ discardPreview: true })).toBe(false)
    expect(shouldUseSpaDefault({ regenerateSection: 'icp' })).toBe(false)
    expect(shouldUseSpaDefault({ regenerateLowConfidence: true })).toBe(false)
  })
})
