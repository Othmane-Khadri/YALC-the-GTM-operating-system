import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import yaml from 'js-yaml'

import {
  closestProviderIds,
  loadProviderKnowledge,
  parseProviderKnowledge,
  templateInstallStep,
  type ProviderKnowledge,
} from '../lib/providers/knowledge-base'
import { writeCustomProviderYaml } from '../cli/commands/connect-provider'

const PKG_ROOT = process.cwd()
const BUNDLED_DIR = join(PKG_ROOT, 'configs', 'providers')

const REQUIRED_BUNDLED = [
  'crustdata',
  'pappers',
  'apollo',
  'peopledatalabs',
  'zoominfo',
  'hubspot',
  'salesforce',
  'unipile',
  'instantly',
  'brevo',
]

describe('provider knowledge base — bundled lookup', () => {
  it('every required bundled provider is present and parses cleanly', () => {
    const map = loadProviderKnowledge({ bundledDir: BUNDLED_DIR, userDir: '/tmp/yalc-nonexistent-user-dir' })
    for (const id of REQUIRED_BUNDLED) {
      const entry = map.get(id)
      expect(entry, `missing bundled provider: ${id}`).toBeDefined()
      expect(entry!.id).toBe(id)
      expect(entry!.display_name.length).toBeGreaterThan(0)
      expect(entry!.env_vars.length).toBeGreaterThan(0)
      expect(['rest', 'mcp', 'builtin']).toContain(entry!.integration_kind)
      expect(entry!.source).toBe('bundled')
    }
  })

  it('lookup miss returns top-3 closest matches via Levenshtein', () => {
    const ids = ['pappers', 'apollo', 'crustdata', 'peopledatalabs', 'hubspot', 'salesforce']
    const suggestions = closestProviderIds('papprrs', ids, 3)
    expect(suggestions.length).toBe(3)
    expect(suggestions[0]).toBe('pappers')
    // Order is deterministic: first by distance, then alphabetical.
    expect(suggestions).toEqual(expect.arrayContaining(['pappers']))
  })

  it('env_vars schema validation surfaces invalid env var names', () => {
    const { value, issues } = parseProviderKnowledge(
      {
        id: 'foo',
        display_name: 'Foo',
        integration_kind: 'rest',
        env_vars: [{ name: 'lowercase_bad' }],
      },
      'inline',
    )
    expect(value).toBeNull()
    expect(issues.some((s) => s.includes('UPPER_SNAKE'))).toBe(true)
  })

  it('install_steps templating substitutes $homepage / $key_acquisition_url / $id / $display_name', () => {
    const k: ProviderKnowledge = {
      id: 'pappers',
      display_name: 'Pappers',
      homepage: 'https://pappers.fr',
      key_acquisition_url: 'https://www.pappers.fr/api/dashboard',
      integration_kind: 'rest',
      env_vars: [],
      capabilities_supported: [],
      install_steps: [],
    }
    expect(templateInstallStep('Sign up at $homepage', k)).toBe('Sign up at https://pappers.fr')
    expect(templateInstallStep('Run: yalc-gtm connect-provider $id', k)).toBe('Run: yalc-gtm connect-provider pappers')
    expect(templateInstallStep('Connect $display_name now', k)).toBe('Connect Pappers now')
    expect(templateInstallStep('Get key from $key_acquisition_url', k)).toBe('Get key from https://www.pappers.fr/api/dashboard')
  })

  it('every bundled capabilities_supported entry references an adapter file that exists on disk', () => {
    const map = loadProviderKnowledge({ bundledDir: BUNDLED_DIR, userDir: '/tmp/yalc-nonexistent-user-dir' })
    const seen: string[] = []
    for (const k of map.values()) {
      for (const cap of k.capabilities_supported) {
        if (!cap.adapter_module) continue
        const abs = join(PKG_ROOT, cap.adapter_module)
        seen.push(abs)
        expect(existsSync(abs), `missing adapter for ${k.id}/${cap.id}: ${abs}`).toBe(true)
      }
    }
    // Sanity: at least the pappers + crustdata + unipile + instantly + apollo
    // entries declared concrete adapter modules.
    expect(seen.length).toBeGreaterThanOrEqual(5)
  })

  it('user override directory wins over bundled when ids match', () => {
    const tmp = join(tmpdir(), `yalc-knowledge-user-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmp, { recursive: true })
    try {
      // Override `pappers` in the user dir with a different display name.
      writeFileSync(
        join(tmp, 'pappers.yaml'),
        yaml.dump({
          id: 'pappers',
          display_name: 'Pappers (forked)',
          integration_kind: 'rest',
          env_vars: [{ name: 'PAPPERS_API_KEY' }],
          capabilities_supported: [],
          install_steps: ['custom step'],
        }),
        'utf-8',
      )
      const map = loadProviderKnowledge({ bundledDir: BUNDLED_DIR, userDir: tmp })
      const entry = map.get('pappers')!
      expect(entry.display_name).toBe('Pappers (forked)')
      expect(entry.source).toBe('user')
      expect(entry.install_steps).toEqual(['custom step'])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('connect-provider custom-provider yaml', () => {
  let written: string | null = null

  afterEach(() => {
    if (written && existsSync(written)) {
      rmSync(written, { force: true })
    }
    written = null
  })

  it('writes a yaml under configs/providers/_user/<name>.yaml that the loader picks up', () => {
    const id = `tt-custom-${Date.now()}`
    written = writeCustomProviderYaml({
      id,
      kind: 'rest',
      envVars: [{ name: 'TT_TEST_KEY' }],
    })
    expect(written.endsWith(`/_user/${id}.yaml`)).toBe(true)

    const map = loadProviderKnowledge({ bundledDir: BUNDLED_DIR, userDir: '/tmp/yalc-nonexistent-user-dir' })
    const entry = map.get(id)
    expect(entry).toBeDefined()
    expect(entry!.integration_kind).toBe('rest')
    expect(entry!.env_vars.find((e) => e.name === 'TT_TEST_KEY')).toBeDefined()
  })
})

describe('provider knowledge files of interest', () => {
  it('every bundled file is .yaml and parses without thrown errors', () => {
    const files = readdirSync(BUNDLED_DIR).filter((f) => f.endsWith('.yaml'))
    expect(files.length).toBeGreaterThanOrEqual(REQUIRED_BUNDLED.length)
    for (const f of files) {
      // Skip the _user dir entries (it's a sibling, not a file)
      const text = readFileSync(join(BUNDLED_DIR, f), 'utf-8')
      const parsed = yaml.load(text)
      const { value, issues } = parseProviderKnowledge(parsed, f)
      expect(issues, `validation issues in ${f}: ${issues.join('; ')}`).toEqual([])
      expect(value).not.toBeNull()
    }
  })
})
