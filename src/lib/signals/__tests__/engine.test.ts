import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'crypto'

// We need to set up the DB before importing engine modules
// The engine imports db from '../db' which initializes SQLite
import { db, rawClient } from '../../db'
import { signalWatches, signalsLog, intelligence as intelligenceTable } from '../../db/schema'
import { eq, and, sql } from 'drizzle-orm'

import {
  addWatch,
  listWatches,
  removeWatch,
  detectSignal,
  runDetection,
  registerDetector,
} from '../engine'
import type { SignalWatch, DetectorResult } from '../types'

const TEST_TENANT = `test-signals-${randomUUID().slice(0, 8)}`

// Ensure required tables exist before tests run
beforeAll(async () => {
  await rawClient.execute(`
    CREATE TABLE IF NOT EXISTS signal_watches (
      id text PRIMARY KEY NOT NULL,
      tenant_id text NOT NULL DEFAULT 'default',
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      entity_name text NOT NULL,
      signal_types text NOT NULL,
      baseline text NOT NULL DEFAULT '{}',
      created_at text DEFAULT (datetime('now')),
      last_checked_at text DEFAULT (datetime('now'))
    )
  `)
  await rawClient.execute(`
    CREATE TABLE IF NOT EXISTS signals_log (
      id text PRIMARY KEY NOT NULL,
      tenant_id text NOT NULL DEFAULT 'default',
      type text NOT NULL,
      category text NOT NULL,
      data text NOT NULL,
      conversation_id text,
      result_set_id text,
      campaign_id text,
      created_at text DEFAULT (datetime('now'))
    )
  `)
  await rawClient.execute(`
    CREATE TABLE IF NOT EXISTS intelligence (
      id text PRIMARY KEY NOT NULL,
      tenant_id text NOT NULL DEFAULT 'default',
      category text NOT NULL,
      insight text NOT NULL,
      evidence text NOT NULL,
      segment text,
      channel text,
      confidence text NOT NULL DEFAULT 'hypothesis',
      confidence_score integer DEFAULT 0,
      source text NOT NULL,
      bias_check text,
      supersedes text,
      created_at text DEFAULT (datetime('now')),
      validated_at text,
      expires_at text
    )
  `)
})

// Helper to clean up test data
async function cleanup() {
  await db.delete(signalWatches).where(eq(signalWatches.tenantId, TEST_TENANT))
  await db.delete(signalsLog).where(eq(signalsLog.tenantId, TEST_TENANT))
  await db.delete(intelligenceTable).where(eq(intelligenceTable.tenantId, TEST_TENANT))
}

beforeEach(async () => {
  await cleanup()
})

afterEach(async () => {
  await cleanup()
})

// ─── Watch CRUD ─────────────────────────────────────────────────────────────

describe('Watch CRUD', () => {
  it('adds a watch and lists it', async () => {
    const watch = await addWatch({
      entityType: 'company',
      entityId: 'acme.com',
      entityName: 'Acme Corp',
      signalTypes: ['hiring-surge', 'funding'],
      baseline: { job_count: 10 },
      tenantId: TEST_TENANT,
    })

    expect(watch.id).toBeTruthy()
    expect(watch.entityId).toBe('acme.com')
    expect(watch.signalTypes).toEqual(['hiring-surge', 'funding'])

    const watches = await listWatches(TEST_TENANT)
    expect(watches.length).toBe(1)
    expect(watches[0].entityId).toBe('acme.com')
    expect(watches[0].baseline).toEqual({ job_count: 10 })
  })

  it('removes a watch', async () => {
    const watch = await addWatch({
      entityType: 'company',
      entityId: 'remove-me.com',
      entityName: 'Remove Me',
      signalTypes: ['news'],
      baseline: {},
      tenantId: TEST_TENANT,
    })

    const removed = await removeWatch(watch.id, TEST_TENANT)
    expect(removed).toBe(true)

    const watches = await listWatches(TEST_TENANT)
    expect(watches.length).toBe(0)
  })

  it('does not remove watches from other tenants', async () => {
    const watch = await addWatch({
      entityType: 'company',
      entityId: 'safe.com',
      entityName: 'Safe',
      signalTypes: ['news'],
      baseline: {},
      tenantId: TEST_TENANT,
    })

    const removed = await removeWatch(watch.id, 'other-tenant')
    expect(removed).toBe(false)

    const watches = await listWatches(TEST_TENANT)
    expect(watches.length).toBe(1)
  })
})

// ─── Signal Detection ───────────────────────────────────────────────────────

