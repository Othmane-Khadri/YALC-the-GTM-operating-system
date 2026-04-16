import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTenant, DEFAULT_TENANT, tenantConfigDir } from '../index.js'

describe('resolveTenant', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'gtm-tenant-'))
  })
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('defaults to default when nothing is set', () => {
    expect(resolveTenant({ env: {}, cwd })).toBe(DEFAULT_TENANT)
  })

  it('honors the .gtm-os-tenant file', () => {
    writeFileSync(join(cwd, '.gtm-os-tenant'), 'acme-corp\n')
    expect(resolveTenant({ env: {}, cwd })).toBe('acme-corp')
  })

  it('GTM_OS_TENANT env beats the file', () => {
    writeFileSync(join(cwd, '.gtm-os-tenant'), 'acme-corp')
    expect(resolveTenant({ env: { GTM_OS_TENANT: 'gamma-co' }, cwd })).toBe('gamma-co')
  })

  it('CLI flag beats env and file', () => {
    writeFileSync(join(cwd, '.gtm-os-tenant'), 'acme-corp')
    expect(
      resolveTenant({ cliFlag: 'beta-inc', env: { GTM_OS_TENANT: 'gamma-co' }, cwd }),
    ).toBe('beta-inc')
  })

  it('rejects invalid slugs', () => {
    expect(() => resolveTenant({ cliFlag: 'Bad Slug!', env: {}, cwd })).toThrow(/Invalid tenant slug/)
    expect(() => resolveTenant({ cliFlag: 'UPPER', env: {}, cwd })).toThrow(/Invalid tenant slug/)
  })

  it('falls through empty/whitespace cli flag to lower precedence sources', () => {
    expect(resolveTenant({ cliFlag: '   ', env: { GTM_OS_TENANT: 'delta-ltd' }, cwd })).toBe('delta-ltd')
  })

  it('tenantConfigDir returns ~/.gtm-os/tenants/<slug>', () => {
    expect(tenantConfigDir('default', '/h')).toBe('/h/.gtm-os/tenants/default')
  })
})
