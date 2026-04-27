import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Tests for the local scrape cache (D3 design).
 *
 * Mocks `globalThis.fetch` to control HEAD-revalidation behavior. The cache
 * lives under `~/.gtm-os/_cache/scrape/` and is keyed on `sha256(url)`.
 */

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-cache-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('scrape cache', () => {
  it('returns hit on a fresh write within TTL', async () => {
    const { writeScrapeCache, fetchCachedScrape, scrapeCachePath } = await import(
      '../lib/web/scrape-cache'
    )

    writeScrapeCache({
      url: 'https://example.com',
      fetched_at: new Date().toISOString(),
      content_md: '# example',
      ttl_s: 3600,
    })
    expect(existsSync(scrapeCachePath('https://example.com'))).toBe(true)

    const result = await fetchCachedScrape('https://example.com', { skipConditional: true })
    expect(result.hit).toBe(true)
    expect(result.content).toBe('# example')
  })

  it('returns miss when entry is older than the TTL', async () => {
    const { writeScrapeCache, fetchCachedScrape } = await import('../lib/web/scrape-cache')

    const old = new Date(Date.now() - 7200 * 1000).toISOString()
    writeScrapeCache({
      url: 'https://example.com',
      fetched_at: old,
      content_md: '# stale',
      ttl_s: 3600,
    })

    const result = await fetchCachedScrape('https://example.com', { skipConditional: true })
    expect(result.hit).toBe(false)
  })

  it('treats a HEAD 304 as a hit and refreshes fetched_at', async () => {
    const { writeScrapeCache, fetchCachedScrape, readScrapeCache } = await import(
      '../lib/web/scrape-cache'
    )

    const past = new Date(Date.now() - 1800 * 1000).toISOString()
    writeScrapeCache({
      url: 'https://example.com',
      last_modified: 'Wed, 21 Oct 2025 07:28:00 GMT',
      fetched_at: past,
      content_md: '# cached',
      ttl_s: 3600,
    })

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 304 }))

    const result = await fetchCachedScrape('https://example.com')
    expect(result.hit).toBe(true)
    expect(result.content).toBe('# cached')
    expect(fetchSpy).toHaveBeenCalledOnce()

    // fetched_at should have been bumped past the original.
    const refreshed = readScrapeCache('https://example.com')
    expect(refreshed?.fetched_at).not.toBe(past)
  })

  it('treats a HEAD 200 (changed) as a miss', async () => {
    const { writeScrapeCache, fetchCachedScrape } = await import('../lib/web/scrape-cache')

    writeScrapeCache({
      url: 'https://example.com',
      etag: '"abc"',
      fetched_at: new Date().toISOString(),
      content_md: '# old',
      ttl_s: 3600,
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200, headers: { etag: '"def"' } }),
    )

    const result = await fetchCachedScrape('https://example.com')
    expect(result.hit).toBe(false)
  })
})
