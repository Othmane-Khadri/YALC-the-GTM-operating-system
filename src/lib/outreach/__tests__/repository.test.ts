import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { OutreachRepository, messageFingerprint } from '../repository'
import type { NormalizedMessage, ReadMessagePageResult } from '../contracts'

let raw: Client
let databasePath: string

const migrationNames = [
  '0000_bootstrap.sql',
  '0001_sticky_junta.sql',
  '0002_warm_liz_osborn.sql',
  '0003_multichannel_outreach_inbox.sql',
  '0004_lucky_chat.sql',
]

async function applyMigrations() {
  for (const name of migrationNames) {
    const migration = await readFile(resolve(process.cwd(), 'src/lib/db/migrations', name), 'utf8')
    for (const statement of migration.split(/-->\s*statement-breakpoint/).map((value) => value.trim()).filter(Boolean)) {
      await raw.execute(statement)
    }
  }
}

async function seed(tenantId = 'tenant-a', campaignId = 'campaign-a', provider = 'instantly', suffix = tenantId) {
  await raw.execute({ sql: 'INSERT INTO conversations (id, title) VALUES (?, ?)', args: [`conversation-${suffix}`, 'Repository test'] })
  await raw.execute({
    sql: `INSERT INTO campaigns (id, tenant_id, conversation_id, title, hypothesis, status, channels, success_metrics, metrics)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [campaignId, tenantId, `conversation-${suffix}`, 'Campaign', 'Hypothesis', 'draft', 'email', '{}', '{}'],
  })
  await raw.execute({
    sql: `INSERT INTO campaign_provider_runs
          (id, tenant_id, campaign_id, provider, external_campaign_id, external_name, sync_cursor)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [`run-${suffix}`, tenantId, campaignId, provider, `external-${suffix}`, 'Provider campaign', 'before-page'],
  })
  await raw.execute({
    sql: `INSERT INTO outreach_sync_runs (id, tenant_id, campaign_id, requested_providers, status)
          VALUES (?, ?, ?, ?, ?)`,
    args: [`sync-${suffix}`, tenantId, campaignId, JSON.stringify([provider]), 'running'],
  })
}

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    channel: 'email',
    externalMessageId: 'message-1',
    externalThreadId: 'thread-1',
    externalIdentityId: 'person-1',
    email: 'person@example.test',
    linkedinUrl: null,
    direction: 'inbound',
    kind: 'human',
    subject: 'Hello',
    bodyText: 'A reply',
    providerTimestamp: '2026-08-13T10:00:00.000Z',
    ...overrides,
  }
}

function page(messages: NormalizedMessage[], nextCursor: string | null = 'after-page'): ReadMessagePageResult {
  return { messages, nextCursor, normalization: { imported: messages.length, malformed: 0, mismatched: 0 } }
}

