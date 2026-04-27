/**
 * Local on-disk scrape cache for onboarding website fetches.
 *
 * Cache location: `~/.gtm-os/_cache/scrape/<sha256(url)>.json`. Stored
 * payload includes the scraped markdown plus the conditional-fetch
 * headers (Last-Modified, ETag) so subsequent hits can do a HEAD revalidate
 * before re-scraping.
 *
 * - 1-hour default TTL (override via `YALC_SCRAPE_CACHE_TTL_S`).
 * - `--no-cache` callers should bypass `fetchCachedScrape()` entirely.
 * - Same cache shared across tenants — keyed on URL alone.
 */

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const DEFAULT_TTL_S = 3600

export interface ScrapeCacheEntry {
  url: string
  last_modified?: string | null
  etag?: string | null
  fetched_at: string
  content_md: string
  ttl_s: number
}

export function scrapeCacheDir(): string {
  return resolve(homedir(), '.gtm-os', '_cache', 'scrape')
}

export function scrapeCacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex')
}

export function scrapeCachePath(url: string): string {
  return join(scrapeCacheDir(), `${scrapeCacheKey(url)}.json`)
}

function getTtlSeconds(): number {
  const raw = process.env.YALC_SCRAPE_CACHE_TTL_S
  if (!raw) return DEFAULT_TTL_S
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_S
}

export function readScrapeCache(url: string): ScrapeCacheEntry | null {
  const path = scrapeCachePath(url)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ScrapeCacheEntry
  } catch {
    return null
  }
}

function ensureCacheDir(): void {
  const dir = scrapeCacheDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function writeScrapeCache(entry: ScrapeCacheEntry): void {
  ensureCacheDir()
  writeFileSync(scrapeCachePath(entry.url), JSON.stringify(entry, null, 2))
}

/**
 * Drop entries older than `ttl_s × 24` (one day by default). Called
 * opportunistically on every cache write so the directory does not grow
 * unbounded.
 */
export function pruneScrapeCache(): void {
  const dir = scrapeCacheDir()
  if (!existsSync(dir)) return
  const horizonMs = getTtlSeconds() * 24 * 1000
  const now = Date.now()
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const full = join(dir, file)
    try {
      const stat = statSync(full)
      if (now - stat.mtimeMs > horizonMs) {
        rmSync(full, { force: true })
      }
    } catch {
      // Skip unreadable entries.
    }
  }
}

export interface ConditionalHeadResult {
  status: number
  last_modified?: string | null
  etag?: string | null
}

/** Fire a HEAD request with `If-Modified-Since`/`If-None-Match` if any. */
export async function conditionalHead(
  url: string,
  prev: { last_modified?: string | null; etag?: string | null },
): Promise<ConditionalHeadResult | null> {
  try {
    const headers: Record<string, string> = {
      'User-Agent': 'YALC-GTM-OS Scraper/1.0',
    }
    if (prev.last_modified) headers['If-Modified-Since'] = prev.last_modified
    if (prev.etag) headers['If-None-Match'] = prev.etag

    const res = await globalThis.fetch(url, {
      method: 'HEAD',
      headers,
      signal: AbortSignal.timeout(8000),
    })
    return {
      status: res.status,
      last_modified: res.headers.get('last-modified'),
      etag: res.headers.get('etag'),
    }
  } catch {
    return null
  }
}

export interface FetchCachedScrapeOptions {
  /** Override default TTL evaluation (testing). */
  ttlSeconds?: number
  /** Skip the HEAD revalidation pass even when headers are present. */
  skipConditional?: boolean
}

export interface FetchCachedScrapeResult {
  hit: boolean
  /** Content from cache when `hit` is true. Otherwise null. */
  content?: string | null
  /** Cached entry, refreshed on `fetched_at` for HEAD-304 hits. */
  entry?: ScrapeCacheEntry | null
}

/**
 * Try to satisfy a scrape from the local cache. Returns `{ hit: false }`
 * when the caller should fall back to a fresh fetch.
 *
 * On a 304 response the entry's `fetched_at` is bumped so the TTL window
 * extends without rewriting the body.
 */
export async function fetchCachedScrape(
  url: string,
  opts: FetchCachedScrapeOptions = {},
): Promise<FetchCachedScrapeResult> {
  const entry = readScrapeCache(url)
  if (!entry) return { hit: false }

  const ttl = opts.ttlSeconds ?? getTtlSeconds()
  const ageS = (Date.now() - new Date(entry.fetched_at).getTime()) / 1000
  if (ageS >= ttl) return { hit: false }

  const hasConditionalHeaders = !!(entry.last_modified || entry.etag)
  if (hasConditionalHeaders && !opts.skipConditional) {
    const head = await conditionalHead(url, {
      last_modified: entry.last_modified,
      etag: entry.etag,
    })
    if (head && head.status === 304) {
      // Refresh fetched_at so the TTL window slides forward.
      const refreshed: ScrapeCacheEntry = {
        ...entry,
        fetched_at: new Date().toISOString(),
      }
      writeScrapeCache(refreshed)
      return { hit: true, content: refreshed.content_md, entry: refreshed }
    }
    if (head && head.status >= 200 && head.status < 300) {
      // Server says the resource changed — treat as miss.
      return { hit: false }
    }
    // Network error or non-2xx/304: trust the cached body to avoid breaking
    // offline flows.
    return { hit: true, content: entry.content_md, entry }
  }

  return { hit: true, content: entry.content_md, entry }
}

/** Remove a single URL's cache entry — exposed for tests/`--no-cache` flows. */
export function removeScrapeCacheEntry(url: string): void {
  const path = scrapeCachePath(url)
  if (existsSync(path)) rmSync(path, { force: true })
}
