/**
 * Types for the declarative adapter manifest v1.
 *
 * Manifests live at `~/.gtm-os/adapters/<capability>-<provider>.yaml`.
 * The compiler turns a YAML string into a `CompiledManifest`, which the
 * registry integration wraps in a `CapabilityAdapter` so declarative
 * providers slot into the same priority resolution as built-in TS ones.
 */

import type { AdapterContext } from '../capabilities.js'

export type AuthType = 'header' | 'query' | 'bearer' | 'none'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export interface ManifestAuth {
  type: AuthType
  name?: string
  value?: string
}

export interface ManifestEndpoint {
  method: HttpMethod
  url: string
  queryTemplate?: Record<string, string>
}

export interface ManifestRequest {
  headers?: Record<string, string>
  bodyTemplate?: string
  contentType?: string
}

export interface ManifestErrorEnvelope {
  matchPath?: string
  matchValue?: unknown
  messagePath?: string
}

export interface ManifestResponse {
  rootPath?: string
  mappings: Record<string, string | null>
  errorEnvelope?: ManifestErrorEnvelope
}

export interface ManifestPagination {
  style: 'cursor' | 'page'
  pageParam?: string
  cursorPath?: string
  limit: number
}

export interface ManifestSmokeTest {
  input: unknown
  expectNonEmpty?: string[]
}

export interface ManifestRaw {
  manifestVersion: number
  capability: string
  provider: string
  version: string
  auth: ManifestAuth
  endpoint: ManifestEndpoint
  request?: ManifestRequest
  response: ManifestResponse
  pagination?: ManifestPagination
  rateLimit?: Record<string, unknown>
  smoke_test?: ManifestSmokeTest
}

/**
 * Compiled, ready-to-execute representation of a declarative adapter.
 * `invoke` takes an input matching the capability's input schema and
 * returns a value matching the capability's output schema, OR throws
 * `MissingApiKeyError` / `ProviderApiError` / `ManifestValidationError`.
 */
export interface CompiledManifest {
  capabilityId: string
  providerId: string
  version: string
  /** Env vars referenced by `${env:VAR}` interpolation in auth/endpoint/headers/body. */
  envVars: string[]
  /** Source path the manifest was loaded from (for diagnostics). */
  source: string
  /** Original raw manifest (for the smoke runner). */
  raw: ManifestRaw
  invoke(input: unknown, ctx?: AdapterContext): Promise<unknown>
}

/** Optional `fetch` override for testing. */
export type FetchLike = typeof fetch

export class ManifestValidationError extends Error {
  readonly source: string
  readonly issues: string[]
  constructor(source: string, issues: string[]) {
    super(`Manifest at ${source} failed validation: ${issues.join('; ')}`)
    this.name = 'ManifestValidationError'
    this.source = source
    this.issues = issues
  }
}
