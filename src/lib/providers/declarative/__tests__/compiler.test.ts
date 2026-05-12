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

  // ─── Multi-step manifests ─────────────────────────────────────────────────

  describe('multi-step manifests', () => {
    const MATCH_THEN_ENRICH = `
manifestVersion: 1
capability: people-enrich
provider: explorium
version: 0.1.0
auth:
  type: header
  name: api_key
  value: \${env:APOLLO_API_KEY}
steps:
  - id: match
    endpoint:
      method: POST
      url: https://api.example.com/v1/match
    request:
      contentType: application/json
      bodyTemplate: |
        {"email": "{{input.email}}"}
    response:
      rootPath: matched[0]
      mappings:
        "prospect_id": "$.id"
  - id: enrich
    endpoint:
      method: POST
      url: https://api.example.com/v1/enrich
    request:
      contentType: application/json
      bodyTemplate: |
        {"id": "{{steps.match.prospect_id}}"}
    response:
      rootPath: data
      mappings:
        "results[].email": "$.professional_email"
        "results[].phone": "$.mobile_phone"
`

    it('chains two HTTP calls and threads step output into the next request', async () => {
      const calls: Array<{ url: string; body: any }> = []
      const fetchImpl = (async (url: string, init: any) => {
        calls.push({ url, body: JSON.parse(init.body) })
        if (calls.length === 1) {
          return jsonResponse({ matched: [{ id: 'pid-123' }] })
        }
        return jsonResponse({ data: [{ professional_email: 'jane@x.com', mobile_phone: '+15551234' }] })
      }) as typeof fetch
      const compiled = compileManifest(MATCH_THEN_ENRICH, 'inline', { fetchImpl })
      const out = (await compiled.invoke({ email: 'jane@x.com' })) as { results: any[] }
      expect(calls).toHaveLength(2)
      expect(calls[0].url).toBe('https://api.example.com/v1/match')
      expect(calls[0].body).toEqual({ email: 'jane@x.com' })
      expect(calls[1].url).toBe('https://api.example.com/v1/enrich')
      expect(calls[1].body).toEqual({ id: 'pid-123' })
      expect(out.results[0]).toEqual({ email: 'jane@x.com', phone: '+15551234' })
    })

    it('applies the manifest auth to every step', async () => {
      const headersSeen: Array<Record<string, string>> = []
      const fetchImpl = (async (_url: string, init: any) => {
        headersSeen.push(init.headers)
        return jsonResponse(headersSeen.length === 1 ? { matched: [{ id: 'p1' }] } : { data: [{}] })
      }) as typeof fetch
      const compiled = compileManifest(MATCH_THEN_ENRICH, 'inline', { fetchImpl })
      await compiled.invoke({ email: 'a@b.c' })
      expect(headersSeen[0]['api_key']).toBe('test-key')
      expect(headersSeen[1]['api_key']).toBe('test-key')
    })

    it('aborts the chain when an early step returns a vendor error', async () => {
      const manifest = `
manifestVersion: 1
capability: people-enrich
provider: explorium
version: 0.1.0
auth: { type: none }
steps:
  - id: match
    endpoint:
      method: POST
      url: https://api.example.com/v1/match
    response:
      rootPath: matched[0]
      mappings:
        "prospect_id": "$.id"
      errorEnvelope:
        matchPath: $.error
        messagePath: $.error
  - id: enrich
    endpoint:
      method: POST
      url: https://api.example.com/v1/enrich
    response:
      mappings:
        "results[].email": "$.x"
`
      let calls = 0
      const fetchImpl = (async () => {
        calls++
        return jsonResponse({ error: 'no match' })
      }) as typeof fetch
      const compiled = compileManifest(manifest, 'inline', { fetchImpl })
      await expect(compiled.invoke({})).rejects.toMatchObject({
        name: 'ProviderApiError',
        message: expect.stringContaining('no match'),
      })
      // Second step must not run after the first errors out.
      expect(calls).toBe(1)
    })

    it('rejects manifests with both top-level endpoint and steps', () => {
      const bad = `
manifestVersion: 1
capability: foo
provider: bar
version: 0.1.0
auth: { type: none }
endpoint: { method: GET, url: https://x.com }
response:
  mappings: { "x": "$.x" }
steps:
  - id: a
    endpoint: { method: GET, url: https://y.com }
    response:
      mappings: { "x": "$.x" }
`
      expect(() => compileManifest(bad, 'inline')).toThrow(ManifestValidationError)
    })

    it('rejects manifests with duplicate step ids at runtime', async () => {
      const bad = `
manifestVersion: 1
capability: foo
provider: bar
version: 0.1.0
auth: { type: none }
steps:
  - id: same
    endpoint: { method: GET, url: https://x.com }
    response:
      mappings: { "v": "$.x" }
  - id: same
    endpoint: { method: GET, url: https://x.com }
    response:
      mappings: { "v": "$.x" }
`
      const fetchImpl = (async () => jsonResponse({ x: 1 })) as typeof fetch
      const compiled = compileManifest(bad, 'inline', { fetchImpl })
      await expect(compiled.invoke({})).rejects.toMatchObject({
        name: 'ProviderApiError',
        message: expect.stringContaining("duplicate step id 'same'"),
      })
    })

    it('rejects unknown {{steps.*}} template references at compile time', () => {
      const bad = `
manifestVersion: 1
capability: foo
provider: bar
version: 0.1.0
auth: { type: none }
steps:
  - id: a
    endpoint:
      method: POST
      url: https://x.com/{{bogus.field}}
    response:
      mappings: { "v": "$.x" }
`
      expect(() => compileManifest(bad, 'inline')).toThrow(/unknown template root/)
    })
  })
})
