/**
 * Tests for `yalc-gtm dashboard --archetype <a|b|c|d>` (C3).
 *
 * The flag opens the archetype-specific SPA route. Without it, the existing
 * route resolution rules (no context.yaml → /setup/review, present → /today,
 * --route override) are preserved.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-dashboard-archetype-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  if (TMP) rmSync(TMP, { recursive: true, force: true })
})

describe('dashboard --archetype', () => {
  it('routes to /dashboard/c when archetype=c is passed', async () => {
    const live = join(TMP, '.gtm-os')
    mkdirSync(live, { recursive: true })
    writeFileSync(join(live, 'company_context.yaml'), 'company: ACME\n')

    const { runDashboard } = await import('../cli/commands/dashboard')
    const result = await runDashboard({
      homeOverride: TMP,
      isPortListening: async () => true,
      open: false,
      archetype: 'c',
    })
    expect(result.exitCode).toBe(0)
    expect(result.url).toBe('http://localhost:3847/dashboard/c')
    expect(result.route).toBe('/dashboard/c')
  })

  it('accepts uppercase archetype letters', async () => {
    const { runDashboard } = await import('../cli/commands/dashboard')
    const result = await runDashboard({
      homeOverride: TMP,
      isPortListening: async () => true,
      open: false,
      archetype: 'A',
    })
    expect(result.url).toBe('http://localhost:3847/dashboard/a')
    expect(result.route).toBe('/dashboard/a')
  })

  it('rejects an unknown archetype letter with a non-zero exit', async () => {
    const { runDashboard } = await import('../cli/commands/dashboard')
    const result = await runDashboard({
      homeOverride: TMP,
      isPortListening: async () => true,
      open: false,
      archetype: 'z',
    })
    expect(result.exitCode).not.toBe(0)
  })

  it('--archetype takes precedence over --route', async () => {
    const { runDashboard } = await import('../cli/commands/dashboard')
    const result = await runDashboard({
      homeOverride: TMP,
      isPortListening: async () => true,
      open: false,
      archetype: 'b',
      route: '/visualizations',
    })
    expect(result.route).toBe('/dashboard/b')
  })

  it('preserves existing /today routing when --archetype is not passed', async () => {
    const live = join(TMP, '.gtm-os')
    mkdirSync(live, { recursive: true })
    writeFileSync(join(live, 'company_context.yaml'), 'company: ACME\n')

    const { runDashboard } = await import('../cli/commands/dashboard')
    const result = await runDashboard({
      homeOverride: TMP,
      isPortListening: async () => true,
      open: false,
    })
    expect(result.route).toBe('/today')
  })
})
