/**
 * Tests for `yalc-gtm provider:install <capability>/<provider>`.
 *
 * The install handler:
 *   1. Resolves a remote URL on the configured providers source
 *      (default: yalc-providers main branch on GitHub raw).
 *   2. Fetches the YAML manifest via the injected fetch impl.
 *   3. Validates it through `compileManifest` (full schema check; no
 *      live HTTP smoke).
 *   4. Writes it to `~/.gtm-os/adapters/<capability>-<provider>.yaml`.
 *   5. Refuses to overwrite an existing manifest unless `--force` is set.
 *   6. Optionally amends `~/.gtm-os/config.yaml`'s
 *      `capabilities.<capability>.priority` list (front of list).
 *   7. Returns a structured result the CLI prints — never throws.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProviderInstall } from '../provider-install'

const APOLLO_YAML = `manifestVersion: 1
capability: icp-company-search
provider: apollo
version: 0.1.0
auth:
  type: header
  name: X-Api-Key
  value: \${env:APOLLO_API_KEY}
endpoint:
  method: POST
  url: https://api.apollo.io/v1/mixed_companies/search
request:
  contentType: application/json
  bodyTemplate: |
    {
      "q_organization_keyword_tags": ["{{input.keywords}}"],
      "page": 1,
      "per_page": 5
    }
response:
  rootPath: organizations
  mappings:
    "companies[].name": "$.name"
    "companies[].domain": "$.primary_domain"
  errorEnvelope:
    matchPath: $.error
    messagePath: $.error
smoke_test:
  input:
    keywords: "saas"
    limit: 5
  expectNonEmpty:
    - "companies[0].domain"
`

const INVALID_YAML = `manifestVersion: 99
capability: foo
provider: bar
`

function makeFetch(map: Record<string, { status: number; body: string }>) {
  return (async (url: string | URL) => {
    const key = url.toString()
    const entry = map[key]
    if (!entry) {
      return new Response('not found', { status: 404 })
    }
    return new Response(entry.body, { status: entry.status })
  }) as typeof fetch
}

describe('provider:install', () => {
  let tmpHome: string
  let adaptersDir: string
  let configPath: string

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'yalc-provider-install-'))
    adaptersDir = join(tmpHome, '.gtm-os', 'adapters')
    configPath = join(tmpHome, '.gtm-os', 'config.yaml')
    mkdirSync(adaptersDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('resolves the default URL pattern from the GitHub raw source', async () => {
    const fetched: string[] = []
    const fetchImpl: typeof fetch = (async (url: string | URL) => {
      fetched.push(url.toString())
      return new Response(APOLLO_YAML, { status: 200 })
    }) as typeof fetch

    const result = await runProviderInstall('icp-company-search/apollo', {
      adaptersDir,
      configPath,
      fetchImpl,
      noPrompt: true,
      noPriorityUpdate: true,
    })

    expect(result.exitCode).toBe(0)
    expect(fetched).toEqual([
      'https://raw.githubusercontent.com/Othmane-Khadri/yalc-providers/main/manifests/icp-company-search/apollo.yaml',
    ])
  })

  it('writes the manifest to <adaptersDir>/<capability>-<provider>.yaml', async () => {
    const url =
      'https://raw.githubusercontent.com/Othmane-Khadri/yalc-providers/main/manifests/icp-company-search/apollo.yaml'
    const result = await runProviderInstall('icp-company-search/apollo', {
      adaptersDir,
      configPath,
      fetchImpl: makeFetch({ [url]: { status: 200, body: APOLLO_YAML } }),
      noPrompt: true,
      noPriorityUpdate: true,
    })
    expect(result.exitCode).toBe(0)
    const written = join(adaptersDir, 'icp-company-search-apollo.yaml')
    expect(existsSync(written)).toBe(true)
    expect(readFileSync(written, 'utf-8')).toBe(APOLLO_YAML)
    expect(result.output).toContain('icp-company-search-apollo.yaml')
    expect(result.output).toContain('APOLLO_API_KEY')
  })

  it('honors --source override (file:// URL)', async () => {
    // Drop the YAML on disk and point --source at it via the file: scheme.
    const localManifest = join(tmpHome, 'apollo.yaml')
    writeFileSync(localManifest, APOLLO_YAML, 'utf-8')
    const url = `file://${localManifest}`

    let observed = ''
    const fetchImpl: typeof fetch = (async (u: string | URL) => {
      observed = u.toString()
      return new Response(APOLLO_YAML, { status: 200 })
    }) as typeof fetch

    const result = await runProviderInstall('icp-company-search/apollo', {
      adaptersDir,
      configPath,
      sourceUrl: url,
      fetchImpl,
      noPrompt: true,
      noPriorityUpdate: true,
    })
    expect(result.exitCode).toBe(0)
    expect(observed).toBe(url)
  })

  it('refuses to overwrite an existing manifest without --force', async () => {
    const url =
      'https://raw.githubusercontent.com/Othmane-Khadri/yalc-providers/main/manifests/icp-company-search/apollo.yaml'
    const target = join(adaptersDir, 'icp-company-search-apollo.yaml')
    writeFileSync(target, '# pre-existing\n', 'utf-8')

    const result = await runProviderInstall('icp-company-search/apollo', {
      adaptersDir,
      configPath,
      fetchImpl: makeFetch({ [url]: { status: 200, body: APOLLO_YAML } }),
      noPrompt: true,
      noPriorityUpdate: true,
    })
    expect(result.exitCode).toBe(1)
    expect(result.output).toMatch(/already exists/)
    // File untouched
    expect(readFileSync(target, 'utf-8')).toBe('# pre-existing\n')
  })

  it('overwrites when --force is set', async () => {
    const url =
      'https://raw.githubusercontent.com/Othmane-Khadri/yalc-providers/main/manifests/icp-company-search/apollo.yaml'
    const target = join(adaptersDir, 'icp-company-search-apollo.yaml')
    writeFileSync(target, '# pre-existing\n', 'utf-8')

    const result = await runProviderInstall('icp-company-search/apollo', {
      adaptersDir,
      configPath,
      fetchImpl: makeFetch({ [url]: { status: 200, body: APOLLO_YAML } }),
      force: true,
      noPrompt: true,
      noPriorityUpdate: true,
    })
    expect(result.exitCode).toBe(0)
    expect(readFileSync(target, 'utf-8')).toBe(APOLLO_YAML)
  })

  it('exits non-zero with a useful message on schema validation failure', async () => {
    const url =
      'https://raw.githubusercontent.com/Othmane-Khadri/yalc-providers/main/manifests/icp-company-search/apollo.yaml'
    const result = await runProviderInstall('icp-company-search/apollo', {
      adaptersDir,
      configPath,
      fetchImpl: makeFetch({ [url]: { status: 200, body: INVALID_YAML } }),
      noPrompt: true,
      noPriorityUpdate: true,
    })
    expect(result.exitCode).toBe(1)
    expect(result.output).toMatch(/validation|schema|manifestVersion/i)
    // No file written on failure
    expect(existsSync(join(adaptersDir, 'icp-company-search-apollo.yaml'))).toBe(false)
  })

  it('exits non-zero on non-2xx fetch', async () => {
    const result = await runProviderInstall('icp-company-search/apollo', {
      adaptersDir,
      configPath,
      fetchImpl: makeFetch({}),
      noPrompt: true,
      noPriorityUpdate: true,
    })
    expect(result.exitCode).toBe(1)
    expect(result.output).toMatch(/404|fetch|not found/i)
  })

  it('rejects malformed capability/provider arg', async () => {
    const result = await runProviderInstall('not-a-valid-arg', {
      adaptersDir,
      configPath,
      fetchImpl: makeFetch({}),
      noPrompt: true,
      noPriorityUpdate: true,
    })
    expect(result.exitCode).toBe(1)
    expect(result.output).toMatch(/<capability>\/<provider>/)
  })

  it('updates config.yaml priority list when answer is yes (auto-confirmed)', async () => {
    writeFileSync(
      configPath,
      `notion:\n  campaigns_ds: ''\ncapabilities:\n  icp-company-search:\n    priority:\n      - crustdata\n`,
      'utf-8',
    )
    const url =
      'https://raw.githubusercontent.com/Othmane-Khadri/yalc-providers/main/manifests/icp-company-search/apollo.yaml'
    const result = await runProviderInstall('icp-company-search/apollo', {
      adaptersDir,
      configPath,
      fetchImpl: makeFetch({ [url]: { status: 200, body: APOLLO_YAML } }),
      noPrompt: true,
      autoConfirmPriority: true,
    })
    expect(result.exitCode).toBe(0)
    const updated = readFileSync(configPath, 'utf-8')
    // Apollo should be at front of priority list
    expect(updated).toMatch(/priority:\s*\n\s*-\s*apollo\s*\n\s*-\s*crustdata/)
  })

  it('creates capabilities section when missing and asked to update priority', async () => {
    writeFileSync(configPath, `notion:\n  campaigns_ds: ''\n`, 'utf-8')
    const url =
      'https://raw.githubusercontent.com/Othmane-Khadri/yalc-providers/main/manifests/icp-company-search/apollo.yaml'
    const result = await runProviderInstall('icp-company-search/apollo', {
      adaptersDir,
      configPath,
      fetchImpl: makeFetch({ [url]: { status: 200, body: APOLLO_YAML } }),
      noPrompt: true,
      autoConfirmPriority: true,
    })
    expect(result.exitCode).toBe(0)
    const updated = readFileSync(configPath, 'utf-8')
    expect(updated).toMatch(/capabilities:/)
    expect(updated).toMatch(/icp-company-search:/)
    expect(updated).toMatch(/-\s*apollo/)
  })

  it('does not duplicate a provider already at the front of priority', async () => {
    writeFileSync(
      configPath,
      `capabilities:\n  icp-company-search:\n    priority:\n      - apollo\n      - crustdata\n`,
      'utf-8',
    )
    const url =
      'https://raw.githubusercontent.com/Othmane-Khadri/yalc-providers/main/manifests/icp-company-search/apollo.yaml'
    const result = await runProviderInstall('icp-company-search/apollo', {
      adaptersDir,
      configPath,
      fetchImpl: makeFetch({ [url]: { status: 200, body: APOLLO_YAML } }),
      noPrompt: true,
      autoConfirmPriority: true,
      force: true,
    })
    expect(result.exitCode).toBe(0)
    const updated = readFileSync(configPath, 'utf-8')
    // Apollo should appear once
    const occurrences = updated.match(/-\s*apollo/g) ?? []
    expect(occurrences.length).toBe(1)
  })

  it('respects YALC_PROVIDERS_SOURCE env var when --source is not given', async () => {
    const envSource = 'https://raw.example.test/custom/providers/main/manifests'
    const url = `${envSource}/icp-company-search/apollo.yaml`
    let observed = ''
    const fetchImpl: typeof fetch = (async (u: string | URL) => {
      observed = u.toString()
      return new Response(APOLLO_YAML, { status: 200 })
    }) as typeof fetch

    const prev = process.env.YALC_PROVIDERS_SOURCE
    process.env.YALC_PROVIDERS_SOURCE = envSource
    try {
      const result = await runProviderInstall('icp-company-search/apollo', {
        adaptersDir,
        configPath,
        fetchImpl,
        noPrompt: true,
        noPriorityUpdate: true,
      })
      expect(result.exitCode).toBe(0)
      expect(observed).toBe(url)
    } finally {
      if (prev === undefined) delete process.env.YALC_PROVIDERS_SOURCE
      else process.env.YALC_PROVIDERS_SOURCE = prev
    }
  })

  it('e2e: install + adapters:list shows the installed provider', async () => {
    const url =
      'https://raw.githubusercontent.com/Othmane-Khadri/yalc-providers/main/manifests/icp-company-search/apollo.yaml'
    const installResult = await runProviderInstall('icp-company-search/apollo', {
      adaptersDir,
      configPath,
      fetchImpl: makeFetch({ [url]: { status: 200, body: APOLLO_YAML } }),
      noPrompt: true,
      noPriorityUpdate: true,
    })
    expect(installResult.exitCode).toBe(0)

    // Now load via adapters:list to confirm the manifest is discoverable.
    const { runAdaptersList } = await import('../adapters-list')
    const { resetDeclarativeLoaderCache } = await import(
      '../../../lib/providers/declarative/loader'
    )
    resetDeclarativeLoaderCache()
    const list = await runAdaptersList({ rootDir: adaptersDir, json: true })
    expect(list.exitCode).toBe(0)
    const parsed = JSON.parse(list.output) as {
      rows: Array<{ capability: string; provider: string; source: string }>
    }
    const found = parsed.rows.find(
      (r) => r.capability === 'icp-company-search' && r.provider === 'apollo',
    )
    expect(found).toBeDefined()
    expect(found?.source).toBe('user')
  })
})
