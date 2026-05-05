/**
 * Tests for the provider-agnostic on-disk fetch cache. The point of this cache
 * is partial-result preservation across mid-run crashes / credit exhaustion —
 * each test below describes one slice of that contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// YALC_CACHE_DIR env redirects the on-disk cache root for tests.
let tmpCache: string

beforeEach(() => {
  tmpCache = mkdtempSync(join(tmpdir(), 'cached-fetch-'))
  process.env.YALC_CACHE_DIR = tmpCache
  delete process.env.FORCE
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(tmpCache, { recursive: true, force: true })
  delete process.env.YALC_CACHE_DIR
  delete process.env.FORCE
})

describe('cachedFetch', () => {
  it('caches a successful 2xx GET response and replays it on the second call', async () => {
    const { cachedFetch } = await import('../cached-fetch')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ hello: 'world' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const r1 = await cachedFetch('https://api.example.com/x')
    const j1 = await r1.json()

    const r2 = await cachedFetch('https://api.example.com/x')
    const j2 = await r2.json()

    expect(j1).toEqual({ hello: 'world' })
    expect(j2).toEqual({ hello: 'world' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)  // second call hit the cache
  })

  it('does NOT cache 4xx/5xx responses — failed calls always go live', async () => {
    const { cachedFetch } = await import('../cached-fetch')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))

    await cachedFetch('https://api.example.com/y')
    await cachedFetch('https://api.example.com/y')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('FORCE=1 env bypasses the cache for the entire process', async () => {
    const { cachedFetch } = await import('../cached-fetch')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }))

    await cachedFetch('https://api.example.com/z')
    process.env.FORCE = '1'
    await cachedFetch('https://api.example.com/z')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('per-call bypass=true skips the cache for that call only', async () => {
    const { cachedFetch } = await import('../cached-fetch')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }))

    await cachedFetch('https://api.example.com/q')              // populates
    await cachedFetch('https://api.example.com/q', undefined, { bypass: true }) // bypass
    await cachedFetch('https://api.example.com/q')              // hits cache

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('keys distinguish method + URL + body, so different requests do not collide', async () => {
    const { cachedFetch } = await import('../cached-fetch')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    await cachedFetch('https://api.example.com/search', { method: 'POST', body: JSON.stringify({ q: 'a' }) })
    await cachedFetch('https://api.example.com/search', { method: 'POST', body: JSON.stringify({ q: 'b' }) })
    await cachedFetch('https://api.example.com/search', { method: 'POST', body: JSON.stringify({ q: 'a' }) })

    expect(fetchSpy).toHaveBeenCalledTimes(2)  // a, b — second a hit cache
  })

  it('writes cache files under ~/.gtm-os/_cache/<scope>/<sha>.json', async () => {
    const { cachedFetch, cachePathFor } = await import('../cached-fetch')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    await cachedFetch('https://api.crustdata.com/screener/x', undefined, { scope: 'crustdata' })
    const path = await cachePathFor('https://api.crustdata.com/screener/x', { method: 'GET' }, { scope: 'crustdata' })

    expect(path.startsWith(join(tmpCache, 'crustdata'))).toBe(true)
    expect(existsSync(path)).toBe(true)
  })

  it('honours TTL — entries older than ttlMs are refetched', async () => {
    const { cachedFetch } = await import('../cached-fetch')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }))

    await cachedFetch('https://api.example.com/ttl', undefined, { ttlMs: 50 })
    await new Promise(r => setTimeout(r, 80))
    await cachedFetch('https://api.example.com/ttl', undefined, { ttlMs: 50 })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

describe('withCache (SDK-mediated)', () => {
  it('caches the resolved value and skips the inner fn on a hit', async () => {
    const { withCache } = await import('../cached-fetch')
    const inner = vi.fn().mockResolvedValue({ profile: 'alice' })

    const v1 = await withCache({ scope: 'unipile', key: 'getProfile:acct:alice:experience' }, inner)
    const v2 = await withCache({ scope: 'unipile', key: 'getProfile:acct:alice:experience' }, inner)

    expect(v1).toEqual({ profile: 'alice' })
    expect(v2).toEqual({ profile: 'alice' })
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('different keys => independent cache entries', async () => {
    const { withCache } = await import('../cached-fetch')
    const inner = vi.fn().mockImplementation(async () => ({ at: Math.random() }))

    await withCache({ scope: 'unipile', key: 'a' }, inner)
    await withCache({ scope: 'unipile', key: 'b' }, inner)
    await withCache({ scope: 'unipile', key: 'a' }, inner)

    expect(inner).toHaveBeenCalledTimes(2)
  })

  it('FORCE=1 bypasses withCache too', async () => {
    const { withCache } = await import('../cached-fetch')
    const inner = vi.fn().mockResolvedValue({ ok: true })

    await withCache({ scope: 's', key: 'k' }, inner)
    process.env.FORCE = '1'
    await withCache({ scope: 's', key: 'k' }, inner)

    expect(inner).toHaveBeenCalledTimes(2)
  })

  it('inner throws => no cache write; next call retries the inner fn', async () => {
    const { withCache } = await import('../cached-fetch')
    const inner = vi.fn()
      .mockRejectedValueOnce(new Error('rate limit'))
      .mockResolvedValueOnce({ ok: true })

    await expect(withCache({ scope: 's', key: 'k' }, inner)).rejects.toThrow('rate limit')
    const v = await withCache({ scope: 's', key: 'k' }, inner)
    expect(v).toEqual({ ok: true })
    expect(inner).toHaveBeenCalledTimes(2)
  })
})
