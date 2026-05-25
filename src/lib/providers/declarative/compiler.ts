/**
 * YAML manifest compiler.
 *
 * `compileManifest(raw, source)` parses a YAML string, validates it
 * against the manifestVersion 1 JSON Schema, statically analyses every
 * `{{var}}` placeholder (rooted in `input.*`, `env.*`, or `auth.*`),
 * records the env vars referenced in `auth.value` / `endpoint.url` /
 * `endpoint.queryTemplate` / `request.bodyTemplate` / `request.headers`,
 * and returns a `CompiledManifest` whose `invoke` runs the fetch +
 * mapping + pagination loop against a real or shimmed fetch.
 *
 * Errors are normalized to the existing `MissingApiKeyError`,
 * `ProviderApiError`, and the new `ManifestValidationError` so callers
 * (skills, the smoke runner, the registry integration) handle declarative
 * and built-in adapters identically.
 */

import yaml from 'js-yaml'
import Ajv, { type ValidateFunction } from 'ajv'
import schema from './schema.json' with { type: 'json' }
import type {
  CompiledManifest,
  FetchLike,
  ManifestEndpoint,
  ManifestPagination,
  ManifestRaw,
  ManifestRequest,
  ManifestResponse,
  ManifestStep,
} from './types.js'
import { ManifestValidationError } from './types.js'
import { MissingApiKeyError, ProviderApiError } from '../adapters/index.js'

const ajv = new Ajv({ allErrors: true, strict: false })
const validateManifest: ValidateFunction = ajv.compile(schema as object)

const ENV_REF = /\$\{env:([A-Z0-9_]+)\}/g
const PLACEHOLDER = /\{\{([^}]+)\}\}/g
const ALLOWED_ROOTS = new Set(['input', 'env', 'auth', 'steps'])

