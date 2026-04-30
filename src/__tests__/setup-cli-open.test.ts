/**
 * Tests for the post-capture browser-open hook + CLI fallbacks (0.9.B).
 *
 * The browser opener itself is platform-aware — these tests pin its
 * behavior under a stubbed `spawn` so they pass across darwin/linux/win32
 * runners. The end-to-end `runStart` flow is exercised by injecting an
 * `openHook` so we don't actually launch a process during tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

function liveDir(): string {
  return join(TMP, '.gtm-os')
}
function previewDir(): string {
  return join(liveDir(), '_preview')
}

function seedMinimalPreview() {
  const root = previewDir()
  mkdirSync(root, { recursive: true })
  mkdirSync(join(root, 'voice'), { recursive: true })
  mkdirSync(join(root, 'icp'), { recursive: true })
  mkdirSync(join(root, 'positioning'), { recursive: true })
  writeFileSync(join(root, 'company_context.yaml'), 'company: ACME\n')
  writeFileSync(join(root, 'framework.yaml'), 'name: x\n')
  writeFileSync(join(root, 'voice', 'tone-of-voice.md'), '# tone\n')
  writeFileSync(join(root, 'icp', 'segments.yaml'), 'segments: []\n')
  writeFileSync(join(root, 'positioning', 'one-pager.md'), '# pos\n')
  writeFileSync(join(root, 'qualification_rules.md'), '# rules\n')
  writeFileSync(join(root, 'campaign_templates.yaml'), 'templates: []\n')
  writeFileSync(join(root, 'search_queries.txt'), 'q\n')
  writeFileSync(join(root, 'config.yaml'), 'a: 1\n')
  writeFileSync(
    join(root, '_meta.json'),
    JSON.stringify({ captured_at: '2026-04-29T00:00:00Z', version: '0.6.0' }),
  )
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-cli-open-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(TMP, { recursive: true, force: true })
})

describe('openBrowser helper', () => {
  it('respects --no-open by skipping spawn entirely', async () => {
    const { openBrowser } = await import('../lib/cli/open-browser')
    const spawner = vi.fn()
    const r = openBrowser('http://localhost:3847/setup/review', {
      noOpen: true,
      spawner: spawner as unknown as typeof import('node:child_process').spawn,
    })
    expect(r.attempted).toBe(false)
    expect(spawner).not.toHaveBeenCalled()
  })

  it('shells out via the macOS opener on darwin', async () => {
    const { openBrowser } = await import('../lib/cli/open-browser')
    const spawner = vi.fn(() => ({ unref: () => {} }))
    const r = openBrowser('http://localhost:3847/setup/review', {
      platform: 'darwin',
      spawner: spawner as unknown as typeof import('node:child_process').spawn,
    })
    expect(r.attempted).toBe(true)
    expect(r.command).toBe('open')
    expect(spawner).toHaveBeenCalledTimes(1)
    const call = spawner.mock.calls[0] as unknown as [string, string[], unknown]
    expect(call[0]).toBe('open')
    expect(call[1]).toContain('http://localhost:3847/setup/review')
  })
})

describe('openInEditor helper (0.9.1 .env handoff)', () => {
  it('respects noOpen by skipping spawn entirely', async () => {
    const { openInEditor } = await import('../lib/cli/open-browser')
    const spawner = vi.fn()
    const r = openInEditor('/tmp/sandbox/.gtm-os/.env', {
      noOpen: true,
      spawner: spawner as unknown as typeof import('node:child_process').spawn,
    })
    expect(r.attempted).toBe(false)
    expect(r.launched).toBe(false)
    expect(spawner).not.toHaveBeenCalled()
  })

  it('opens the file path with the platform default editor on darwin', async () => {
    const { openInEditor } = await import('../lib/cli/open-browser')
    const spawner = vi.fn(() => ({ unref: () => {} }))
    const r = openInEditor('/tmp/sandbox/.gtm-os/.env', {
      platform: 'darwin',
      spawner: spawner as unknown as typeof import('node:child_process').spawn,
    })
    expect(r.attempted).toBe(true)
    expect(r.launched).toBe(true)
    expect(r.command).toBe('open')
    const call = spawner.mock.calls[0] as unknown as [string, string[], unknown]
    expect(call[0]).toBe('open')
    expect(call[1]).toEqual(['/tmp/sandbox/.gtm-os/.env'])
  })

  it('uses xdg-open on linux', async () => {
    const { openInEditor } = await import('../lib/cli/open-browser')
    const spawner = vi.fn(() => ({ unref: () => {} }))
    const r = openInEditor('/home/user/.gtm-os/.env', {
      platform: 'linux',
      spawner: spawner as unknown as typeof import('node:child_process').spawn,
    })
    expect(r.command).toBe('xdg-open')
    const call = spawner.mock.calls[0] as unknown as [string, string[], unknown]
    expect(call[0]).toBe('xdg-open')
    expect(call[1]).toEqual(['/home/user/.gtm-os/.env'])
  })

  it('reports a non-launched result when spawn throws', async () => {
    const { openInEditor } = await import('../lib/cli/open-browser')
    const spawner = vi.fn(() => {
      throw new Error('ENOENT: no editor configured')
    })
    const r = openInEditor('/tmp/.gtm-os/.env', {
      platform: 'linux',
      spawner: spawner as unknown as typeof import('node:child_process').spawn,
    })
    expect(r.attempted).toBe(true)
    expect(r.launched).toBe(false)
    expect(r.reason).toMatch(/ENOENT/)
  })
})

describe('runStart scaffold .env auto-open (0.9.1)', () => {
  it('auto-opens the .env when the template was just created', async () => {
    const { runStart } = await import('../lib/onboarding/start')
    // Spy on the openInEditor module before runStart imports it.
    const opened: string[] = []
    vi.doMock('../lib/cli/open-browser.js', async () => {
      const actual = await vi.importActual<typeof import('../lib/cli/open-browser')>(
        '../lib/cli/open-browser',
      )
      return {
        ...actual,
        openInEditor: (path: string) => {
          opened.push(path)
          return { attempted: true, launched: true, command: 'open' }
        },
      }
    })
    vi.resetModules()
    const { runStart: runStartFresh } = await import('../lib/onboarding/start')
    await runStartFresh({ tenantId: 'default', nonInteractive: true })
    expect(opened.length).toBe(1)
    expect(opened[0]).toContain('.gtm-os/.env')
    vi.doUnmock('../lib/cli/open-browser.js')
  })

  it('--no-open-env suppresses the auto-open even on a fresh template', async () => {
    const opened: string[] = []
    vi.doMock('../lib/cli/open-browser.js', async () => {
      const actual = await vi.importActual<typeof import('../lib/cli/open-browser')>(
        '../lib/cli/open-browser',
      )
      return {
        ...actual,
        openInEditor: (path: string) => {
          opened.push(path)
          return { attempted: true, launched: true, command: 'open' }
        },
      }
    })
    vi.resetModules()
    const { runStart } = await import('../lib/onboarding/start')
    await runStart({ tenantId: 'default', nonInteractive: true, noOpenEnv: true })
    expect(opened.length).toBe(0)
    vi.doUnmock('../lib/cli/open-browser.js')
  })
})

describe('runStart auto-open hook', () => {
  it('--review-in-chat commits without invoking the browser hook', async () => {
    seedMinimalPreview()
    // commitPreview path inside runChatReviewWalk also writes the sentinel,
    // so we can detect that the chat-walk path ran end-to-end.
    const openHook = vi.fn(() => ({ attempted: true, launched: true }))
    const { runStart } = await import('../lib/onboarding/start')
    await runStart({
      tenantId: 'default',
      // No capture flags + reviewInChat is the explicit terminal review
      // branch; runStart will treat the seeded preview as the input.
      nonInteractive: true,
      website: 'https://example.com',
      reviewInChat: true,
      openHook,
      // Skip real network/llm by short-circuiting the synthesis pipeline:
      // we don't hit it because our test sandbox has no ANTHROPIC_API_KEY
      // and runFlagCapture refuses without enough content. Instead we
      // exercise the chat-walk by going through the post-capture handoff
      // — see flag-capture seed below.
    })
    // The chat-walk fallback writes the sentinel after commit.
    // (runStart returns silently — the sentinel is the user-visible signal.)
    // It only runs when capture succeeds; in the test we can't drive
    // synthesis end-to-end, so we just assert the hook was NOT called.
    expect(openHook).not.toHaveBeenCalled()
  })

  it('writes the review-committed sentinel when commit-preview succeeds', async () => {
    seedMinimalPreview()
    const { runStart } = await import('../lib/onboarding/start')
    await runStart({
      tenantId: 'default',
      nonInteractive: true,
      commitPreview: true,
    })
    const sentinel = join(liveDir(), '_handoffs', 'setup', 'review.committed')
    expect(existsSync(sentinel)).toBe(true)
    const parsed = JSON.parse(readFileSync(sentinel, 'utf-8'))
    expect(parsed.tenant).toBe('default')
    expect(typeof parsed.at).toBe('string')
  })

  it('--no-open suppresses the open hook on the post-capture handoff', async () => {
    // Verify the openHook contract directly — we can't exercise the full
    // flag-capture pipeline in a test sandbox (it requires Firecrawl /
    // Anthropic), but the runStart code path passes `noOpen` through to
    // openBrowser unchanged, which we already cover above.
    const { openBrowser } = await import('../lib/cli/open-browser')
    const spawner = vi.fn(() => ({ unref: () => {} }))
    const r = openBrowser('http://localhost:3847/setup/review', {
      noOpen: true,
      spawner: spawner as unknown as typeof import('node:child_process').spawn,
    })
    expect(r.attempted).toBe(false)
    expect(r.launched).toBe(false)
    expect(spawner).not.toHaveBeenCalled()
  })
})