describe('Signal Detection', () => {
  it('fires a signal when detector reports change', async () => {
    // Register a test detector
    registerDetector('hiring-surge', async (_watch): Promise<DetectorResult> => ({
      changed: true,
      summary: 'acme.com is hiring: 25 open positions (+15)',
      data: { current_job_count: 25, delta: 15 },
      newBaseline: { job_count: 25 },
    }))

    const watch = await addWatch({
      entityType: 'company',
      entityId: 'acme.com',
      entityName: 'Acme Corp',
      signalTypes: ['hiring-surge'],
      baseline: { job_count: 10 },
      tenantId: TEST_TENANT,
    })

    const signal = await detectSignal(watch, 'hiring-surge')

    expect(signal).not.toBeNull()
    expect(signal!.signalType).toBe('hiring-surge')
    expect(signal!.entityId).toBe('acme.com')
    expect(signal!.summary).toContain('25 open positions')
  })

  it('does not fire when detector reports no change', async () => {
    registerDetector('funding', async (_watch): Promise<DetectorResult> => ({
      changed: false,
      summary: '',
      data: {},
      newBaseline: { funding_total: 5000000 },
    }))

    const watch = await addWatch({
      entityType: 'company',
      entityId: 'stable.com',
      entityName: 'Stable Inc',
      signalTypes: ['funding'],
      baseline: { funding_total: 5000000 },
      tenantId: TEST_TENANT,
    })

    const signal = await detectSignal(watch, 'funding')
    expect(signal).toBeNull()
  })

  it('deduplicates signals for the same entity+type on the same day', async () => {
    registerDetector('news', async (_watch): Promise<DetectorResult> => ({
      changed: true,
      summary: 'New article found',
      data: { articles: 1 },
      newBaseline: { last_check_date: new Date().toISOString() },
    }))

    const watch = await addWatch({
      entityType: 'company',
      entityId: 'dedup-test.com',
      entityName: 'Dedup Test',
      signalTypes: ['news'],
      baseline: {},
      tenantId: TEST_TENANT,
    })

    // First detection should succeed
    const signal1 = await detectSignal(watch, 'news')
    expect(signal1).not.toBeNull()

    // Second detection on the same day should be deduplicated
    const signal2 = await detectSignal(watch, 'news')
    expect(signal2).toBeNull()
  })
})

// ─── Intelligence Store Integration ─────────────────────────────────────────

describe('Intelligence Store Integration', () => {
  it('creates an intelligence entry when a signal fires', async () => {
    registerDetector('hiring-surge', async (_watch): Promise<DetectorResult> => ({
      changed: true,
      summary: 'intel-test.com is hiring: 20 roles',
      data: { current_job_count: 20 },
      newBaseline: { job_count: 20 },
    }))

    const watch = await addWatch({
      entityType: 'company',
      entityId: 'intel-test.com',
      entityName: 'Intel Test',
      signalTypes: ['hiring-surge'],
      baseline: { job_count: 5 },
      tenantId: TEST_TENANT,
    })

    const signal = await detectSignal(watch, 'hiring-surge')
    expect(signal).not.toBeNull()

    // Check intelligence was created
    const entries = await db
      .select()
      .from(intelligenceTable)
      .where(
        and(
          eq(intelligenceTable.tenantId, TEST_TENANT),
          eq(intelligenceTable.category, 'qualification'),
        ),
      )

    expect(entries.length).toBeGreaterThanOrEqual(1)
    const entry = entries.find(e => e.insight.includes('intel-test.com'))
    expect(entry).toBeTruthy()
    expect(entry!.confidence).toBe('hypothesis')
    expect(entry!.source).toBe('external')
  })
})

// ─── Baseline Update ────────────────────────────────────────────────────────

describe('Baseline Update', () => {
  it('updates the watch baseline after signal detection', async () => {
    registerDetector('funding', async (_watch): Promise<DetectorResult> => ({
      changed: true,
      summary: 'New funding: $10M',
      data: { amount: 10000000 },
      newBaseline: { funding_total: 15000000 },
    }))

    const watch = await addWatch({
      entityType: 'company',
      entityId: 'baseline-test.com',
      entityName: 'Baseline Test',
      signalTypes: ['funding'],
      baseline: { funding_total: 5000000 },
      tenantId: TEST_TENANT,
    })

    await detectSignal(watch, 'funding')

    // Check updated baseline
    const watches = await listWatches(TEST_TENANT)
    const updated = watches.find(w => w.entityId === 'baseline-test.com')
    expect(updated).toBeTruthy()
    expect(updated!.baseline).toEqual({ funding_total: 15000000 })
  })
})

// ─── Run Detection (batch) ──────────────────────────────────────────────────

describe('runDetection', () => {
  it('runs detectors across all watches and returns signals', async () => {
    registerDetector('job-change', async (watch): Promise<DetectorResult> => ({
      changed: watch.entityId === 'changed.com',
      summary: watch.entityId === 'changed.com' ? 'Job changed' : '',
      data: {},
      newBaseline: {},
    }))

    await addWatch({
      entityType: 'company',
      entityId: 'changed.com',
      entityName: 'Changed',
      signalTypes: ['job-change'],
      baseline: {},
      tenantId: TEST_TENANT,
    })

    await addWatch({
      entityType: 'company',
      entityId: 'unchanged.com',
      entityName: 'Unchanged',
      signalTypes: ['job-change'],
      baseline: {},
      tenantId: TEST_TENANT,
    })

    const signals = await runDetection({ tenantId: TEST_TENANT })
    expect(signals.length).toBe(1)
    expect(signals[0].entityId).toBe('changed.com')
  })

  it('filters by signal type when specified', async () => {
    registerDetector('hiring-surge', async (): Promise<DetectorResult> => ({
      changed: true,
      summary: 'Hiring surge detected',
      data: {},
      newBaseline: {},
    }))

    registerDetector('funding', async (): Promise<DetectorResult> => ({
      changed: true,
      summary: 'Funding detected',
      data: {},
      newBaseline: {},
    }))

    await addWatch({
      entityType: 'company',
      entityId: 'multi.com',
      entityName: 'Multi',
      signalTypes: ['hiring-surge', 'funding'],
      baseline: {},
      tenantId: TEST_TENANT,
    })

    const signals = await runDetection({
      tenantId: TEST_TENANT,
      signalType: 'hiring-surge',
    })

    expect(signals.length).toBe(1)
    expect(signals[0].signalType).toBe('hiring-surge')
  })
})
