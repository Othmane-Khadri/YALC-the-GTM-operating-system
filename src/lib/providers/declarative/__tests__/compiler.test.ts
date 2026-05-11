import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { compileManifest } from '../compiler'
import { ManifestValidationError } from '../types'
import { MissingApiKeyError, ProviderApiError } from '../../adapters/index'

const VALID_MANIFEST = `
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
  url: https://api.apollo.io/v1/mixed_companies/search
request:
  contentType: application/json
  bodyTemplate: |
    {"keywords": "{{input.keywords}}", "per_page": {{input.limit | default: 25}}}
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
    keywords: SaaS
    limit: 5
  expectNonEmpty: [companies, "companies[0].domain"]
`

function makeFetch(rows: Array<[Response | (() => Response), unknown?]> | (() => Response)) {
  if (typeof rows === 'function') {
    return async () => rows()
  }
  let i = 0
  return async () => {
    const next = rows[i++]
    if (!next) throw new Error('fetch called too many times')
    const r = next[0]
    return typeof r === 'function' ? r() : r
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('compileManifest', () => {
  let prevEnv: string | undefined
  beforeEach(() => {
    prevEnv = process.env.APOLLO_API_KEY
    process.env.APOLLO_API_KEY = 'test-key'
  })
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.APOLLO_API_KEY
    else process.env.APOLLO_API_KEY = prevEnv
  })

  it('schema validation rejects unknown top-level fields', () => {
    const bad = VALID_MANIFEST + '\nbogusField: nope\n'
    expect(() => compileManifest(bad, 'inline')).toThrow(ManifestValidationError)
  })

  it('schema validation rejects missing required fields', () => {
    const bad = `
manifestVersion: 1
capability: foo
provider: bar
auth:
  type: bearer
endpoint:
  method: GET
  url: http://example.com
response:
  mappings: {}
`
    // missing `version`
    expect(() => compileManifest(bad, 'inline')).toThrow(ManifestValidationError)
  })

  it('schema validation rejects bad manifestVersion', () => {
    const bad = VALID_MANIFEST.replace('manifestVersion: 1', 'manifestVersion: 2')
    expect(() => compileManifest(bad, 'inline')).toThrow(ManifestValidationError)
  })

  it('records env-var references on the compiled manifest', () => {
    const compiled = compileManifest(VALID_MANIFEST, 'inline')
    expect(compiled.envVars).toEqual(['APOLLO_API_KEY'])
    expect(compiled.capabilityId).toBe('icp-company-search')
    expect(compiled.providerId).toBe('apollo')
  })

  it('rejects unknown template roots at compile time', () => {
    const bad = VALID_MANIFEST.replace('{{input.keywords}}', '{{nope.keywords}}')
    expect(() => compileManifest(bad, 'inline')).toThrow(ManifestValidationError)
  })

  it('substitutes input.* in body and url template + projects nested arrays', async () => {
    let receivedBody = ''
    const fetchImpl = (async (_url: unknown, init: any) => {
      receivedBody = init?.body ?? ''
      return jsonResponse({
        organizations: [
          { name: 'Acme', primary_domain: 'acme.com' },
          { name: 'Globex', primary_domain: 'globex.com' },
        ],
      })
    }) as typeof fetch
    const compiled = compileManifest(VALID_MANIFEST, 'inline', { fetchImpl })
    const out = (await compiled.invoke({ keywords: 'SaaS', limit: 5 })) as { companies: any[] }
    expect(out.companies.length).toBe(2)
    expect(out.companies[0]).toEqual({ name: 'Acme', domain: 'acme.com' })
    expect(receivedBody).toContain('"keywords": "SaaS"')
    expect(receivedBody).toContain('"per_page": 5')
  })

  it('applies default filter when input value missing', async () => {
    let receivedBody = ''
    const fetchImpl = (async (_url: unknown, init: any) => {
      receivedBody = init?.body ?? ''
      return jsonResponse({ organizations: [] })
    }) as typeof fetch
    const compiled = compileManifest(VALID_MANIFEST, 'inline', { fetchImpl })
    await compiled.invoke({ keywords: 'AI' })
    expect(receivedBody).toContain('"per_page": 25')
  })

  it('throws MissingApiKeyError with the right env var name when not set', async () => {
    delete process.env.APOLLO_API_KEY
    const compiled = compileManifest(VALID_MANIFEST, 'inline', {
      fetchImpl: (async () => jsonResponse({})) as typeof fetch,
    })
    await expect(compiled.invoke({ keywords: 'x' })).rejects.toBeInstanceOf(MissingApiKeyError)
    try {
      await compiled.invoke({ keywords: 'x' })
    } catch (err) {
      expect((err as MissingApiKeyError).envVar).toBe('APOLLO_API_KEY')
      expect((err as MissingApiKeyError).providerId).toBe('apollo')
    }
  })

  it('translates non-2xx into ProviderApiError', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'rate limited' }, 429)) as typeof fetch
    const compiled = compileManifest(VALID_MANIFEST, 'inline', { fetchImpl })
    await expect(compiled.invoke({ keywords: 'x' })).rejects.toBeInstanceOf(ProviderApiError)
  })

  it('translates error-envelope match into ProviderApiError on 2xx body', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'bad input' })) as typeof fetch
    const compiled = compileManifest(VALID_MANIFEST, 'inline', { fetchImpl })
    await expect(compiled.invoke({ keywords: 'x' })).rejects.toMatchObject({
      name: 'ProviderApiError',
      message: expect.stringContaining('bad input'),
    })
  })

  it('sends auth header when type=header', async () => {
    let captured: Record<string, string> | undefined
    const fetchImpl = (async (_url: unknown, init: any) => {
      captured = init?.headers ?? {}
      return jsonResponse({ organizations: [] })
    }) as typeof fetch
    const compiled = compileManifest(VALID_MANIFEST, 'inline', { fetchImpl })
    await compiled.invoke({ keywords: 'x' })
    expect(captured?.['X-Api-Key']).toBe('test-key')
  })

  it('supports bearer auth with env interpolation', async () => {
    const manifest = `
manifestVersion: 1
capability: icp-company-search
provider: vendorx
version: 0.1.0
auth:
  type: bearer
  value: \${env:APOLLO_API_KEY}
endpoint:
  method: GET
  url: https://example.com/v1/list
response:
  rootPath: items
  mappings:
    "companies[].name": "$.name"
`
    let captured: Record<string, string> | undefined
    const fetchImpl = (async (_url: unknown, init: any) => {
      captured = init?.headers ?? {}
      return jsonResponse({ items: [{ name: 'Foo' }] })
    }) as typeof fetch
    const compiled = compileManifest(manifest, 'inline', { fetchImpl })
    const out = (await compiled.invoke({})) as { companies: any[] }
    expect(captured?.['Authorization']).toBe('Bearer test-key')
    expect(out.companies[0].name).toBe('Foo')
  })

  it('renders queryTemplate into the URL', async () => {
    const manifest = `
manifestVersion: 1
capability: people-enrich
provider: pdl
version: 0.1.0
auth:
  type: header
  name: X-Api-Key
  value: \${env:APOLLO_API_KEY}
endpoint:
  method: GET
  url: https://api.example.com/enrich
  queryTemplate:
    first_name: "{{input.firstname}}"
    company: "{{input.company}}"
response:
  rootPath: data
  mappings:
    "results[].email": "$.email"
`
    let capturedUrl = ''
    const fetchImpl = (async (url: any) => {
      capturedUrl = String(url)
      return jsonResponse({ data: [{ email: 'a@b.com' }] })
    }) as typeof fetch
    const compiled = compileManifest(manifest, 'inline', { fetchImpl })
    await compiled.invoke({ firstname: 'Marc', company: 'Salesforce' })
    expect(capturedUrl).toContain('first_name=Marc')
    expect(capturedUrl).toContain('company=Salesforce')
  })

  it('paginates until limit is reached', async () => {
    const manifest = `
manifestVersion: 1
capability: icp-company-search
provider: vendor-page
version: 0.1.0
auth:
  type: header
  name: X-Api-Key
  value: \${env:APOLLO_API_KEY}
endpoint:
  method: GET
  url: https://example.com/list?page={{input.__page__}}
response:
  rootPath: rows
  mappings:
    "companies[].name": "$.name"
pagination:
  style: page
  pageParam: page
  limit: 5
`
    let calls = 0
    const pages = [
      [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
      [{ name: 'd' }, { name: 'e' }, { name: 'f' }],
      [],
    ]
    const fetchImpl = (async (_url: any) => {
      const page = pages[calls++] ?? []
      return jsonResponse({ rows: page })
    }) as typeof fetch
    const compiled = compileManifest(manifest, 'inline', { fetchImpl })
    const out = (await compiled.invoke({})) as { companies: any[] }
    // limit=5 means we collect 3 from page 1 + 2 from page 2 = 5
    expect(out.companies.map((c) => c.name)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
