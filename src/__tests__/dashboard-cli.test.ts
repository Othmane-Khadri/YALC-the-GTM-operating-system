/**
 * Tests for `yalc-gtm dashboard` (alias `ui`) — the SPA summon command (A2).
 *
 * The command:
 *   - Probes port 3847; if the server is already up, does NOT re-spawn it.
 *   - Otherwise spawns the dashboard server in the background.
 *   - Resolves the route from disk state:
 *       * no ~/.gtm-os/company_context.yaml  → /setup/review
 *       * yaml present                       → /today
 *       * --route <path> overrides both
 *   - Always prints the URL (headless / SSH friendly).
 *   - Opens the user's default browser unless --no-open is passed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-dashboard-cli-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  if (TMP) rmSync(TMP, { recursive: true, force: true })
})

describe('dashboard — route resolution', () => {
  it('routes to /setup/review on a fresh install (no company_context.yaml)', async () => {
    const { runDashboard } = await import('../cli/commands/dashboard')
    const result = await runDashboard({
      homeOverride: TMP,
      isPortListening: async () => true, // pretend server is already up
      open: false,
    })
    expect(result.exitCode).toBe(0)
    expect(result.url).toBe('http://localhost:3847/setup/review')
    expect(result.route).toBe('/setup/review')
  })

  it('routes to /today after onboarding (company_context.yaml present)', async () => {
    const live = join(TMP, '.gtm-os')
    mkdirSync(live, { recursive: true })
    writeFileSync(join(live, 'company_context.yaml'), 'company: ACME\n')

    const { runDashboard } = await import('../cli/commands/dashboard')
    const result = await runDashboard({
      homeOverride: TMP,
      isPortListening: async () => true,
      open: false,
    })
    expect(result.exitCode).toBe(0)
    expect(result.url).toBe('http://localhost:3847/today')
    expect(result.route).toBe('/today')
  })

  it('honors an explicit --route override', async () => {
    const live = join(TMP, '.gtm-os')
    mkdirSync(live, { recursive: true })
    writeFileSync(join(live, 'company_context.yaml'), 'company: ACME\n')

    const { runDashboard } = await import('../cli/commands/dashboard')
    const result = await runDashboard({
      homeOverride: TMP,
      isPortListening: async () => true,
      open: false,
      route: '/visualizations',
    })
    expect(result.exitCode).toBe(0)
    expect(result.url).toBe('http://localhost:3847/visualizations')
    expect(result.route).toBe('/visualizations')
  })

  it('normalises a route that lacks a leading slash', async () => {
    const live = join(TMP, '.gtm-os')
    mkdirSync(live, { recursive: true })
    writeFileSync(join(live, 'company_context.yaml'), 'company: ACME\n')

    const { runDashboard } = await import('../cli/commands/dashboard')
    const result = await runDashboard({
      homeOverride: TMP,
      isPortListening: async () => true,
      open: false,
      route: 'visualizations',
    })
    expect(result.url).toBe('http://localhost:3847/visualizations')
    expect(result.route).toBe('/visualizations')
  })
})

describe('dashboard — server lifecycle', () => {
  it('does NOT spawn a second server when one is already listening', async () => {
    const spawnServer = vi.fn(async () => 12345)
    const { runDashboard } = await import('../cli/commands/dashboard')
    const result = await runDashboard({
      homeOverride: TMP,
      isPortListening: async () => true, // already up
      spawnServer,
      open: false,
    })
    expect(spawnServer).not.toHaveBeenCalled()
    expect(result.spawnedPid).toBeNull()
    expect(result.alreadyRunning).toBe(true)
  })

  it('spawns the server when the port is free', async () => {
    const spawnServer = vi.fn(async () => 9999)
    // First probe: port not in use → spawn. Subsequent probes (waiting for
    // the server to come up): pretend it's now listening so we don't busy-loop.
    let calls = 0
    const isPortListening = vi.fn(async () => {
      calls += 1
      return calls > 1
    })
    const { runDashboard } = await import('../cli/commands/dashboard')
    const result = await runDashboard({
      homeOverride: TMP,
      isPortListening,
      spawnServer,
      open: false,
    })
    expect(spawnServer).toHaveBeenCalledTimes(1)
    expect(result.spawnedPid).toBe(9999)
    expect(result.alreadyRunning).toBe(false)
  })

  it('two back-to-back invocations against an already-up server do not double-boot', async () => {
    const spawnServer = vi.fn(async () => 12345)
    const isPortListening = vi.fn(async () => true)
    const { runDashboard } = await import('../cli/commands/dashboard')
    const r1 = await runDashboard({ homeOverride: TMP, isPortListening, spawnServer, open: false })
    const r2 = await runDashboard({ homeOverride: TMP, isPortListening, spawnServer, open: false })
    expect(spawnServer).not.toHaveBeenCalled()
    expect(r1.alreadyRunning).toBe(true)
    expect(r2.alreadyRunning).toBe(true)
  })
})

describe('dashboard — browser open + headless behaviour', () => {
  it('always returns a URL even when open=false (SSH/headless)', async () => {
    const { runDashboard } = await import('../cli/commands/dashboard')
    const result = await runDashboard({
      homeOverride: TMP,
      isPortListening: async () => true,
      open: false,
    })
    expect(result.url.startsWith('http://localhost:3847/')).toBe(true)
  })

  it('invokes the openBrowser hook when open is not disabled', async () => {
    const opener = vi.fn(
      (_url: string) => ({ attempted: true, launched: true, command: 'open' as const }),
    )
    const { runDashboard } = await import('../cli/commands/dashboard')
    const result = await runDashboard({
      homeOverride: TMP,
      isPortListening: async () => true,
      openBrowser: opener,
    })
    expect(opener).toHaveBeenCalledTimes(1)
    expect(opener.mock.calls[0]?.[0]).toBe(result.url)
  })

  it('skips the openBrowser hook when open=false', async () => {
    const opener = vi.fn(
      (_url: string) => ({ attempted: false, launched: false, command: null as null }),
    )
    const { runDashboard } = await import('../cli/commands/dashboard')
    await runDashboard({
      homeOverride: TMP,
      isPortListening: async () => true,
      openBrowser: opener,
      open: false,
    })
    expect(opener).not.toHaveBeenCalled()
  })
})
