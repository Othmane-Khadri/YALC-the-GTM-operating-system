/**
 * Provider-agnostic on-disk fetch cache.
 *
 * Drop-in replacement for `fetch`. Any service that talks to an external API
 * over HTTP should import this instead — the cache lives at one place, every
 * provider gets the same partial-result-preservation guarantee, and adding a
 * new provider does not require writing new cache logic.
 *
 * Cache layout: `~/.gtm-os/_cache/<scope>/<key>.json`
 *   - scope defaults to the URL hostname (e.g. "api.crustdata.com")
 *   - key = sha256(METHOD ':' URL ':' BODY)
 *
 * Bypass rules:
 *   - `process.env.FORCE === '1'` → skip cache for this entire process
 *   - `cacheOpts.bypass === true` → skip cache for this call
 *
 * Only successful responses (HTTP 2xx) are cached. 4xx/5xx are returned to the
 * caller untouched, never written to disk. This matters because the credit-burn
 * scenario this exists to solve only happens on success — a failing call did
 * not consume credits the caller cares about preserving.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface CacheOptions {
  /** Override the auto-derived scope (default: URL hostname). */
  scope?: string
  /**
   * Time-to-live in milliseconds. When unset, cached entries never expire —
   * the typical case for credit-saving caches. Pass a finite TTL when callers
   * need fresh data after a window.
   */
  ttlMs?: number
  /** Skip the cache for this single call, but still write the response on success. */
  bypass?: boolean
}

interface CachedEntry {
  url: string
  method: string
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  fetchedAt: string  // ISO
  ttlMs: number | null
}

const FORCE_BYPASS = () => process.env.FORCE === '1'

function cacheRoot(): string {
  // YALC_CACHE_DIR env override exists so tests and operators can pin the
  // cache to a non-default location without re-pointing $HOME.
  return process.env.YALC_CACHE_DIR ?? join(homedir(), '.gtm-os', '_cache')
}

function deriveScope(url: string): string {
  try {
    return new URL(url).hostname || 'unknown'
  } catch {
    return 'unknown'
  }
}

function bodyToString(body: unknown): string {
  if (body == null) return ''
  if (typeof body === 'string') return body
  // Best-effort serialize. Buffers / TypedArrays / FormData hash as their tag —
  // good enough as a cache key, since identical inputs will hash identically.
  try {
    return JSON.stringify(body)
  } catch {
    return Object.prototype.toString.call(body)
  }
}

async function deriveKey(method: string, url: string, body: unknown): Promise<string> {
  return createHash('sha256').update(`${method}:${url}:${bodyToString(body)}`).digest('hex')
}

function readEntry(path: string, ttlMs: number | null): CachedEntry | null {
  if (!existsSync(path)) return null
  try {
    const entry = JSON.parse(readFileSync(path, 'utf8')) as CachedEntry
    if (ttlMs !== null && ttlMs > 0) {
      const ageMs = Date.now() - new Date(entry.fetchedAt).getTime()
      if (ageMs > ttlMs) return null
    }
    return entry
  } catch {
    return null
  }
}

function writeEntry(path: string, entry: CachedEntry): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(entry, null, 2))
}

function rebuildResponse(entry: CachedEntry): Response {
  return new Response(entry.body, {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
  })
}

/**
 * Drop-in cached `fetch`. See module doc for behavior.
 */
export async function cachedFetch(
  input: string | URL | Request,
  init?: RequestInit,
  cacheOpts?: CacheOptions,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString()
  const method = (init?.method ?? 'GET').toUpperCase()
  const body = init?.body ?? null

  const bypass = FORCE_BYPASS() || cacheOpts?.bypass === true

  const scope = cacheOpts?.scope ?? deriveScope(url)
  const key = await deriveKey(method, url, body)
  const path = join(cacheRoot(), scope, `${key}.json`)
  const ttlMs = cacheOpts?.ttlMs ?? null

  if (!bypass) {
    const entry = readEntry(path, ttlMs)
    if (entry) return rebuildResponse(entry)
  }

  const res = await fetch(input, init)

  if (res.ok) {
    try {
      const cloned = res.clone()
      const text = await cloned.text()
      const headers: Record<string, string> = {}
      cloned.headers.forEach((v, k) => { headers[k] = v })
      writeEntry(path, {
        url,
        method,
        status: res.status,
        statusText: res.statusText,
        headers,
        body: text,
        fetchedAt: new Date().toISOString(),
        ttlMs,
      })
    } catch {
      // Cache write failures are non-fatal — caller still gets the live response.
    }
  }

  return res
}

/**
 * Path the cache will write to for a given URL/method/body. Exposed for tests
 * and for callers that want to inspect or invalidate a single entry.
 */
export async function cachePathFor(
  url: string,
  init?: { method?: string; body?: unknown },
  cacheOpts?: CacheOptions,
): Promise<string> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const scope = cacheOpts?.scope ?? deriveScope(url)
  const key = await deriveKey(method, url, init?.body ?? null)
  return join(cacheRoot(), scope, `${key}.json`)
}

/**
 * Generic JSON-result cache wrapper for SDK-mediated calls (e.g. anything that
 * does not go through `fetch` — Unipile SDK, Notion SDK, MCP clients). Same
 * disk layout as `cachedFetch`; callers supply the scope and a stable key.
 *
 * The cached value must be JSON-serializable. Throws fall through (not cached).
 */
export async function withCache<T>(
  opts: { scope: string; key: string; ttlMs?: number },
  fn: () => Promise<T>,
): Promise<T> {
  const bypass = FORCE_BYPASS()
  const safeKey = createHash('sha256').update(opts.key).digest('hex')
  const path = join(cacheRoot(), opts.scope, `${safeKey}.json`)
  const ttlMs = opts.ttlMs ?? null

  if (!bypass && existsSync(path)) {
    try {
      const wrapped = JSON.parse(readFileSync(path, 'utf8')) as { fetchedAt: string; ttlMs: number | null; value: T }
      if (ttlMs === null || ttlMs <= 0 || Date.now() - new Date(wrapped.fetchedAt).getTime() <= ttlMs) {
        return wrapped.value
      }
    } catch {
      // fall through to live call
    }
  }

  const value = await fn()

  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({ scope: opts.scope, key: opts.key, fetchedAt: new Date().toISOString(), ttlMs, value }, null, 2),
    )
  } catch {
    // Cache write failures are non-fatal.
  }

  return value
}
