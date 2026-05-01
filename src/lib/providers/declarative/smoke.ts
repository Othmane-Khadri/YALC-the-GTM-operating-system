/**
 * Smoke-test runner for declarative manifests.
 *
 * Used by:
 *   - `yalc-gtm adapters:smoke <path>` — operator-facing CLI.
 *   - The provider-builder skill (B3) — automated pre-registration check.
 *
 * The runner compiles the manifest, invokes it with the manifest's
 * `smoke_test.input`, then verifies that every `expectNonEmpty` path is
 * present + truthy in the response. Network failures, schema errors, and
 * empty paths all surface as a structured `SmokeResult` (no exceptions
 * leak — callers decide their exit code from `.passed`).
 */

import { readFileSync } from 'node:fs'
import { compileManifest, type CompileOptions } from './compiler.js'
import { ManifestValidationError } from './types.js'

export interface SmokeResult {
  passed: boolean
  source: string
  capabilityId?: string
  providerId?: string
  /** Raw response from the compiled invoke (only when invoke succeeded). */
  response?: unknown
  /** Per-path results from `expectNonEmpty`. */
  pathChecks: Array<{ path: string; ok: boolean; got: unknown }>
  /** Top-level error (validation, missing env, fetch, vendor error). */
  error?: { name: string; message: string }
}

export interface SmokeOptions extends CompileOptions {}

export async function runSmoke(path: string, opts: SmokeOptions = {}): Promise<SmokeResult> {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    return {
      passed: false,
      source: path,
      pathChecks: [],
      error: {
        name: 'ReadError',
        message: err instanceof Error ? err.message : String(err),
      },
    }
  }

  let compiled
  try {
    compiled = compileManifest(raw, path, opts)
  } catch (err) {
    return {
      passed: false,
      source: path,
      pathChecks: [],
      error: {
        name: err instanceof ManifestValidationError ? 'ManifestValidationError' : 'CompileError',
        message: err instanceof Error ? err.message : String(err),
      },
    }
  }

  const smoke = compiled.raw.smoke_test
  if (!smoke) {
    return {
      passed: false,
      source: path,
      capabilityId: compiled.capabilityId,
      providerId: compiled.providerId,
      pathChecks: [],
      error: { name: 'NoSmokeTest', message: 'manifest has no smoke_test block' },
    }
  }

  let response: unknown
  try {
    response = await compiled.invoke(smoke.input)
  } catch (err) {
    return {
      passed: false,
      source: path,
      capabilityId: compiled.capabilityId,
      providerId: compiled.providerId,
      pathChecks: [],
      error: {
        name: err instanceof Error ? err.constructor.name : 'UnknownError',
        message: err instanceof Error ? err.message : String(err),
      },
    }
  }

  const expects = smoke.expectNonEmpty ?? []
  const pathChecks = expects.map((p) => {
    const got = readByExpr(response, p)
    return { path: p, ok: isNonEmpty(got), got }
  })
  const passed = pathChecks.every((c) => c.ok)
  return {
    passed,
    source: path,
    capabilityId: compiled.capabilityId,
    providerId: compiled.providerId,
    response,
    pathChecks,
  }
}

function isNonEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

/** Mini path reader supporting `foo`, `foo.bar`, `foo[0]`, `foo[0].bar`. */
function readByExpr(value: unknown, expr: string): unknown {
  let cur: unknown = value
  let i = 0
  // Optional leading "$" or "$."
  if (expr.startsWith('$.')) i = 2
  else if (expr.startsWith('$')) i = 1
  let pendingKey = ''
  const flushKey = () => {
    if (pendingKey === '') return
    if (cur == null || typeof cur !== 'object') {
      cur = undefined
      pendingKey = ''
      return
    }
    cur = (cur as Record<string, unknown>)[pendingKey]
    pendingKey = ''
  }
  while (i < expr.length) {
    const ch = expr[i]
    if (ch === '.') {
      flushKey()
      i++
    } else if (ch === '[') {
      flushKey()
      const close = expr.indexOf(']', i)
      if (close === -1) return undefined
      const idx = expr.slice(i + 1, close).trim()
      if (cur == null) return undefined
      if (/^\d+$/.test(idx)) {
        if (!Array.isArray(cur)) return undefined
        cur = (cur as unknown[])[Number(idx)]
      } else {
        const key = idx.replace(/^['"]|['"]$/g, '')
        if (typeof cur !== 'object') return undefined
        cur = (cur as Record<string, unknown>)[key]
      }
      i = close + 1
    } else {
      pendingKey += ch
      i++
    }
  }
  flushKey()
  return cur
}

export function formatSmokeResult(r: SmokeResult): string {
  const lines: string[] = []
  lines.push(`Manifest: ${r.source}`)
  if (r.capabilityId && r.providerId) {
    lines.push(`Adapter:  ${r.capabilityId}/${r.providerId}`)
  }
  if (r.error) {
    lines.push(`Status:   FAIL (${r.error.name})`)
    lines.push(`Error:    ${r.error.message}`)
    return lines.join('\n')
  }
  lines.push(`Status:   ${r.passed ? 'PASS' : 'FAIL'}`)
  for (const c of r.pathChecks) {
    const tag = c.ok ? 'OK ' : 'MISS'
    const preview = previewValue(c.got)
    lines.push(`  [${tag}] ${c.path} → ${preview}`)
  }
  return lines.join('\n')
}

function previewValue(v: unknown): string {
  if (v === undefined) return '<undefined>'
  if (v === null) return '<null>'
  const str = typeof v === 'string' ? v : JSON.stringify(v)
  return str.length > 80 ? str.slice(0, 77) + '...' : str
}
