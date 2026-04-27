import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

/**
 * Migration helper tests — pre-0.6.0 framework.yaml → company_context.yaml.
 *
 * Sandboxes `HOME` so the migration writes into a temp tree.
 */

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-migrate-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
  mkdirSync(join(TMP, '.gtm-os'), { recursive: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

function writeLegacyFramework(content: Record<string, unknown>) {
  writeFileSync(join(TMP, '.gtm-os', 'framework.yaml'), yaml.dump(content))
}

describe('runMigrate', () => {
  it('extracts company + ICP fields from framework.yaml', async () => {
    writeLegacyFramework({
      version: 7,
      onboarding_complete: true,
      company: { name: 'Acme Inc', website: 'https://acme.test', industry: 'B2B SaaS' },
      positioning: {
        valueProp: 'Robotic ducks for enterprise',
        competitors: [{ name: 'BetaCo' }, { name: 'DeltaCo' }],
      },
      segments: [
        {
          id: 'primary',
          name: 'Primary segment',
          description: 'CTOs at Series A SaaS',
          priority: 'primary',
          painPoints: ['slow releases', 'manual ops'],
          voice: { tone: 'direct', style: 'no-fluff' },
        },
      ],
    })

    const { runMigrate } = await import('../lib/onboarding/migrate')
    const result = runMigrate()
    expect(result.migrated).toBe(true)
    expect(result.path).toBe(join(TMP, '.gtm-os', 'company_context.yaml'))

    const written = yaml.load(readFileSync(result.path!, 'utf-8')) as Record<string, any>
    expect(written.company.name).toBe('Acme Inc')
    expect(written.company.website).toBe('https://acme.test')
    expect(written.icp.competitors).toEqual(['BetaCo', 'DeltaCo'])
    expect(written.icp.pain_points).toEqual(['slow releases', 'manual ops'])
    expect(written.icp.segments_freeform).toContain('CTOs at Series A SaaS')
    expect(written.voice.description).toContain('direct')
    expect(written.meta.migrated_from).toBe('7')
    expect(written.meta.version).toBe('0.6.0')
  })

  it('is a no-op when company_context.yaml already exists', async () => {
    writeLegacyFramework({ version: 7, company: { name: 'Acme' } })
    writeFileSync(join(TMP, '.gtm-os', 'company_context.yaml'), 'company:\n  name: Existing\n')

    const { runMigrate } = await import('../lib/onboarding/migrate')
    const result = runMigrate()
    expect(result.migrated).toBe(false)
    expect(readFileSync(join(TMP, '.gtm-os', 'company_context.yaml'), 'utf-8')).toContain(
      'Existing',
    )
  })

  it('reports cleanly when there is no framework.yaml to migrate', async () => {
    const { runMigrate } = await import('../lib/onboarding/migrate')
    const result = runMigrate()
    expect(result.migrated).toBe(false)
    expect(result.reason).toMatch(/No legacy framework/)
    expect(existsSync(join(TMP, '.gtm-os', 'company_context.yaml'))).toBe(false)
  })
})

describe('isPre060State', () => {
  it('is true when framework.yaml is present but company_context.yaml is not', async () => {
    writeLegacyFramework({ company: { name: 'Acme' } })
    const { isPre060State } = await import('../lib/onboarding/migrate')
    expect(isPre060State()).toBe(true)
  })

  it('is false once company_context.yaml has been written', async () => {
    writeLegacyFramework({ company: { name: 'Acme' } })
    writeFileSync(join(TMP, '.gtm-os', 'company_context.yaml'), 'company:\n  name: Acme\n')
    const { isPre060State } = await import('../lib/onboarding/migrate')
    expect(isPre060State()).toBe(false)
  })
})
