// Storage helpers for company-level signals fetched from PredictLeads.
//
// All helpers take a `db` instance so tests can pass a fresh in-memory
// libsql client; production calls use the singleton from `../db`.

import { and, desc, eq, sql } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { companySignals, companySignalFetches } from '../db/schema'
import type { SignalType } from './predictleads'

type DB = LibSQLDatabase<Record<string, unknown>>

const DEFAULT_PROVIDER = 'predictleads'

export interface SignalInput {
  /** Provider's stable UUID for the signal. NULL only for similar_company. */
  signalId: string | null
  payload: unknown
  /** ISO date string for the underlying event. NULL for static facts. */
  eventDate?: string | null
}

export interface UpsertOptions {
  domain: string
  signalType: SignalType
  signals: SignalInput[]
  tenantId?: string
  provider?: string
}

export interface ListOptions {
  domain: string
  signalType?: SignalType
  limit?: number
  tenantId?: string
}

export interface CacheOptions {
  domain: string
  signalType: SignalType
  ttlDays: number
  tenantId?: string
  provider?: string
}

export interface FetchRecordOptions {
  domain: string
  signalType: SignalType
  rowsReturned: number
  tenantId?: string
  provider?: string
}

/**
 * Inserts new signals; updates payload + lastSeenAt for existing rows
 * matched by (provider, domain, signalType, signalId).
 *
 * Returns the number of input rows processed (not the count of inserts vs
 * updates — sqlite ON CONFLICT doesn't surface that distinction cheaply).
 */
export async function upsertSignals(db: DB, opts: UpsertOptions): Promise<number> {
  const { domain, signalType, signals } = opts
  const tenantId = opts.tenantId ?? 'default'
  const provider = opts.provider ?? DEFAULT_PROVIDER
  if (signals.length === 0) return 0

  const now = new Date()
  const rows = signals.map((s) => ({
    id: crypto.randomUUID(),
    tenantId,
    provider,
    domain,
    signalType,
    signalId: s.signalId,
    payload: s.payload as Record<string, unknown>,
    eventDate: s.eventDate ?? null,
    firstSeenAt: now,
    lastSeenAt: now,
  }))

  await db.insert(companySignals).values(rows).onConflictDoUpdate({
    target: [companySignals.provider, companySignals.domain, companySignals.signalType, companySignals.signalId],
    set: {
      payload: sql`excluded.payload`,
      eventDate: sql`excluded.event_date`,
      lastSeenAt: sql`excluded.last_seen_at`,
    },
  })

  return signals.length
}

export interface SignalRow {
  id: string
  domain: string
  signalType: SignalType
  signalId: string | null
  payload: unknown
  eventDate: string | null
  firstSeenAt: Date | null
  lastSeenAt: Date | null
}

export async function listSignals(db: DB, opts: ListOptions): Promise<SignalRow[]> {
  const tenantId = opts.tenantId ?? 'default'
  const conditions = [
    eq(companySignals.tenantId, tenantId),
    eq(companySignals.domain, opts.domain),
  ]
  if (opts.signalType) conditions.push(eq(companySignals.signalType, opts.signalType))

  const rows = await db
    .select()
    .from(companySignals)
    .where(and(...conditions))
    .orderBy(desc(companySignals.eventDate), desc(companySignals.lastSeenAt))
    .limit(opts.limit ?? 50)

  return rows.map((r) => ({
    id: r.id,
    domain: r.domain,
    signalType: r.signalType as SignalType,
    signalId: r.signalId,
    payload: r.payload,
    eventDate: r.eventDate,
    firstSeenAt: r.firstSeenAt ?? null,
    lastSeenAt: r.lastSeenAt ?? null,
  }))
}

export async function isCacheFresh(db: DB, opts: CacheOptions): Promise<boolean> {
  const tenantId = opts.tenantId ?? 'default'
  const provider = opts.provider ?? DEFAULT_PROVIDER

  const [row] = await db
    .select()
    .from(companySignalFetches)
    .where(
      and(
        eq(companySignalFetches.tenantId, tenantId),
        eq(companySignalFetches.provider, provider),
        eq(companySignalFetches.domain, opts.domain),
        eq(companySignalFetches.signalType, opts.signalType),
      ),
    )
    .limit(1)

  if (!row || !row.lastFetchedAt) return false
  const ageMs = Date.now() - row.lastFetchedAt.getTime()
  const ttlMs = opts.ttlDays * 86400 * 1000
  return ageMs < ttlMs
}

export async function recordFetch(db: DB, opts: FetchRecordOptions): Promise<void> {
  const tenantId = opts.tenantId ?? 'default'
  const provider = opts.provider ?? DEFAULT_PROVIDER
  const id = `${provider}:${opts.domain}:${opts.signalType}`

  await db.insert(companySignalFetches).values({
    id,
    tenantId,
    provider,
    domain: opts.domain,
    signalType: opts.signalType,
    lastFetchedAt: new Date(),
    apiCallCount: 1,
    rowsReturned: opts.rowsReturned,
  }).onConflictDoUpdate({
    target: [companySignalFetches.id],
    set: {
      lastFetchedAt: new Date(),
      apiCallCount: sql`${companySignalFetches.apiCallCount} + 1`,
      rowsReturned: opts.rowsReturned,
    },
  })
}
