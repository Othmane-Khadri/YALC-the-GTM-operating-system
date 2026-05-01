/**
 * CLI tests for `routine:propose` and `routine:install`.
 *
 * Both commands are tested against a fixture context — no live registry,
 * no real `~/.gtm-os/` writes (HOME is pivoted to a tmpdir).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

import { runRoutinePropose, runRoutineInstall } from '../cli/commands/routine'
import type { CompanyContext } from '../lib/framework/context-types'

let TMP: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.HOME
  TMP = mkdtempSync(join(tmpdir(), 'yalc-routine-cli-'))
  process.env.HOME = TMP
  mkdirSync(join(TMP, '.gtm-os'), { recursive: true })
})

afterEach(() => {
  process.env.HOME = prevHome
  rmSync(TMP, { recursive: true, force: true })
})

const FIXTURE_CTX: CompanyContext = {
  company: { name: 'Acme', website: 'https://acme.test', description: '' },
  founder: { name: 'F', linkedin: '' },
  icp: {
    segments_freeform: '',
    pain_points: [],
    competitors: ['https://www.linkedin.com/company/x/'],
    subreddits: [],
    target_communities: [],
  },
  voice: { description: '', examples_path: '' },
  sources: { linkedin_account_id: 'acct' },
  meta: { captured_at: '', last_updated_at: '' },
  signals: { buyingIntentSignals: [], monitoringKeywords: ['ops drift'], triggerEvents: [] },
}

describe('routine:propose', () => {
  it('exit 0 + valid JSON when --json is set + Anthropic available', async () => {
    const r = await runRoutinePropose({
      json: true,
      inputs: {
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: true,
        archetype: null,
        context: FIXTURE_CTX,
        hypothesisLocked: false,
      },
    })
    expect(r.exitCode).toBe(0)
    expect(() => JSON.parse(r.output)).not.toThrow()
    const parsed = JSON.parse(r.output)
    expect(parsed.version).toBe(1)
    expect(parsed.frameworks.length).toBeGreaterThan(0)
  })

  it('exit 2 when no Anthropic key', async () => {
    const r = await runRoutinePropose({
      json: true,
      inputs: {
        capabilitiesAvailable: [],
        envHasAnthropic: false,
        archetype: null,
        context: null,
        hypothesisLocked: false,
      },
    })
    expect(r.exitCode).toBe(2)
    const parsed = JSON.parse(r.output)
    expect(parsed.frameworks).toEqual([])
  })

  it('human-readable output mentions framework names + dashboard route', async () => {
    const r = await runRoutinePropose({
      inputs: {
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: true,
        archetype: null,
        context: FIXTURE_CTX,
        hypothesisLocked: false,
      },
    })
    expect(r.output).toContain('competitor-audience-mining')
    expect(r.output).toContain('Default dashboard:')
    expect(r.output).toContain('/frameworks/competitor-audience-mining')
  })
})

describe('routine:install', () => {
  it('writes routine.yaml + config.yaml with --yes (no prompt)', async () => {
    const installed: string[] = []
    const r = await runRoutineInstall({
      yes: true,
      installFramework: async (name) => {
        installed.push(name)
      },
      inputs: {
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: true,
        archetype: null,
        context: FIXTURE_CTX,
        hypothesisLocked: false,
      },
    })
    expect(r.exitCode).toBe(0)
    expect(installed).toContain('competitor-audience-mining')
    expect(installed).toContain('content-calendar-builder')
    expect(installed).toContain('lead-magnet-builder')
    expect(existsSync(join(TMP, '.gtm-os', 'routine.yaml'))).toBe(true)
    const cfg = yaml.load(readFileSync(join(TMP, '.gtm-os', 'config.yaml'), 'utf-8')) as Record<string, unknown>
    expect((cfg.dashboard as Record<string, unknown>)?.default_route).toBe(
      '/frameworks/competitor-audience-mining',
    )
  })

  it('handles empty routine gracefully', async () => {
    const r = await runRoutineInstall({
      yes: true,
      installFramework: async () => {},
      inputs: {
        capabilitiesAvailable: [],
        envHasAnthropic: false,
        archetype: null,
        context: null,
        hypothesisLocked: false,
      },
    })
    expect(r.exitCode).toBe(0)
    expect(r.output).toContain('Nothing to install.')
    expect(existsSync(join(TMP, '.gtm-os', 'routine.yaml'))).toBe(false)
  })
})