export interface CompileOptions {
  /** Fetch override for tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: FetchLike
}

export function compileManifest(
  raw: string,
  source: string,
  opts: CompileOptions = {},
): CompiledManifest {
  // 1. Parse YAML
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ManifestValidationError(source, [`yaml parse failed: ${msg}`])
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ManifestValidationError(source, ['expected a YAML object at the top level'])
  }

  // 2. Schema-validate
  if (!validateManifest(parsed)) {
    const issues = (validateManifest.errors ?? []).map(
      (e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`,
    )
    throw new ManifestValidationError(source, issues.length > 0 ? issues : ['unknown schema error'])
  }
  const manifest = parsed as ManifestRaw

  // 3. Validate placeholder roots + collect env refs
  const envRefs = new Set<string>()
  const allTemplates = collectTemplateStrings(manifest)
  for (const tpl of allTemplates) {
    for (const m of tpl.matchAll(PLACEHOLDER)) {
      const expr = m[1].trim()
      const root = parseExprRoot(expr)
      if (!ALLOWED_ROOTS.has(root)) {
        throw new ManifestValidationError(source, [
          `unknown template root in {{${expr}}} — allowed: input, env, auth`,
        ])
      }
    }
    for (const m of tpl.matchAll(ENV_REF)) {
      envRefs.add(m[1])
    }
  }

  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike | undefined)
  const compiled: CompiledManifest = {
    capabilityId: manifest.capability,
    providerId: manifest.provider,
    version: manifest.version,
    envVars: Array.from(envRefs).sort(),
    source,
    raw: manifest,
    invoke: async (input: unknown) => {
      if (!fetchImpl) {
        throw new ProviderApiError(manifest.provider, 'no global fetch available; pass fetchImpl')
      }
      return executeManifest(manifest, input, fetchImpl)
    },
  }
  return compiled
}

// ─── Static template analysis ───────────────────────────────────────────────

function collectTemplateStrings(m: ManifestRaw): string[] {
  const out: string[] = []
  if (m.auth?.value) out.push(m.auth.value)
  if (m.endpoint) collectEndpointTemplates(m.endpoint, m.request, out)
  if (m.steps) {
    for (const step of m.steps) collectEndpointTemplates(step.endpoint, step.request, out)
  }
  return out
}

function collectEndpointTemplates(
  endpoint: ManifestEndpoint,
  request: ManifestRequest | undefined,
  out: string[],
): void {
  out.push(endpoint.url)
  if (endpoint.queryTemplate) {
    for (const v of Object.values(endpoint.queryTemplate)) out.push(v)
  }
  if (request) {
    if (request.bodyTemplate) out.push(request.bodyTemplate)
    if (request.headers) {
      for (const v of Object.values(request.headers)) out.push(v)
    }
  }
}

function parseExprRoot(expr: string): string {
  // Strip filters: "input.x | default: 5" -> "input.x"
  const head = expr.split('|')[0].trim()
  const root = head.split(/[.\[]/)[0].trim()
  return root
}

// ─── Runtime execution ──────────────────────────────────────────────────────

async function executeManifest(
  m: ManifestRaw,
  input: unknown,
  fetchImpl: FetchLike,
): Promise<unknown> {
  // Env-var resolution + missing check
  const envScope: Record<string, string> = {}
  const refs = collectEnvRefs(m)
  for (const v of refs) {
    const got = process.env[v]
    if (got === undefined || got === '') {
      throw new MissingApiKeyError(m.provider, v)
    }
    envScope[v] = got
  }

  // Build auth scope: resolve `auth.value` if present
  const authScope: Record<string, string> = {}
  if (m.auth.value !== undefined) {
    authScope.value = renderEnvRefs(m.auth.value, envScope)
  }
  if (m.auth.name) authScope.name = m.auth.name
  authScope.type = m.auth.type

  const scope: TemplateScope = {
    input: input ?? {},
    env: envScope,
    auth: authScope,
    steps: {},
  }

  if (m.steps && m.steps.length > 0) {
    return executeSteps(m, scope, fetchImpl, m.steps)
  }
  if (!m.endpoint || !m.response) {
    throw new ProviderApiError(
      m.provider,
      'manifest is missing both top-level endpoint/response and a steps[] array',
    )
  }
  if (m.pagination) {
    return executePaginated(m, scope, fetchImpl, m.pagination)
  }
  return executeOnce(m.endpoint, m.request, m.response, m.provider, scope, fetchImpl, m.auth)
}

function collectEnvRefs(m: ManifestRaw): string[] {
  const set = new Set<string>()
  for (const tpl of collectTemplateStrings(m)) {
    for (const match of tpl.matchAll(ENV_REF)) set.add(match[1])
  }
  return Array.from(set)
}

async function executeOnce(
  endpoint: ManifestEndpoint,
  request: ManifestRequest | undefined,
  response: ManifestResponse,
  providerId: string,
  scope: TemplateScope,
  fetchImpl: FetchLike,
  authSpec?: { type: string; name?: string; value?: string },
): Promise<unknown> {
  const { url, headers, body } = buildRequest(endpoint, request, authSpec, scope)
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: endpoint.method,
      headers,
      body,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ProviderApiError(providerId, `network error: ${msg}`)
  }

  let parsed: unknown = null
  const text = await res.text()
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }

  if (!res.ok) {
    const message = extractErrorMessage(response.errorEnvelope?.messagePath, parsed) ??
      `HTTP ${res.status}`
    throw new ProviderApiError(providerId, message, res.status)
  }
  if (matchesErrorEnvelope(response, parsed)) {
    const message = extractErrorMessage(response.errorEnvelope?.messagePath, parsed) ?? 'vendor error'
    throw new ProviderApiError(providerId, message, res.status)
  }

  return projectMappings(response, parsed)
}

/**
 * Execute a chain of HTTP calls. Each step's projected output is
 * accumulated into `scope.steps[id]` so subsequent steps can reference
 * earlier step output via `{{steps.<id>.<path>}}` placeholders. The final
 * step's projected output is the manifest's return value.
 *
 * Step ids must be unique within a manifest (enforced here, not in the
 * JSON schema, so we get a useful error message that names the duplicate).
 */
async function executeSteps(
  m: ManifestRaw,
  scope: TemplateScope,
  fetchImpl: FetchLike,
  steps: ManifestStep[],
): Promise<unknown> {
  const seen = new Set<string>()
  let lastOutput: unknown = null
  for (const step of steps) {
    if (seen.has(step.id)) {
      throw new ProviderApiError(m.provider, `duplicate step id '${step.id}'`)
    }
    seen.add(step.id)
    const projected = await executeOnce(
      step.endpoint,
      step.request,
      step.response,
      m.provider,
      scope,
      fetchImpl,
      m.auth,
    )
    scope.steps[step.id] = projected
    lastOutput = projected
  }
  return lastOutput
}

interface TemplateScope {
  input: unknown
  env: Record<string, string>
  auth: Record<string, string>
  /** Projected outputs from prior steps in a multi-step manifest, keyed by step id. */
  steps: Record<string, unknown>
}

function buildRequest(
  endpoint: ManifestEndpoint,
  request: ManifestRequest | undefined,
  authSpec: { type: string; name?: string; value?: string } | undefined,
  scope: TemplateScope,
): { url: string; headers: Record<string, string>; body: string | undefined } {
  let url = renderTemplate(endpoint.url, scope)
  if (endpoint.queryTemplate) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(endpoint.queryTemplate)) {
      const rendered = renderTemplate(v, scope)
      if (rendered !== '') qs.set(k, rendered)
    }
    const qsStr = qs.toString()
    if (qsStr) {
      url += url.includes('?') ? `&${qsStr}` : `?${qsStr}`
    }
  }

  const headers: Record<string, string> = {}
  if (request?.headers) {
    for (const [k, v] of Object.entries(request.headers)) {
      headers[k] = renderTemplate(v, scope)
    }
  }

  // Auth header injection (applies to every step in a multi-step manifest)
  if (authSpec) {
    if (authSpec.type === 'header' && authSpec.name && authSpec.value !== undefined) {
      headers[authSpec.name] = renderEnvRefs(authSpec.value, scope.env)
    } else if (authSpec.type === 'bearer' && authSpec.value !== undefined) {
      headers['Authorization'] = `Bearer ${renderEnvRefs(authSpec.value, scope.env)}`
    } else if (authSpec.type === 'query' && authSpec.name && authSpec.value !== undefined) {
      const qsAdd = `${encodeURIComponent(authSpec.name)}=${encodeURIComponent(renderEnvRefs(authSpec.value, scope.env))}`
      url += url.includes('?') ? `&${qsAdd}` : `?${qsAdd}`
    }
  }

  let body: string | undefined
  if (request?.bodyTemplate) {
    if (request.contentType) headers['Content-Type'] ??= request.contentType
    body = renderTemplate(request.bodyTemplate, scope)
  }

  return { url, headers, body }
}

