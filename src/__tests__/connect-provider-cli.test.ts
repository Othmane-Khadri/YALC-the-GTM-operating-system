import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import yaml from 'js-yaml'

import {
  appendCapabilityPriority,
  checkEnvVarsPresent,
  maskSecret,
  runConnectProvider,
} from '../cli/commands/connect-provider'
import type { ProviderKnowledge } from '../lib/providers/knowledge-base'

let tempHome: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.HOME
  tempHome = join(tmpdir(), `yalc-connectcli-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tempHome, { recursive: true })
  mkdirSync(join(tempHome, '.gtm-os'), { recursive: true })
  process.env.HOME = tempHome
  // Pre-set keys so the test_query path is exercised against a fake key —
  // we mock the capability resolver, so the actual value doesn't matter.
  process.env.PAPPERS_API_KEY = 'test-pappers-key'
  process.env.CRUSTDATA_API_KEY = 'test-crustdata-key'
  // Quiet console.log during tests.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  process.env.HOME = prevHome
  delete process.env.PAPPERS_API_KEY
  delete process.env.CRUSTDATA_API_KEY
  if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('connect-provider CLI — non-TTY happy path', () => {
  it('walks pappers from pending_keys → configured via sentinel-file handoff', async () => {
    // Pre-create the sentinel so the wait returns immediately.
    const sentinelDir = join(tempHome, '.gtm-os', '_handoffs', 'keys')
    mkdirSync(sentinelDir, { recursive: true })
    writeFileSync(join(sentinelDir, 'pappers.ready'), '', 'utf-8')

    // Stub the capability registry so the test_query path doesn't hit the live
    // Pappers stub (which throws "not yet implemented" by design).
    const capabilitiesModule = await import('../lib/providers/capabilities')
    const fakeAdapter = {
      capabilityId: 'icp-company-search',
      providerId: 'pappers',
      execute: async () => ({ companies: [{ name: 'Acme', industry: 'SaaS' }] }),
    }
    vi.spyOn(capabilitiesModule, 'getCapabilityRegistryReady').mockResolvedValue({
      resolve: async () => fakeAdapter,
    } as never)

    const result = await runConnectProvider('pappers', {
      forceNonTty: true,
      homeOverride: tempHome,
      handoffTimeoutMs: 5000,
    })

    expect(result.installStatus).toBe('configured')
    expect(result.providerId).toBe('pappers')
    expect(result.exitCode).toBe(0)
    expect(result.issues).toEqual([])

    // Capability priority list was appended.
    const cfg = yaml.load(readFileSync(join(tempHome, '.gtm-os', 'config.yaml'), 'utf-8')) as Record<string, unknown>
    const caps = cfg.capabilities as Record<string, { priority: string[] }>
    expect(caps['icp-company-search'].priority).toContain('pappers')
  })
})

describe('connect-provider CLI — sentinel-file timeout', () => {
  it('returns pending_keys with non-zero exit when the sentinel never appears', async () => {
    const result = await runConnectProvider('pappers', {
      forceNonTty: true,
      homeOverride: tempHome,
      handoffTimeoutMs: 50, // tiny timeout — sentinel never gets created
    })
    expect(result.installStatus).toBe('pending_keys')
    expect(result.exitCode).toBe(1)
    expect(result.issues.some((s) => s.includes('handoff timed out'))).toBe(true)
  })
})

describe('connect-provider CLI — closest-match suggestions', () => {
  it('typo "papprrs" surfaces pappers + 2 other suggestions and exits non-zero in non-TTY mode', async () => {
    const result = await runConnectProvider('papprrs', {
      forceNonTty: true,
      homeOverride: tempHome,
    })
    expect(result.installStatus).toBe('failed')
    expect(result.exitCode).toBe(1)
    // The non-interactive nextAction enumerates the closest-match list.
    expect(result.nextAction).toMatch(/pappers/)
  })
})

describe('connect-provider CLI — health check failure surfaces clearly', () => {
  it('missing env var halts with exit code 1 and a "missing env vars" issue', async () => {
    delete process.env.PAPPERS_API_KEY
    const sentinelDir = join(tempHome, '.gtm-os', '_handoffs', 'keys')
    mkdirSync(sentinelDir, { recursive: true })
    writeFileSync(join(sentinelDir, 'pappers.ready'), '', 'utf-8')
    const result = await runConnectProvider('pappers', {
      forceNonTty: true,
      homeOverride: tempHome,
      handoffTimeoutMs: 5000,
    })
    expect(result.installStatus).toBe('failed')
    expect(result.exitCode).toBe(1)
    expect(result.issues.some((s) => s.includes('missing env vars'))).toBe(true)
    expect(result.issues.some((s) => s.includes('PAPPERS_API_KEY'))).toBe(true)
  })
})

describe('connect-provider CLI — capabilities priority is append-only', () => {
  it('preserves existing entries when appending', () => {
    const cfgPath = join(tempHome, '.gtm-os', 'config.yaml')
    writeFileSync(
      cfgPath,
      yaml.dump({ capabilities: { 'icp-company-search': { priority: ['crustdata', 'apollo'] } } }),
      'utf-8',
    )
    const out = appendCapabilityPriority(cfgPath, 'icp-company-search', 'pappers')
    expect(out).toEqual(['crustdata', 'apollo', 'pappers'])
    // Idempotent — running again does not duplicate.
    const out2 = appendCapabilityPriority(cfgPath, 'icp-company-search', 'pappers')
    expect(out2).toEqual(['crustdata', 'apollo', 'pappers'])
  })
})

describe('connect-provider CLI — test_query is invoked after registration', () => {
  it('non-zero exit when test_query throws', async () => {
    const sentinelDir = join(tempHome, '.gtm-os', '_handoffs', 'keys')
    mkdirSync(sentinelDir, { recursive: true })
    writeFileSync(join(sentinelDir, 'pappers.ready'), '', 'utf-8')

    const capabilitiesModule = await import('../lib/providers/capabilities')
    vi.spyOn(capabilitiesModule, 'getCapabilityRegistryReady').mockResolvedValue({
      resolve: async () => ({
        capabilityId: 'icp-company-search',
        providerId: 'pappers',
        execute: async () => {
          throw new Error('not yet implemented')
        },
      }),
    } as never)

    const result = await runConnectProvider('pappers', {
      forceNonTty: true,
      homeOverride: tempHome,
      handoffTimeoutMs: 5000,
    })
    expect(result.installStatus).toBe('failed')
    expect(result.exitCode).toBe(1)
    expect(result.issues.some((s) => s.includes('test_query failed'))).toBe(true)
  })
})

describe('connect-provider CLI — helpers', () => {
  it('maskSecret never returns the full value', () => {
    expect(maskSecret(undefined)).toBe('(not set)')
    expect(maskSecret('short')).not.toContain('short')
    expect(maskSecret('a-fully-real-token')).not.toContain('fully-real-token')
    expect(maskSecret('a-fully-real-token')).toMatch(/^a-fu…/)
  })

  it('checkEnvVarsPresent returns the missing required keys only', () => {
    const k: ProviderKnowledge = {
      id: 'mock',
      display_name: 'Mock',
      integration_kind: 'rest',
      env_vars: [
        { name: 'MOCK_REQUIRED', required: true },
        { name: 'MOCK_OPTIONAL', required: false },
      ],
      capabilities_supported: [],
      install_steps: [],
    }
    delete process.env.MOCK_REQUIRED
    delete process.env.MOCK_OPTIONAL
    expect(checkEnvVarsPresent(k)).toEqual(['MOCK_REQUIRED'])
    process.env.MOCK_REQUIRED = 'present'
    expect(checkEnvVarsPresent(k)).toEqual([])
    delete process.env.MOCK_REQUIRED
  })
})
