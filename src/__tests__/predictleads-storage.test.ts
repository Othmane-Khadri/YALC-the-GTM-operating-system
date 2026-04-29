import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from '../lib/db/schema'

/**
 * Tests for the company-signals storage helpers.
 *
 * Each test gets a fresh in-memory libsql DB seeded with just the two
 * tables we care about. We dependency-inject the `db` instance into the
 * helpers so tests don't touch the global ~/.gtm-os/gtm-os.db.
 */

let raw: Client
let db: ReturnType<typeof drizzle<typeof schema>>

beforeEach(async () => {
  raw = createClient({ url: ':memory:' })
  await raw.execute(`
    CREATE TABLE company_signals (
      id text PRIMARY KEY NOT NULL,
      tenant_id text DEFAULT 'default' NOT NULL,
      provider text DEFAULT 'predictleads' NOT NULL,
      domain text NOT NULL,
      signal_type text NOT NULL,
      signal_id text,
      payload text NOT NULL,
      event_date text,
      first_seen_at integer,
      last_seen_at integer
    )
  `)
  await raw.execute(`
    CREATE UNIQUE INDEX company_signals_unique_idx
    ON company_signals (provider, domain, signal_type, signal_id)
  `)
  await raw.execute(`
    CREATE TABLE company_signal_fetches (
      id text PRIMARY KEY NOT NULL,
      tenant_id text DEFAULT 'default' NOT NULL,
      provider text DEFAULT 'predictleads' NOT NULL,
      domain text NOT NULL,
      signal_type text NOT NULL,
      last_fetched_at integer,
      api_call_count integer DEFAULT 0 NOT NULL,
      rows_returned integer DEFAULT 0 NOT NULL
    )
  `)
  db = drizzle(raw, { schema })
})

afterEach(() => {
  raw.close()
})

describe('predictleads storage', () => {
  it('upsertSignals inserts new signals on first call', async () => {
    const { upsertSignals } = await import('../lib/services/predictleads-storage')

    const inserted = await upsertSignals(db, {
      domain: 'hubspot.com',
      signalType: 'job_opening',
      signals: [
        { signalId: 'job-1', payload: { title: 'Senior SE' }, eventDate: '2026-04-15' },
        { signalId: 'job-2', payload: { title: 'AE' }, eventDate: '2026-04-10' },
      ],
    })

    expect(inserted).toBe(2)
    const rows = await raw.execute('SELECT signal_id FROM company_signals ORDER BY signal_id')
    expect(rows.rows.map((r) => r.signal_id)).toEqual(['job-1', 'job-2'])
  })

  it('upsertSignals dedupes by (provider, domain, signalType, signalId) and bumps lastSeenAt', async () => {
    const { upsertSignals } = await import('../lib/services/predictleads-storage')

    await upsertSignals(db, {
      domain: 'hubspot.com',
      signalType: 'job_opening',
      signals: [{ signalId: 'job-1', payload: { title: 'Old' }, eventDate: '2026-04-15' }],
    })
    const before = await raw.execute('SELECT last_seen_at FROM company_signals')
    const beforeTs = before.rows[0].last_seen_at as number

    // Same key, different payload — should update, not duplicate
    await new Promise((r) => setTimeout(r, 1100))
    await upsertSignals(db, {
      domain: 'hubspot.com',
      signalType: 'job_opening',
      signals: [{ signalId: 'job-1', payload: { title: 'New' }, eventDate: '2026-04-15' }],
    })

    const after = await raw.execute('SELECT signal_id, payload, last_seen_at FROM company_signals')
    expect(after.rows.length).toBe(1)
    expect(JSON.parse(after.rows[0].payload as string).title).toBe('New')
    expect(after.rows[0].last_seen_at as number).toBeGreaterThan(beforeTs)
  })

  it('isCacheFresh returns false when no fetch recorded', async () => {
    const { isCacheFresh } = await import('../lib/services/predictleads-storage')
    const fresh = await isCacheFresh(db, { domain: 'hubspot.com', signalType: 'job_opening', ttlDays: 7 })
    expect(fresh).toBe(false)
  })

  it('recordFetch + isCacheFresh returns true within TTL', async () => {
    const { recordFetch, isCacheFresh } = await import('../lib/services/predictleads-storage')

    await recordFetch(db, { domain: 'hubspot.com', signalType: 'job_opening', rowsReturned: 5 })
    const fresh = await isCacheFresh(db, { domain: 'hubspot.com', signalType: 'job_opening', ttlDays: 7 })
    expect(fresh).toBe(true)
  })

  it('isCacheFresh returns false when last fetch is older than TTL', async () => {
    const { isCacheFresh } = await import('../lib/services/predictleads-storage')

    // Record a fetch dated 30 days ago directly via raw SQL
    const old = Math.floor((Date.now() - 30 * 86400 * 1000) / 1000)
    await raw.execute({
      sql: `INSERT INTO company_signal_fetches (id, tenant_id, provider, domain, signal_type, last_fetched_at, api_call_count, rows_returned)
            VALUES (?, 'default', 'predictleads', ?, ?, ?, 1, 0)`,
      args: ['predictleads:hubspot.com:job_opening', 'hubspot.com', 'job_opening', old],
    })

    const fresh = await isCacheFresh(db, { domain: 'hubspot.com', signalType: 'job_opening', ttlDays: 7 })
    expect(fresh).toBe(false)
  })

  it('listSignals returns rows ordered by event_date desc', async () => {
    const { upsertSignals, listSignals } = await import('../lib/services/predictleads-storage')

    await upsertSignals(db, {
      domain: 'hubspot.com',
      signalType: 'news',
      signals: [
        { signalId: 'n-old', payload: { title: 'Older' }, eventDate: '2026-01-01' },
        { signalId: 'n-new', payload: { title: 'Newer' }, eventDate: '2026-04-15' },
      ],
    })

    const rows = await listSignals(db, { domain: 'hubspot.com', limit: 10 })
    expect(rows.length).toBe(2)
    expect((rows[0].payload as { title: string }).title).toBe('Newer')
    expect((rows[1].payload as { title: string }).title).toBe('Older')
  })

  it('listSignals filters by signalType when provided', async () => {
    const { upsertSignals, listSignals } = await import('../lib/services/predictleads-storage')

    await upsertSignals(db, {
      domain: 'hubspot.com',
      signalType: 'news',
      signals: [{ signalId: 'n-1', payload: {}, eventDate: '2026-04-15' }],
    })
    await upsertSignals(db, {
      domain: 'hubspot.com',
      signalType: 'job_opening',
      signals: [{ signalId: 'j-1', payload: {}, eventDate: '2026-04-15' }],
    })

    const newsOnly = await listSignals(db, { domain: 'hubspot.com', signalType: 'news', limit: 10 })
    expect(newsOnly.length).toBe(1)
    expect(newsOnly[0].signalType).toBe('news')
  })
})