// ─── Template rendering ─────────────────────────────────────────────────────

function renderEnvRefs(template: string, envScope: Record<string, string>): string {
  return template.replace(ENV_REF, (_, name) => envScope[name] ?? '')
}

function renderTemplate(template: string, scope: TemplateScope): string {
  // First: env refs (so a single value can mix `${env:X}` and `{{...}}`)
  let out = template.replace(ENV_REF, (_, name) => {
    const got = scope.env[name]
    return got ?? ''
  })
  // Then: {{ scope.path | filter }}
  out = out.replace(PLACEHOLDER, (_, expr) => {
    const v = evaluatePlaceholder(expr, scope)
    return v == null ? '' : String(v)
  })
  return out
}

function evaluatePlaceholder(expr: string, scope: TemplateScope): unknown {
  const parts = expr.split('|').map((s) => s.trim())
  const path = parts[0]
  const filters = parts.slice(1)
  let value: unknown = readPath(path, scope)
  for (const f of filters) {
    value = applyFilter(value, f)
  }
  return value
}

function applyFilter(value: unknown, filter: string): unknown {
  // `default: 25`, `default: "x"`, `json`
  if (filter === 'json') {
    return JSON.stringify(value)
  }
  const m = /^default\s*:\s*(.*)$/.exec(filter)
  if (m) {
    if (value !== undefined && value !== null && value !== '') return value
    return parseLiteral(m[1].trim())
  }
  return value
}

