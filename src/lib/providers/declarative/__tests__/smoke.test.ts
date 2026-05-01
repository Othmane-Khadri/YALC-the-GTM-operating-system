import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runSmoke } from '../smoke'

const GREEN_MANIFEST = `
manifestVersion: 1
capability: icp-company-search
provider: apollo
version: 0.1.0
auth:
  type: header
  name: X-Api-Key
  value: \${env:APOLLO_API_KEY}
endpoint:
  method: POST
  url: https://api.apollo.io/v1/list
request:
  contentType: application/json
  bodyTemplate: '{"q":"{{input.keywords}}"}'
response:
  rootPath: organizations
  mappings:
    "companies[].name": "$.name"
    "companies[].domain": "$.primary_domain"
smoke_test:
  input:
    keywords: SaaS
  expectNonEmpty: [companies, "companies[0].domain"]
`

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('runSmoke', () => {
  let dir: string
  let prevKey: string | undefined
  beforeEach(() => {
    dir = join(tmpdir(), `yalc-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    prevKey = process.env.APOLLO_API_KEY
    process.env.APOLLO_API_KEY = 'k'
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (prevKey === undefined) delete process.env.APOLLO_API_KEY
    else process.env.APOLLO_API_KEY = prevKey
  })

  it('returns passed=true when expectNonEmpty paths are populated', async () => {
    const file = join(dir, 'apollo.yaml')
    writeFileSync(file, GREEN_MANIFEST)
    const fetchImpl = (async () =>
      jsonResponse({
        organizations: [{ name: 'Acme', primary_domain: 'acme.com' }],
      })) as typeof fetch
    const result = await runSmoke(file, { fetchImpl })
    expect(result.passed).toBe(true)
    expect(result.pathChecks.every((c) => c.ok)).toBe(true)
  })

  it('returns passed=false when an expected path is empty', async () => {
    const file = join(dir, 'apollo.yaml')
    writeFileSync(file, GREEN_MANIFEST)
    const fetchImpl = (async () =>
      jsonResponse({ organizations: [{ name: 'Acme' /* no domain */ }] })) as typeof fetch
    const result = await runSmoke(file, { fetchImpl })
    expect(result.passed).toBe(false)
    expect(result.pathChecks.find((c) => c.path === 'companies[0].domain')?.ok).toBe(false)
  })

  it('returns passed=false with structured error on vendor 5xx', async () => {
    const file = join(dir, 'apollo.yaml')
    writeFileSync(file, GREEN_MANIFEST)
    const fetchImpl = (async () => jsonResponse({ error: 'boom' }, 500)) as typeof fetch
    const result = await runSmoke(file, { fetchImpl })
    expect(result.passed).toBe(false)
    expect(result.error?.name).toBe('ProviderApiError')
  })

  it('returns passed=false with CompileError on bad manifest', async () => {
    const file = join(dir, 'bad.yaml')
    writeFileSync(file, 'manifestVersion: 99\n')
    const result = await runSmoke(file, { fetchImpl: (async () => jsonResponse({})) as typeof fetch })
    expect(result.passed).toBe(false)
    expect(result.error?.name).toMatch(/Validation|Compile/)
  })
})
