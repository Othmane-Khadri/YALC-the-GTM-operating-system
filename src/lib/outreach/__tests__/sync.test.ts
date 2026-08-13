import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { readFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { NormalizedMessage, OutreachReadAdapter, OutreachProvider, ReadMessagePageInput, ReadMessagePageResult } from '../contracts'
import { PROVIDER_MIN_INTERVAL_MS, createProviderPacer, retryProviderRead } from '../rate-limit'
import { OutreachSyncCoordinator, type SyncAdapterFactory } from '../sync'

let raw: Client
let databasePath: string

const migrations = ['0000_bootstrap.sql', '0001_sticky_junta.sql', '0002_warm_liz_osborn.sql', '0003_multichannel_outreach_inbox.sql', '0004_lucky_chat.sql', '0005_tricky_mandroid.sql']

async function applyMigrations() {
  for (const name of migrations) {
    const source = await readFile(resolve(process.cwd(), 'src/lib/db/migrations', name), 'utf8')
    for (const statement of source.split(/-->\s*statement-breakpoint/).map((value) => value.trim()).filter(Boolean)) await raw.execute(statement)
  }
}

async function seed(provider: OutreachProvider = 'instantly') {
  await raw.execute({ sql: 'INSERT INTO conversations (id, title) VALUES (?, ?)', args: ['sync-conversation', 'Sync test'] })
  await raw.execute({
    sql: `INSERT INTO campaigns (id, tenant_id, conversation_id, title, hypothesis, status, channels, success_metrics, metrics)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['sync-campaign', 'sync-tenant', 'sync-conversation', 'Sync campaign', 'Hypothesis', 'draft', 'email', '{}', '{}'],
  })
  await raw.execute({
    sql: `INSERT INTO campaign_provider_runs (id, tenant_id, campaign_id, provider, external_campaign_id, external_name, sender_account_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [`sync-${provider}`, 'sync-tenant', 'sync-campaign', provider, `external-${provider}`, 'Provider campaign', provider === 'heyreach' ? '77' : null],
  })
}

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    channel: 'email', externalMessageId: 'sync-message-1', externalThreadId: 'sync-thread-1', externalIdentityId: 'sync-person-1',
    email: 'sync@example.test', linkedinUrl: null, direction: 'inbound', kind: 'human', subject: 'Reply', bodyText: 'Reply body',
    providerTimestamp: '2026-08-13T10:00:00.000Z', ...overrides,
  }
}

function page(messages: NormalizedMessage[], nextCursor: string | null): ReadMessagePageResult {
  return { messages, nextCursor, normalization: { imported: messages.length, malformed: 0, mismatched: 0 } }
}

function adapter(provider: OutreachProvider, pages: ReadMessagePageResult[] | (() => Promise<ReadMessagePageResult>), calls: ReadMessagePageInput[]): OutreachReadAdapter {
  return {
    provider,
    discoverCampaigns: async () => [],
    readMessagePage: async (input) => {
      calls.push(input)
      if (typeof pages === 'function') return pages()
      const next = pages.shift()
      if (!next) throw { safeError: { category: 'provider_unavailable' as const } }
      return next
    },
  }
}

function factoryFor(provider: OutreachProvider, fake: OutreachReadAdapter): SyncAdapterFactory {
  return { forProvider: () => fake.provider === provider ? fake : { ...fake, provider } }
}

beforeEach(async () => {
  databasePath = resolve(process.cwd(), `.outreach-sync-${randomUUID()}.test.db`)
  raw = createClient({ url: `file:${databasePath}` })
  await raw.execute('PRAGMA foreign_keys = ON')
  await applyMigrations()
  await seed()
})

afterEach(async () => {
  raw.close()
  await rm(databasePath, { force: true })
  await rm(`${databasePath}-shm`, { force: true })
  await rm(`${databasePath}-wal`, { force: true })
})