beforeEach(async () => {
  databasePath = resolve(process.cwd(), `.outreach-repository-${randomUUID()}.test.db`)
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

describe('OutreachRepository.commitPage', () => {
  it('persists an identical page once and advances its cursor only with that page', async () => {
    const repository = new OutreachRepository(raw)
    const input = {
      tenantId: 'tenant-a',
      campaignId: 'campaign-a',
      providerRunId: 'run-tenant-a',
      syncRunId: 'sync-tenant-a',
      provider: 'instantly' as const,
      page: page([
        message(),
        message({ externalMessageId: 'message-2', externalThreadId: 'thread-1', direction: 'outbound', kind: 'campaign_automated' }),
      ]),
    }

    await repository.commitPage(input)
    await repository.commitPage(input)

    await expect(raw.execute('SELECT count(*) AS count FROM outreach_messages WHERE tenant_id = ?', ['tenant-a']))
      .resolves.toMatchObject({ rows: [{ count: 2 }] })
    await expect(raw.execute('SELECT count(*) AS count FROM outreach_conversations WHERE tenant_id = ?', ['tenant-a']))
      .resolves.toMatchObject({ rows: [{ count: 1 }] })
    await expect(raw.execute('SELECT count(*) AS count FROM outreach_identities WHERE tenant_id = ?', ['tenant-a']))
      .resolves.toMatchObject({ rows: [{ count: 2 }] })
    await expect(raw.execute('SELECT sync_cursor, sync_watermark FROM campaign_provider_runs WHERE id = ?', ['run-tenant-a']))
      .resolves.toMatchObject({ rows: [{ sync_cursor: 'after-page', sync_watermark: '2026-08-13T10:00:00.000Z' }] })
  })

  it('attaches a second channel by exact email within the same canonical campaign', async () => {
    await raw.execute({
      sql: `INSERT INTO campaign_provider_runs
            (id, tenant_id, campaign_id, provider, external_campaign_id, external_name, sync_cursor)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ['run-heyreach', 'tenant-a', 'campaign-a', 'heyreach', 'external-heyreach', 'LinkedIn campaign', 'before-page'],
    })
    const repository = new OutreachRepository(raw)
    await repository.commitPage({
      tenantId: 'tenant-a', campaignId: 'campaign-a', providerRunId: 'run-tenant-a', syncRunId: 'sync-tenant-a', provider: 'instantly',
      page: page([message()]),
    })
    await repository.commitPage({
      tenantId: 'tenant-a', campaignId: 'campaign-a', providerRunId: 'run-heyreach', syncRunId: 'sync-tenant-a', provider: 'heyreach',
      page: page([message({
        channel: 'linkedin', externalMessageId: 'linkedin-message-1', externalThreadId: 'linkedin-thread-1', externalIdentityId: null,
        linkedinUrl: 'https://www.linkedin.com/in/person/',
      })]),
    })

    await expect(raw.execute('SELECT count(*) AS count FROM campaign_leads WHERE tenant_id = ? AND campaign_id = ?', ['tenant-a', 'campaign-a']))
      .resolves.toMatchObject({ rows: [{ count: 1 }] })
    await expect(raw.execute('SELECT count(*) AS count FROM outreach_conversations WHERE tenant_id = ?', ['tenant-a']))
      .resolves.toMatchObject({ rows: [{ count: 2 }] })
  })

  it('keeps same-name/company presentation records separate without exact identity evidence', async () => {
    const repository = new OutreachRepository(raw)
    const presentationOnly = { firstName: 'Sam', company: 'Hotel' }
    await repository.commitPage({
      tenantId: 'tenant-a', campaignId: 'campaign-a', providerRunId: 'run-tenant-a', syncRunId: 'sync-tenant-a', provider: 'instantly',
      page: page([{ ...message({ externalMessageId: 'no-identity-1', externalIdentityId: null, email: null, linkedinUrl: null, externalThreadId: 'thread-a' }), ...presentationOnly }]),
    })
    await repository.commitPage({
      tenantId: 'tenant-a', campaignId: 'campaign-a', providerRunId: 'run-tenant-a', syncRunId: 'sync-tenant-a', provider: 'instantly',
      page: page([{ ...message({ externalMessageId: 'no-identity-2', externalIdentityId: null, email: null, linkedinUrl: null, externalThreadId: 'thread-b' }), ...presentationOnly }]),
    })

    await expect(raw.execute('SELECT count(*) AS count FROM campaign_leads WHERE tenant_id = ? AND campaign_id = ?', ['tenant-a', 'campaign-a']))
      .resolves.toMatchObject({ rows: [{ count: 2 }] })
  })

  it('never deduplicates identities across tenants or canonical campaigns', async () => {
    await seed('tenant-b', 'campaign-b')
    await seed('tenant-a', 'campaign-c', 'instantly', 'tenant-a-campaign-c')
    const repository = new OutreachRepository(raw)
    await repository.commitPage({
      tenantId: 'tenant-a', campaignId: 'campaign-a', providerRunId: 'run-tenant-a', syncRunId: 'sync-tenant-a', provider: 'instantly',
      page: page([message()]),
    })
    await repository.commitPage({
      tenantId: 'tenant-b', campaignId: 'campaign-b', providerRunId: 'run-tenant-b', syncRunId: 'sync-tenant-b', provider: 'instantly',
      page: page([message()]),
    })
    await repository.commitPage({
      tenantId: 'tenant-a', campaignId: 'campaign-c', providerRunId: 'run-tenant-a-campaign-c', syncRunId: 'sync-tenant-a-campaign-c', provider: 'instantly',
      page: page([message()]),
    })

    await expect(raw.execute(`SELECT tenant_id, campaign_id, count(*) AS count
      FROM campaign_leads GROUP BY tenant_id, campaign_id ORDER BY tenant_id, campaign_id`))
      .resolves.toMatchObject({ rows: [
        { tenant_id: 'tenant-a', campaign_id: 'campaign-a', count: 1 },
        { tenant_id: 'tenant-a', campaign_id: 'campaign-c', count: 1 },
        { tenant_id: 'tenant-b', campaign_id: 'campaign-b', count: 1 },
      ] })
    await expect(raw.execute(`SELECT count(*) AS count FROM outreach_messages AS message
      INNER JOIN outreach_conversations AS conversation ON conversation.id = message.outreach_conversation_id
      INNER JOIN campaign_provider_runs AS run ON run.id = conversation.provider_run_id
      WHERE message.tenant_id = ? AND run.campaign_id = ?`, ['tenant-a', 'campaign-c']))
      .resolves.toMatchObject({ rows: [{ count: 1 }] })
    await expect(raw.execute(`SELECT id, sync_cursor FROM campaign_provider_runs
      WHERE tenant_id = ? AND campaign_id IN (?, ?) ORDER BY campaign_id`, ['tenant-a', 'campaign-a', 'campaign-c']))
      .resolves.toMatchObject({ rows: [
        { id: 'run-tenant-a', sync_cursor: 'after-page' },
        { id: 'run-tenant-a-campaign-c', sync_cursor: 'after-page' },
      ] })
  })

  it('rolls back both page rows and cursor when the cursor update fails', async () => {
    await raw.execute(`CREATE TRIGGER reject_outreach_cursor
      BEFORE UPDATE OF sync_cursor ON campaign_provider_runs
      WHEN NEW.sync_cursor = 'reject-cursor'
      BEGIN SELECT RAISE(ABORT, 'forced transaction failure'); END`)
    const repository = new OutreachRepository(raw)
    await expect(repository.commitPage({
      tenantId: 'tenant-a', campaignId: 'campaign-a', providerRunId: 'run-tenant-a', syncRunId: 'sync-tenant-a', provider: 'instantly',
      page: page([message()], 'reject-cursor'),
    })).rejects.toThrow('forced transaction failure')

    await expect(raw.execute('SELECT count(*) AS count FROM outreach_messages WHERE tenant_id = ?', ['tenant-a']))
      .resolves.toMatchObject({ rows: [{ count: 0 }] })
    await expect(raw.execute('SELECT sync_cursor, sync_watermark FROM campaign_provider_runs WHERE id = ?', ['run-tenant-a']))
      .resolves.toMatchObject({ rows: [{ sync_cursor: 'before-page', sync_watermark: null }] })
  })

  it('keeps conflicting exact identities on separate leads and records only an aggregate conflict count', async () => {
    const repository = new OutreachRepository(raw)
    const common = {
      tenantId: 'tenant-a', campaignId: 'campaign-a', providerRunId: 'run-tenant-a', syncRunId: 'sync-tenant-a', provider: 'instantly' as const,
    }
    await repository.commitPage({ ...common, page: page([message({ externalIdentityId: 'person-a', email: null, externalThreadId: 'thread-a' })]) })
    await repository.commitPage({ ...common, page: page([message({ externalMessageId: 'message-b', externalIdentityId: 'person-b', email: 'person-b@example.test', externalThreadId: 'thread-b' })]) })
    const result = await repository.commitPage({
      ...common,
      page: page([message({ externalMessageId: 'message-conflict', externalIdentityId: 'person-a', email: 'person-b@example.test', externalThreadId: 'thread-conflict' })]),
    })

    expect(result.identityConflicts).toBe(1)
    await expect(raw.execute('SELECT count(*) AS count FROM campaign_leads WHERE tenant_id = ? AND campaign_id = ?', ['tenant-a', 'campaign-a']))
      .resolves.toMatchObject({ rows: [{ count: 2 }] })
    await expect(raw.execute(`SELECT identity.campaign_lead_id FROM outreach_identities AS identity
      WHERE identity.tenant_id = ? AND identity.campaign_id = ? AND identity.normalized_value = ?`, ['tenant-a', 'campaign-a', 'person-b@example.test']))
      .resolves.toMatchObject({ rows: [{ campaign_lead_id: expect.any(String) }] })
    await expect(raw.execute('SELECT identity_conflicts FROM outreach_sync_runs WHERE id = ?', ['sync-tenant-a']))
      .resolves.toMatchObject({ rows: [{ identity_conflicts: 1 }] })
  })

  it('leaves unresolved threads separate unless each thread has its own explicit manual link', async () => {
    await raw.execute({
      sql: 'INSERT INTO campaign_leads (id, tenant_id, campaign_id, provider_id) VALUES (?, ?, ?, ?)',
      args: ['manual-lead-a', 'tenant-a', 'campaign-a', 'manual-existing-a'],
    })
    await raw.execute({
      sql: 'INSERT INTO campaign_leads (id, tenant_id, campaign_id, provider_id) VALUES (?, ?, ?, ?)',
      args: ['manual-lead-b', 'tenant-a', 'campaign-a', 'manual-existing-b'],
    })
    const repository = new OutreachRepository(raw)
    await repository.commitPage({
      tenantId: 'tenant-a', campaignId: 'campaign-a', providerRunId: 'run-tenant-a', syncRunId: 'sync-tenant-a', provider: 'instantly',
      page: page([
        message({ externalMessageId: 'unlinked-a', externalIdentityId: null, email: null, linkedinUrl: null, externalThreadId: 'unlinked-thread-a' }),
        message({ externalMessageId: 'unlinked-b', externalIdentityId: null, email: null, linkedinUrl: null, externalThreadId: 'unlinked-thread-b' }),
      ]),
    })
    await expect(raw.execute(`SELECT count(DISTINCT campaign_lead_id) AS count FROM outreach_conversations
      WHERE tenant_id = ? AND external_thread_id IN (?, ?)`, ['tenant-a', 'unlinked-thread-a', 'unlinked-thread-b']))
      .resolves.toMatchObject({ rows: [{ count: 2 }] })

    await repository.commitPage({
      tenantId: 'tenant-a', campaignId: 'campaign-a', providerRunId: 'run-tenant-a', syncRunId: 'sync-tenant-a', provider: 'instantly',
      manualLeadIdByExternalThreadId: {
        'manual-thread-a': 'manual-lead-a',
        'manual-thread-b': 'manual-lead-b',
      },
      page: page([
        message({ externalMessageId: 'manual-a', externalIdentityId: null, email: null, linkedinUrl: null, externalThreadId: 'manual-thread-a' }),
        message({ externalMessageId: 'manual-b', externalIdentityId: null, email: null, linkedinUrl: null, externalThreadId: 'manual-thread-b' }),
      ]),
    })
    await expect(raw.execute(`SELECT external_thread_id, campaign_lead_id FROM outreach_conversations
      WHERE tenant_id = ? AND external_thread_id IN (?, ?) ORDER BY external_thread_id`, ['tenant-a', 'manual-thread-a', 'manual-thread-b']))
      .resolves.toMatchObject({ rows: [
        { external_thread_id: 'manual-thread-a', campaign_lead_id: 'manual-lead-a' },
        { external_thread_id: 'manual-thread-b', campaign_lead_id: 'manual-lead-b' },
      ] })
  })

  it('rejects a per-thread manual link outside the current tenant and campaign', async () => {
    await seed('tenant-a', 'campaign-c', 'instantly', 'manual-outside')
    await raw.execute({
      sql: 'INSERT INTO campaign_leads (id, tenant_id, campaign_id, provider_id) VALUES (?, ?, ?, ?)',
      args: ['outside-lead', 'tenant-a', 'campaign-c', 'outside'],
    })
    const repository = new OutreachRepository(raw)
    await expect(repository.commitPage({
      tenantId: 'tenant-a', campaignId: 'campaign-a', providerRunId: 'run-tenant-a', syncRunId: 'sync-tenant-a', provider: 'instantly',
      manualLeadIdByExternalThreadId: { 'manual-thread': 'outside-lead' },
      page: page([message({ externalIdentityId: null, email: null, linkedinUrl: null, externalThreadId: 'manual-thread' })]),
    })).rejects.toThrow('manual lead link is outside the tenant or canonical campaign')
    await expect(raw.execute('SELECT count(*) AS count FROM outreach_messages WHERE tenant_id = ? AND provider_run_id = ?', ['tenant-a', 'run-tenant-a']))
      .resolves.toMatchObject({ rows: [{ count: 0 }] })
  })

  it('retains already imported messages when a later page omits them', async () => {
    const repository = new OutreachRepository(raw)
    const common = {
      tenantId: 'tenant-a', campaignId: 'campaign-a', providerRunId: 'run-tenant-a', syncRunId: 'sync-tenant-a', provider: 'instantly' as const,
    }
    await repository.commitPage({ ...common, page: page([message(), message({ externalMessageId: 'message-2', externalThreadId: 'thread-2' })]) })
    await repository.commitPage({ ...common, page: page([message({ externalMessageId: 'message-3', externalThreadId: 'thread-3' })], null) })

    await expect(raw.execute('SELECT count(*) AS count FROM outreach_messages WHERE tenant_id = ?', ['tenant-a']))
      .resolves.toMatchObject({ rows: [{ count: 3 }] })
  })

  it('never moves aggregate conversation timestamps backward on an overlapping page', async () => {
    const repository = new OutreachRepository(raw)
    const common = {
      tenantId: 'tenant-a', campaignId: 'campaign-a', providerRunId: 'run-tenant-a', syncRunId: 'sync-tenant-a', provider: 'instantly' as const,
    }
    await repository.commitPage({ ...common, page: page([message({ externalMessageId: 'newer', providerTimestamp: '2026-08-13T12:00:00.000Z' })]) })
    await repository.commitPage({ ...common, page: page([message({ externalMessageId: 'older', providerTimestamp: '2026-08-13T11:00:00.000Z' })]) })

    await expect(raw.execute('SELECT last_message_at, last_inbound_at FROM outreach_conversations WHERE tenant_id = ?', ['tenant-a']))
      .resolves.toMatchObject({ rows: [{ last_message_at: '2026-08-13T12:00:00.000Z', last_inbound_at: '2026-08-13T12:00:00.000Z' }] })
  })

  it('uses an opaque SHA-256 fingerprint when a provider message has no external id', () => {
    const withoutId = message({ externalMessageId: null })
    const fingerprint = messageFingerprint('instantly', withoutId)
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(messageFingerprint('instantly', withoutId)).toBe(fingerprint)
    expect(messageFingerprint('instantly', { ...withoutId, bodyText: 'Changed body' })).not.toBe(fingerprint)
  })
})
