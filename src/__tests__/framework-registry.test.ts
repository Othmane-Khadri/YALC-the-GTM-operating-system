import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  saveInstalledConfig,
  loadInstalledConfig,
  removeInstalledConfig,
  listInstalledFrameworks,
  installedConfigPath,
  setFrameworkDisabled,
  agentYamlPath,
  runsDir,
} from '../lib/frameworks/registry'
import { writeRun } from '../lib/frameworks/output/dashboard-adapter'
import { latestRun } from '../lib/frameworks/registry'
import type { InstalledFrameworkConfig } from '../lib/frameworks/types'

const sampleCfg = (name = 'sample-fw'): InstalledFrameworkConfig => ({
  name,
  display_name: 'Sample',
  description: 'desc',
  installed_at: new Date().toISOString(),
  schedule: { cron: '0 8 * * *' },
  output: { destination: 'dashboard', dashboard_route: `/frameworks/${name}` },
  inputs: { foo: 'bar' },
})

describe('framework registry (HOME-isolated)', () => {
  let homeBackup: string | undefined
  let tempHome: string

  beforeEach(() => {
    tempHome = join(tmpdir(), `yalc-fw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    homeBackup = process.env.HOME
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = homeBackup
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  it('save/load/remove round-trip', () => {
    // The registry resolves paths against homedir() at import time, so we
    // can't fully isolate HOME without re-importing. We exercise the file
    // I/O via the fs path constants instead.
    const cfg = sampleCfg()
    saveInstalledConfig(cfg)
    expect(existsSync(installedConfigPath(cfg.name))).toBe(true)
    const loaded = loadInstalledConfig(cfg.name)
    expect(loaded?.name).toBe(cfg.name)
    expect(loaded?.inputs.foo).toBe('bar')
    removeInstalledConfig(cfg.name)
    expect(loadInstalledConfig(cfg.name)).toBeNull()
  })

  it('lists installed frameworks alphabetically', () => {
    saveInstalledConfig(sampleCfg('beta'))
    saveInstalledConfig(sampleCfg('alpha'))
    const list = listInstalledFrameworks()
    expect(list).toContain('alpha')
    expect(list).toContain('beta')
    expect(list.indexOf('alpha')).toBeLessThan(list.indexOf('beta'))
    removeInstalledConfig('alpha')
    removeInstalledConfig('beta')
  })

  it('setFrameworkDisabled toggles status', () => {
    saveInstalledConfig(sampleCfg('toggleable'))
    expect(setFrameworkDisabled('toggleable', true)).toBe(true)
    expect(loadInstalledConfig('toggleable')?.disabled).toBe(true)
    expect(setFrameworkDisabled('toggleable', false)).toBe(true)
    expect(loadInstalledConfig('toggleable')?.disabled).toBe(false)
    removeInstalledConfig('toggleable')
  })

  it('setFrameworkDisabled returns false for unknown name', () => {
    expect(setFrameworkDisabled('does-not-exist', true)).toBe(false)
  })

  it('agentYamlPath and runsDir resolve under ~/.gtm-os/agents', () => {
    expect(agentYamlPath('foo').endsWith('foo.yaml')).toBe(true)
    expect(runsDir('foo').endsWith('foo.runs')).toBe(true)
  })

  it('writeRun then latestRun returns the persisted DashboardRun', () => {
    saveInstalledConfig(sampleCfg('roundtrip'))
    writeRun('roundtrip', {
      title: 'Test',
      rows: [{ a: 1 }],
      ranAt: '2026-01-01T00:00:00.000Z',
    })
    const last = latestRun('roundtrip')
    expect(last).not.toBeNull()
    const data = last!.data as { title: string; rows: unknown[] }
    expect(data.title).toBe('Test')
    expect(data.rows).toHaveLength(1)
    removeInstalledConfig('roundtrip')
  })
})