function parseLiteral(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1)
  }
  return raw
}

function readPath(path: string, scope: TemplateScope): unknown {
  const root = path.split(/[.\[]/)[0]
  let base: unknown
  if (root === 'input') base = scope.input
  else if (root === 'env') base = scope.env
  else if (root === 'auth') base = scope.auth
  else if (root === 'steps') base = scope.steps
  else return undefined
  // remainder is everything after the root
  const rest = path.slice(root.length)
  return walkPath(base, rest)
}

function walkPath(value: unknown, rest: string): unknown {
  // rest looks like "" or ".foo.bar[0].baz"
  if (rest === '') return value
  // Tokenize ".key" and "[idx]"
  const tokens: Array<string | number> = []
  let i = 0
  while (i < rest.length) {
    if (rest[i] === '.') {
      let j = i + 1
      while (j < rest.length && rest[j] !== '.' && rest[j] !== '[') j++
      tokens.push(rest.slice(i + 1, j))
      i = j
    } else if (rest[i] === '[') {
      const close = rest.indexOf(']', i)
      if (close === -1) return undefined
      const idx = rest.slice(i + 1, close).trim()
      tokens.push(/^\d+$/.test(idx) ? Number(idx) : idx)
      i = close + 1
    } else {
      i++
    }
  }
  let cur: unknown = value
  for (const t of tokens) {
    if (cur == null) return undefined
    if (typeof t === 'number') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[t]
    } else {
      if (typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[t]
    }
  }
  return cur
}

// ─── Response mapping (JSONPath-lite) ───────────────────────────────────────

function applyRootPath(rootPath: string | undefined, body: unknown): unknown {
  if (!rootPath || rootPath === '$' || rootPath === '') return body
  // Treat as a dotted path on the body, optionally with leading "$.".
  const stripped = rootPath.startsWith('$.') ? rootPath.slice(2) : rootPath
  return walkPath(body, '.' + stripped)
}

/**
 * `mappings` projects the vendor body onto the capability's output shape.
 *
 * Source paths:
 *   - "$.field"        → look up `field` on the current "row" object
 *   - "$.foo.bar"      → nested
 *   - null             → emit a literal null
 *   - "https://$.url"  → prefix literal kept; first `$.X` substituted
 *   - "$.x == 'y'"     → boolean: equality on path
 *
 * Target paths:
 *   - "name"             → top-level scalar
 *   - "companies[].name" → push one element per row from rootPath array
 */
function projectMappings(spec: ManifestResponse, body: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const root = applyRootPath(spec.rootPath, body)
  const arrayKeys = new Map<string, string[]>() // arrayName -> field list
  // Group mappings by array name (foo[].bar) vs scalar
  const scalarMappings: Array<[string, string | null]> = []
  for (const [target, source] of Object.entries(spec.mappings)) {
    const m = /^([A-Za-z0-9_-]+)\[\]\.(.+)$/.exec(target)
    if (m) {
      const arr = m[1]
      if (!arrayKeys.has(arr)) arrayKeys.set(arr, [])
      arrayKeys.get(arr)!.push(target)
    } else {
      scalarMappings.push([target, source])
    }
  }

  // Scalar projections operate against the top-level body OR root
  for (const [target, source] of scalarMappings) {
    result[target] = resolveSourceValue(source, root, body)
  }

  // Array projections: iterate rows from `root` (must be array)
  for (const [arrName, targetKeys] of arrayKeys) {
    const rows = Array.isArray(root) ? root : []
    const arr: Record<string, unknown>[] = []
    for (const row of rows) {
      const out: Record<string, unknown> = {}
      for (const t of targetKeys) {
        const m = /^([A-Za-z0-9_-]+)\[\]\.(.+)$/.exec(t)!
        const field = m[2]
        const sourceExpr = spec.mappings[t] ?? null
        out[field] = resolveSourceValue(sourceExpr, row, body)
      }
      arr.push(out)
    }
    result[arrName] = arr
  }

  return result
}

function resolveSourceValue(
  source: string | null,
  row: unknown,
  rootBody: unknown,
): unknown {
  if (source === null) return null
  // Equality check: "$.x == 'y'"
  const eq = /^(.+?)\s*==\s*['"]([^'"]*)['"]\s*$/.exec(source)
  if (eq) {
    const lhs = lookupSource(eq[1].trim(), row, rootBody)
    return lhs === eq[2]
  }
  // Prefix literal pattern: "https://$.url" or "v1/$.id"
  const dollarIdx = source.indexOf('$.')
  if (dollarIdx > 0) {
    const prefix = source.slice(0, dollarIdx)
    const path = source.slice(dollarIdx)
    const v = lookupSource(path, row, rootBody)
    return v == null ? null : `${prefix}${v}`
  }
  if (source.startsWith('$.') || source === '$') {
    return lookupSource(source, row, rootBody)
  }
  // Plain literal (rare).
  return source
}

function lookupSource(path: string, row: unknown, rootBody: unknown): unknown {
  if (path === '$') return row
  if (path.startsWith('$.')) {
    return walkPath(row, '.' + path.slice(2))
  }
  // Fallback: treat as a path on rootBody
  return walkPath(rootBody, '.' + path)
}

// ─── Error envelope detection ───────────────────────────────────────────────

function matchesErrorEnvelope(spec: ManifestResponse, body: unknown): boolean {
  const env = spec.errorEnvelope
  if (!env || !env.matchPath) return false
  const v = lookupSource(env.matchPath, body, body)
  if (env.matchValue !== undefined) return v === env.matchValue
  return v != null && v !== ''
}

function extractErrorMessage(messagePath: string | undefined, body: unknown): string | null {
  if (!messagePath) return null
  const v = lookupSource(messagePath, body, body)
  if (v == null) return null
  return String(v)
}

// ─── Pagination ─────────────────────────────────────────────────────────────

async function executePaginated(
  m: ManifestRaw,
  scope: TemplateScope,
  fetchImpl: FetchLike,
  pag: ManifestPagination,
): Promise<Record<string, unknown>> {
  if (!m.endpoint || !m.response) {
    throw new ProviderApiError(
      m.provider,
      'pagination requires top-level endpoint/response (multi-step + pagination not supported in v1)',
    )
  }
  // Page state injected as scope.input.__page__ / __cursor__
  const merged: Record<string, unknown[]> = {}
  let scalarSeed: Record<string, unknown> | null = null
  let pageNum = 1
  let cursor: string | null = null
  let totalItems = 0

  while (totalItems < pag.limit) {
    const pagedInput = {
      ...(scope.input as object),
      __page__: pageNum,
      __cursor__: cursor,
    }
    const pagedScope: TemplateScope = { ...scope, input: pagedInput }
    const projected = (await executeOnce(
      m.endpoint,
      m.request,
      m.response,
      m.provider,
      pagedScope,
      fetchImpl,
      m.auth,
    )) as Record<string, unknown>
    if (scalarSeed === null) {
      scalarSeed = {}
      for (const [k, v] of Object.entries(projected)) {
        if (!Array.isArray(v)) scalarSeed[k] = v
      }
    }

    let pageItemCount = 0
    for (const [k, v] of Object.entries(projected)) {
      if (Array.isArray(v)) {
        const room = pag.limit - totalItems
        const take = v.slice(0, Math.max(room, 0))
        if (!merged[k]) merged[k] = []
        merged[k].push(...take)
        pageItemCount += take.length
      }
    }
    totalItems += pageItemCount
    if (pageItemCount === 0) break
    if (pag.style === 'page') {
      pageNum += 1
    } else {
      // cursor — fetch raw body to read cursorPath
      // We rebuild raw body fetch separately for the cursor since
      // projection threw away non-mapped fields. For v1 simplicity: stop
      // when pageItemCount === 0.
      if (!pag.cursorPath) break
      // The cursor is read from the projected scalars if user mapped it.
      const next = projected[pag.cursorPath]
      if (!next || typeof next !== 'string') break
      cursor = next
    }
  }
  return { ...(scalarSeed ?? {}), ...merged }
}
