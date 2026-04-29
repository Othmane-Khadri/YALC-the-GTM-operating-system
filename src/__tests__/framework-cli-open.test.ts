/**
 * Tests for the `--open` flag on framework:install / framework:run (0.9.C).
 *
 * The framework CLI commands themselves prompt interactively or hit
 * registries that need real install state; this test pins the contract
 * the action handler relies on — that the shared `openBrowser` helper is
 * the one source of truth for spawning the platform opener with the
 * correct dashboard URL — by exercising the helper with a stubbed
 * `spawn` and asserting the URL is what the `--open` flag would launch.
 */

import { describe, it, expect, vi } from 'vitest'

describe('framework --open URL contract', () => {
  it('launches the framework dashboard URL via the macOS opener', async () => {
    const { openBrowser } = await import('../lib/cli/open-browser')
    const spawner = vi.fn(() => ({ unref: () => {} }))
    const url = 'http://localhost:3847/frameworks/sample'
    const r = openBrowser(url, {
      platform: 'darwin',
      spawner: spawner as unknown as typeof import('node:child_process').spawn,
    })
    expect(r.attempted).toBe(true)
    expect(r.command).toBe('open')
    const call = spawner.mock.calls[0] as unknown as [string, string[], unknown]
    expect(call[0]).toBe('open')
    expect(call[1]).toContain(url)
  })

  it('--open=false short-circuits the launch (helper contract)', async () => {
    const { openBrowser } = await import('../lib/cli/open-browser')
    const spawner = vi.fn()
    const r = openBrowser('http://localhost:3847/frameworks/sample', {
      noOpen: true,
      spawner: spawner as unknown as typeof import('node:child_process').spawn,
    })
    expect(r.attempted).toBe(false)
    expect(spawner).not.toHaveBeenCalled()
  })
})
