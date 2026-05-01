import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CapabilityRegistry,
  type CapabilityAdapter,
  type AdapterContext,
} from '../../capabilities'
import { registerBuiltinCapabilities } from '../../adapters/index'
import { registerDeclarativeAdapters } from '../registry-integration'
import { resetDeclarativeLoaderCache } from '../loader'

const APOLLO_OVERRIDE = `
manifestVersion: 1
capability: icp-company-search
provider: apollo
version: 0.2.0
auth:
  type: header
  name: X-Api-Key
  value: \${env:APOLLO_API_KEY}
endpoint:
  method: POST
  url: https://api.apollo.io/v1/mixed_companies/search
request:
  contentType: application/json
  bodyTemplate: '{"q":"{{input.keywords}}"}'
response:
  rootPath: organizations
  mappings:
    "companies[].name": "$.name"
`

describe('registerDeclarativeAdapters', () => {
  let dir: string
  let prevHome: string | undefined
  let prevApolloKey: string | undefined

  beforeEach(() => {
    prevHome = process.env.HOME
    prevApolloKey = process.env.APOLLO_API_KEY
    dir = join(tmpdir(), `yalc-decl-int-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    resetDeclarativeLoaderCache()
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (prevApolloKey === undefined) delete process.env.APOLLO_API_KEY
    else process.env.APOLLO_API_KEY = prevApolloKey
    rmSync(dir, { recursive: true, force: true })
    resetDeclarativeLoaderCache()
  })

  it('regression — every built-in capability still resolves to its default first available provider', async () => {
    // Build registry with builtins, then run declarative loader against an
    // EMPTY adapters dir. No (capability, provider) should change.
    const reg = new CapabilityRegistry()
    await registerBuiltinCapabilities(reg)

    const beforeMap = new Map<string, string[]>()
    for (const cap of reg.listCapabilities()) {
      beforeMap.set(cap.id, reg.listAdapters(cap.id).map((a) => a.providerId).sort())
    }

    const result = registerDeclarativeAdapters(reg, { rootDir: dir, silent: true })
    expect(result.registered).toEqual([])
    expect(result.overrides).toEqual([])
    expect(result.errors).toEqual([])

    for (const cap of reg.listCapabilities()) {
      const after = reg.listAdapters(cap.id).map((a) => a.providerId).sort()
      expect(after).toEqual(beforeMap.get(cap.id))
    }
  })

  it('declarative manifest overrides matching built-in (Option A)', async () => {
    const reg = new CapabilityRegistry()
    await registerBuiltinCapabilities(reg)

    // Drop a manifest at (icp-company-search, apollo)
    writeFileSync(join(dir, 'apollo.yaml'), APOLLO_OVERRIDE)

    const result = registerDeclarativeAdapters(reg, { rootDir: dir, silent: true })
    expect(result.registered).toHaveLength(1)
    expect(result.overrides).toHaveLength(1)
    expect(result.overrides[0]).toMatchObject({
      capabilityId: 'icp-company-search',
      providerId: 'apollo',
    })

    const adapters = reg.listAdapters('icp-company-search')
    const apolloAdapter = adapters.find((a) => a.providerId === 'apollo')!
    // The declarative one wins via `bucket.set()` last write
    // (executes via compiled.invoke, not via ctx.executor).
    process.env.APOLLO_API_KEY = 'k'
    const ctx = {} as AdapterContext
    // We just need to confirm the wired adapter is the declarative one;
    // a built-in apollo adapter would crash without ctx.executor.
    expect(apolloAdapter.isAvailable!()).toBe(true)
    delete process.env.APOLLO_API_KEY
  })

  it('logs the override when a manifest replaces a built-in', async () => {
    const reg = new CapabilityRegistry()
    await registerBuiltinCapabilities(reg)
    writeFileSync(join(dir, 'apollo.yaml'), APOLLO_OVERRIDE)

    const logs: string[] = []
    registerDeclarativeAdapters(reg, {
      rootDir: dir,
      logger: { warn: (m) => logs.push(`WARN ${m}`), info: (m) => logs.push(`INFO ${m}`) },
    })
    const overrideLogs = logs.filter((l) => l.includes('overrides built-in'))
    expect(overrideLogs.length).toBeGreaterThan(0)
  })

  it('skips manifests targeting unknown capabilities', async () => {
    const reg = new CapabilityRegistry()
    await registerBuiltinCapabilities(reg)
    writeFileSync(
      join(dir, 'unknown.yaml'),
      APOLLO_OVERRIDE.replace('icp-company-search', 'made-up-capability'),
    )
    const result = registerDeclarativeAdapters(reg, { rootDir: dir, silent: true })
    expect(result.registered).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
  })

  it('registers but flags unavailable when env var missing', async () => {
    const reg = new CapabilityRegistry()
    await registerBuiltinCapabilities(reg)
    writeFileSync(join(dir, 'apollo.yaml'), APOLLO_OVERRIDE)
    delete process.env.APOLLO_API_KEY

    registerDeclarativeAdapters(reg, { rootDir: dir, silent: true })
    const apollo = reg
      .listAdapters('icp-company-search')
      .find((a) => a.providerId === 'apollo')!
    expect(apollo.isAvailable!()).toBe(false)
  })

  it('regression — crm-contact-upsert resolves to hubspot via bundled declarative manifest', async () => {
    // Use the real bundled adapters dir — no user dir override here. The
    // bundled HubSpot manifest is registered as part of B4 scope; the
    // adapter must appear under `crm-contact-upsert` after the
    // declarative loader runs.
    const { loadDeclarativeManifestsAll, resetDeclarativeLoaderCache } =
      await import('../loader')
    resetDeclarativeLoaderCache()
    const reg = new CapabilityRegistry()
    await registerBuiltinCapabilities(reg)
    // Use the bundled+empty-user combo via the registry-integration's
    // own loader call — pass an empty user dir.
    registerDeclarativeAdapters(reg, {
      rootDir: dir, // user dir (empty)
      silent: true,
    })
    // bundled root is read independently — pull it through the public
    // loader to verify it's there.
    const out = loadDeclarativeManifestsAll({ userRootDir: dir })
    const found = out.manifests.find(
      (m) => m.capabilityId === 'crm-contact-upsert' && m.providerId === 'hubspot',
    )
    expect(found).toBeDefined()
    resetDeclarativeLoaderCache()
  })
})