describe('outreach sync coordinator', () => {
  it('paces provider reads and retries only transient safe categories', async () => {
    const waits: number[] = []
    let attempts = 0

    await expect(retryProviderRead({
      provider: 'instantly',
      wait: async (ms) => { waits.push(ms) },
      read: async () => {
        attempts += 1
        if (attempts < 3) throw { safeError: { category: 'rate_limited' as const } }
        return 'page'
      },
    })).resolves.toBe('page')

    expect(attempts).toBe(3)
    expect(PROVIDER_MIN_INTERVAL_MS).toEqual({ instantly: 3_000, heyreach: 1_100 })
    expect(waits).toEqual([250, 500])
  })

  it('paces successive Instantly reads by the documented 20 rpm minimum without timers', async () => {
    let now = 100
    const delays: number[] = []
    const pacer = createProviderPacer({
      now: () => now,
      sleep: async (delay) => { delays.push(delay); now += delay },
    })
    await pacer.wait('instantly')
    await pacer.wait('instantly')
    await pacer.wait('heyreach')
    await pacer.wait('heyreach')

    expect(delays).toEqual([3_000, 1_100])
  })

  it('does not retry authorization failures', async () => {
    let attempts = 0
    await expect(retryProviderRead({
      provider: 'heyreach', wait: async () => { throw new Error('must not wait') },
      read: async () => { attempts += 1; throw { safeError: { category: 'forbidden' as const } } },
    })).rejects.toMatchObject({ safeError: { category: 'forbidden' } })
    expect(attempts).toBe(1)
  })

  it('enqueues durably before a deterministic worker drain and imports the first backfill from the beginning', async () => {
    const calls: ReadMessagePageInput[] = []
    const coordinator = new OutreachSyncCoordinator({
      raw, autoStart: false,
      adapters: factoryFor('instantly', adapter('instantly', [page([message()], null)], calls)),
      pacer: { wait: async () => {} }, retryWait: async () => {},
    })

    const runId = await coordinator.enqueue({ tenantId: 'sync-tenant', campaignId: 'sync-campaign', providers: ['instantly'] })
    await expect(coordinator.getStatus('sync-tenant', runId)).resolves.toMatchObject({ status: 'queued' })

    await coordinator.drain(runId)

    expect(calls).toEqual([expect.objectContaining({ externalCampaignId: 'external-instantly', cursor: null, watermark: null })])
    await expect(coordinator.getStatus('sync-tenant', runId)).resolves.toMatchObject({
      status: 'completed', counts: { messagesProcessed: 1 }, providerSummary: { instantly: { state: 'completed', pages: 1 } },
    })
    await expect(raw.execute('SELECT sync_cursor, sync_watermark FROM campaign_provider_runs WHERE id = ?', ['sync-instantly']))
      .resolves.toMatchObject({ rows: [{ sync_cursor: null, sync_watermark: '2026-08-13T10:00:00.000Z' }] })
  })

  it('starts a later pass from watermark minus ten minutes and preserves the incremental run identity in its cursor', async () => {
    await raw.execute({ sql: 'UPDATE campaign_provider_runs SET sync_watermark = ? WHERE id = ?', args: ['2026-08-13T10:00:00.000Z', 'sync-instantly'] })
    const calls: ReadMessagePageInput[] = []
    const coordinator = new OutreachSyncCoordinator({ raw, autoStart: false, pacer: { wait: async () => {} }, retryWait: async () => {}, adapters: factoryFor('instantly', adapter('instantly', [page([], 'next-page')], calls)) })
    const runId = await coordinator.enqueue({ tenantId: 'sync-tenant', campaignId: 'sync-campaign', providers: ['instantly'] })
    // First page fails after its transactional page write only on the following page.
    await coordinator.drain(runId)

    expect(calls[0]).toMatchObject({ cursor: null, watermark: '2026-08-13T09:50:00.000Z' })
    const cursor = await raw.execute('SELECT sync_cursor FROM campaign_provider_runs WHERE id = ?', ['sync-instantly'])
    expect(JSON.parse(String(cursor.rows[0].sync_cursor))).toMatchObject({ mode: 'incremental', syncRunId: runId, cursor: 'next-page' })
  })

  it('keeps a failed page cursor unchanged, then resumes the same incremental pass after interruption', async () => {
    const originalCursor = JSON.stringify({ mode: 'incremental', syncRunId: 'interrupted-run', cursor: 'resume-token' })
    await raw.execute({ sql: 'UPDATE campaign_provider_runs SET sync_cursor = ?, sync_watermark = ? WHERE id = ?', args: [originalCursor, '2026-08-13T10:00:00.000Z', 'sync-instantly'] })
    const calls: ReadMessagePageInput[] = []
    const transientFailure = () => Promise.reject({ safeError: { category: 'forbidden' as const } })
    const coordinator = new OutreachSyncCoordinator({ raw, autoStart: false, pacer: { wait: async () => {} }, retryWait: async () => {}, adapters: factoryFor('instantly', adapter('instantly', transientFailure, calls)) })
    const runId = await coordinator.enqueue({ tenantId: 'sync-tenant', campaignId: 'sync-campaign', providers: ['instantly'] })
    await coordinator.drain(runId)

    expect(calls[0]).toMatchObject({ cursor: 'resume-token', syncRunId: 'interrupted-run' })
    await expect(raw.execute('SELECT sync_cursor FROM campaign_provider_runs WHERE id = ?', ['sync-instantly']))
      .resolves.toMatchObject({ rows: [{ sync_cursor: originalCursor }] })
    await expect(coordinator.getStatus('sync-tenant', runId)).resolves.toMatchObject({ status: 'failed', providerSummary: { instantly: { errorCode: 'forbidden' } } })
  })

  it('isolates provider failures, retains the successful provider data, and makes replay idempotent', async () => {
    await raw.execute({
      sql: `INSERT INTO campaign_provider_runs (id, tenant_id, campaign_id, provider, external_campaign_id, external_name, sender_account_id)
            VALUES (?, ?, ?, 'heyreach', ?, ?, ?)`,
      args: ['sync-heyreach', 'sync-tenant', 'sync-campaign', 'external-heyreach', 'HeyReach campaign', '77'],
    })
    const calls: ReadMessagePageInput[] = []
    const instantly = adapter('instantly', () => Promise.resolve(page([message()], null)), calls)
    const coordinator = new OutreachSyncCoordinator({
      raw, autoStart: false, pacer: { wait: async () => {} }, retryWait: async () => {},
      adapters: { forProvider: (run) => run.provider === 'instantly' ? instantly : adapter('heyreach', () => Promise.reject({ safeError: { category: 'provider_unavailable' as const } }), []) },
    })
    const runId = await coordinator.enqueue({ tenantId: 'sync-tenant', campaignId: 'sync-campaign' })
    await coordinator.drain(runId)
    const replayRunId = await coordinator.enqueue({ tenantId: 'sync-tenant', campaignId: 'sync-campaign', providers: ['instantly'] })
    await coordinator.drain(replayRunId)

    await expect(coordinator.getStatus('sync-tenant', runId)).resolves.toMatchObject({ status: 'partial', providerSummary: { heyreach: { errorCode: 'provider_unavailable' }, instantly: { state: 'completed' } } })
    await expect(raw.execute('SELECT count(*) AS count FROM outreach_messages WHERE tenant_id = ?', ['sync-tenant']))
      .resolves.toMatchObject({ rows: [{ count: 1 }] })
  })

  it('marks running rows interrupted only when startup recovery is explicitly invoked', async () => {
    await raw.execute({
      sql: `INSERT INTO outreach_sync_runs (id, tenant_id, campaign_id, requested_providers, status)
            VALUES (?, ?, ?, ?, 'running')`,
      args: ['orphan-run', 'sync-tenant', 'sync-campaign', '["instantly"]'],
    })
    const coordinator = new OutreachSyncCoordinator({ raw, autoStart: false })
    await coordinator.recoverInterruptedRuns()

    await expect(coordinator.getStatus('sync-tenant', 'orphan-run')).resolves.toMatchObject({
      status: 'failed', providerSummary: { interrupted: { errorCode: 'interrupted' } },
    })
  })
})
