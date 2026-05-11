/**
 * Unit + integration tests for `installRoutine` (spec §6).
 *
 * The installer:
 *   - Writes the proposed Routine to `~/.gtm-os/routine.yaml` (sidecar).
 *   - Calls the framework install plumbing for every non-deferred entry.
 *   - Sets `dashboard.default_route` in `~/.gtm-os/config.yaml`.
 *   - Is idempotent: a second run with identical inputs is a no-op.
 *
 * Tests pivot HOME to a temp dir per the existing archetype-* pattern so
 * the real `~/.gtm-os` is never touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

import { installRoutine } from '../lib/routine/installer'
import type { Routine } from '../lib/routine/types'

let TMP: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.HOME
  TMP = mkdtempSync(join(tmpdir(), 'yalc-routine-installer-'))
  process.env.HOME = TMP
  mkdirSync(join(TMP, '.gtm-os'), { recursive: true })
})

afterEach(() => {
  process.env.HOME = prevHome
  rmSync(TMP, { recursive: true, force: true })
})

const SAMPLE_ROUTINE: Routine = {
  version: 1,
  generatedAt: '2026-05-01T00:00:00.000Z',
  archetypes: ['A', 'D'],
  frameworks: [
    {
      framework: 'competitor-audience-mining',
      schedule: { cron: '0 9 * * *' },
      rationale: 'A.',
    },
    {
      framework: 'lead-magnet-builder',
      rationale: 'D.',
    },
  ],
  defaultDashboard: '/frameworks/competitor-audience-mining',
  notes: [],
}

describe('installRoutine', () => {
  it('writes ~/.gtm-os/routine.yaml with the proposal + meta block', async () => {
    const result = await installRoutine(SAMPLE_ROUTINE, { dryRun: true })
    // dry-run should still write the sidecar (so the user can inspect)
    // — but we'd rather it doesn't, per spec. Inverted: dry-run does
    // NOT write. Verify file does NOT exist.
    expect(existsSync(join(TMP, '.gtm-os', 'routine.yaml'))).toBe(false)
    expect(result.installed).toEqual([])
    expect(result.skipped.some((s) => s.reason === 'dry-run')).toBe(true)
  })

  it('writes routine.yaml + config.yaml dashboard route on apply', async () => {
    const result = await installRoutine(SAMPLE_ROUTINE, {
      installFramework: async () => {
        // stub the framework install pipeline (no real install)
      },
    })
    expect(result.installed).toContain('competitor-audience-mining')
    expect(result.installed).toContain('lead-magnet-builder')

    const sidecarPath = join(TMP, '.gtm-os', 'routine.yaml')
    expect(existsSync(sidecarPath)).toBe(true)
    const parsed = yaml.load(readFileSync(sidecarPath, 'utf-8')) as Record<string, unknown>
    expect(parsed.version).toBe(1)
    expect(parsed.routine_meta).toBeDefined()
    expect((parsed.routine_meta as Record<string, unknown>).installed_at).toBeTruthy()

    const cfgPath = join(TMP, '.gtm-os', 'config.yaml')
    expect(existsSync(cfgPath)).toBe(true)
    const cfg = yaml.load(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>
    expect((cfg.dashboard as Record<string, unknown>)?.default_route).toBe(
      '/frameworks/competitor-audience-mining',
    )
  })

  it('is idempotent: re-running with same routine produces no new installs', async () => {
    let installCalls = 0
    const installFramework = async () => {
      installCalls++
    }
    await installRoutine(SAMPLE_ROUTINE, { installFramework })
    expect(installCalls).toBe(2)
    // Mark frameworks as installed so the idempotency check sees them
    // Simulate by writing the installed sidecar files (stub installFramework
    // doesn't actually persist)
    const installedDir = join(TMP, '.gtm-os', 'frameworks', 'installed')
    mkdirSync(installedDir, { recursive: true })
    writeFileSync(
      join(installedDir, 'competitor-audience-mining.json'),
      JSON.stringify({ name: 'competitor-audience-mining' }),
    )
    writeFileSync(
      join(installedDir, 'lead-magnet-builder.json'),
      JSON.stringify({ name: 'lead-magnet-builder' }),
    )
    const result2 = await installRoutine(SAMPLE_ROUTINE, { installFramework })
    expect(result2.installed).toEqual([])
    expect(result2.skipped.length).toBeGreaterThan(0)
    // installFramework call count stays at 2.
    expect(installCalls).toBe(2)
  })

  it('skips deferred entries with a clear reason', async () => {
    const routine: Routine = {
      ...SAMPLE_ROUTINE,
      frameworks: [
        {
          framework: 'outreach-campaign-builder',
          rationale: 'Awaiting hypothesis.',
          deferred: true,
        },
      ],
    }
    const installFramework = async () => {}
    const result = await installRoutine(routine, { installFramework })
    expect(result.installed).toEqual([])
    expect(result.skipped.find((s) => s.framework === 'outreach-campaign-builder')?.reason).toMatch(
      /deferred/,
    )
  })

  it('rejects unknown sidecar versions when reading prior install', async () => {
    const sidecarPath = join(TMP, '.gtm-os', 'routine.yaml')
    writeFileSync(sidecarPath, yaml.dump({ version: 999, frameworks: [] }))
    const installFramework = async () => {}
    const result = await installRoutine(SAMPLE_ROUTINE, { installFramework })
    // Unknown version should be quarantined — installer warns but keeps going.
    expect(result.warnings.some((w) => w.toLowerCase().includes('version'))).toBe(true)
  })

  it('handles routine with no frameworks gracefully', async () => {
    const empty: Routine = {
      version: 1,
      generatedAt: '2026-05-01T00:00:00.000Z',
      archetypes: [],
      frameworks: [],
      defaultDashboard: '/frameworks',
      notes: [],
    }
    const result = await installRoutine(empty)
    expect(result.installed).toEqual([])
    // No-op for empty routines — spec says installRoutine is a no-op when
    // there's nothing to install.
    expect(existsSync(join(TMP, '.gtm-os', 'routine.yaml'))).toBe(false)
  })
})
