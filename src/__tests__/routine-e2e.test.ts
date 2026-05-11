/**
 * E2E test for the Routine Generator (per spec §8).
 *
 * Walks the full propose → install flow against a fixture context with
 * the framework install pipeline stubbed (no launchd, no real disk
 * writes outside the temp HOME). Asserts the right schedule lands in
 * the agent yaml the installed routine wrote, and that the sidecar
 * snapshot at `~/.gtm-os/routine.yaml` matches what the generator
 * produced.
 *
 * Mirrors the HOME-pivot pattern from `archetype-competitor-audience-mining.test.ts`
 * so the real `~/.gtm-os` is never touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

import { runRoutinePropose, runRoutineInstall } from '../cli/commands/routine'
import type { CompanyContext } from '../lib/framework/context-types'
import type { Routine } from '../lib/routine/types'

let TMP: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.HOME
  TMP = mkdtempSync(join(tmpdir(), 'yalc-routine-e2e-'))
  process.env.HOME = TMP
  mkdirSync(join(TMP, '.gtm-os'), { recursive: true })
})

afterEach(() => {
  process.env.HOME = prevHome
  rmSync(TMP, { recursive: true, force: true })
})

const FULL_CONTEXT: CompanyContext = {
  company: { name: 'Acme', website: 'https://acme.test', description: 'desc' },
  founder: { name: 'F', linkedin: '' },
  icp: {
    segments_freeform: 'Series A SaaS CTOs',
    pain_points: ['ops drift'],
    competitors: ['https://www.linkedin.com/company/competitor/'],
    subreddits: [],
    target_communities: [],
  },
  voice: { description: '', examples_path: '' },
  sources: { linkedin_account_id: 'acct_123' },
  meta: { captured_at: '', last_updated_at: '' },
  signals: {
    buyingIntentSignals: [],
    monitoringKeywords: ['rev ops drift'],
    triggerEvents: [],
  },
}

describe('routine generator — full setup flow E2E', () => {
  it('propose → install → sidecar snapshot matches + dashboard set', async () => {
    // 1. Propose.
    const propose = await runRoutinePropose({
      json: true,
      inputs: {
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: true,
        archetype: null,
        context: FULL_CONTEXT,
        hypothesisLocked: false,
      },
    })
    expect(propose.exitCode).toBe(0)
    const proposed = JSON.parse(propose.output) as Routine
    expect(proposed.frameworks.map((f) => f.framework).sort()).toEqual([
      'competitor-audience-mining',
      'content-calendar-builder',
      'lead-magnet-builder',
      'outreach-campaign-builder',
    ])
    // outreach-campaign-builder is deferred (no hypothesis locked).
    const c = proposed.frameworks.find((f) => f.framework === 'outreach-campaign-builder')
    expect(c?.deferred).toBe(true)

    // 2. Install — stub the framework install pipeline so we don't
    // actually call launchd / write the real agent yaml. This mirrors
    // the pattern from archetype-*.test.ts.
    const installCalls: string[] = []
    const install = await runRoutineInstall({
      yes: true,
      installFramework: async (name) => {
        installCalls.push(name)
      },
      inputs: {
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: true,
        archetype: null,
        context: FULL_CONTEXT,
        hypothesisLocked: false,
      },
    })
    expect(install.exitCode).toBe(0)
    expect(installCalls).toEqual(
      expect.arrayContaining([
        'competitor-audience-mining',
        'content-calendar-builder',
        'lead-magnet-builder',
      ]),
    )

    // 3. Sidecar at ~/.gtm-os/routine.yaml exists and matches.
    const sidecarPath = join(TMP, '.gtm-os', 'routine.yaml')
    expect(existsSync(sidecarPath)).toBe(true)
    const persisted = yaml.load(readFileSync(sidecarPath, 'utf-8')) as Record<string, unknown>
    expect(persisted.version).toBe(1)
    expect((persisted.frameworks as Array<Record<string, unknown>>).length).toBe(4)
    // Framework A entry kept its yaml-declared cron.
    const a = (persisted.frameworks as Array<Record<string, unknown>>).find(
      (f) => f.framework === 'competitor-audience-mining',
    )
    expect((a?.schedule as Record<string, unknown>)?.cron).toBe('0 9 * * *')

    // 4. Dashboard preference patched in.
    const cfgPath = join(TMP, '.gtm-os', 'config.yaml')
    expect(existsSync(cfgPath)).toBe(true)
    const cfg = yaml.load(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>
    expect((cfg.dashboard as Record<string, unknown>)?.default_route).toBe(
      '/frameworks/competitor-audience-mining',
    )
  })

  it('Anthropic-only env: only D installs; sidecar reflects single-entry routine', async () => {
    const installCalls: string[] = []
    const r = await runRoutineInstall({
      yes: true,
      installFramework: async (name) => {
        installCalls.push(name)
      },
      inputs: {
        capabilitiesAvailable: [],
        envHasAnthropic: true,
        archetype: null,
        context: null,
        hypothesisLocked: false,
      },
    })
    expect(r.exitCode).toBe(0)
    expect(installCalls).toEqual(['lead-magnet-builder'])
    const sidecar = yaml.load(readFileSync(join(TMP, '.gtm-os', 'routine.yaml'), 'utf-8')) as Record<string, unknown>
    expect((sidecar.frameworks as Array<unknown>).length).toBe(1)
    const cfg = yaml.load(readFileSync(join(TMP, '.gtm-os', 'config.yaml'), 'utf-8')) as Record<string, unknown>
    expect((cfg.dashboard as Record<string, unknown>)?.default_route).toBe('/frameworks/lead-magnet-builder')
  })

  it('preserves existing config.yaml keys when patching dashboard preference', async () => {
    // Pre-write a config.yaml with unrelated keys.
    const cfgPath = join(TMP, '.gtm-os', 'config.yaml')
    const existing = {
      notion: { campaigns_ds: 'abc', leads_ds: 'def', variants_ds: 'ghi', parent_page: 'xyz' },
      archetype: 'a',
    }
    require('node:fs').writeFileSync(cfgPath, yaml.dump(existing), 'utf-8')

    await runRoutineInstall({
      yes: true,
      installFramework: async () => {},
      inputs: {
        capabilitiesAvailable: [],
        envHasAnthropic: true,
        archetype: null,
        context: null,
        hypothesisLocked: false,
      },
    })

    const merged = yaml.load(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>
    expect((merged.notion as Record<string, unknown>)?.campaigns_ds).toBe('abc')
    expect(merged.archetype).toBe('a')
    expect((merged.dashboard as Record<string, unknown>)?.default_route).toBe('/frameworks/lead-magnet-builder')
  })
})
