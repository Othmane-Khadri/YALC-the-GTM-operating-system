import { afterEach, describe, expect, it, vi } from 'vitest'
import { rawClient } from '../../db'
import { createOutreachRoutes } from '../../server/routes/outreach'
import { InstantlyOutreachReadAdapter } from '../adapters/instantly'
import type { OutreachReadAdapter } from '../contracts'
import { OutreachSyncCoordinator } from '../sync'

const tenantId = 'privacy-tenant'
const campaignId = 'privacy-campaign'
const conversationId = 'privacy-conversation'
const providerRunId = 'privacy-provider-run'
const leadId = 'privacy-existing-lead'
const identityId = 'privacy-existing-identity'
const outreachConversationId = 'privacy-existing-conversation'
const outreachMessageId = 'privacy-existing-message'
const draftId = 'privacy-existing-draft'
const priorCursor = JSON.stringify({ mode: 'incremental', syncRunId: 'privacy-prior-run', cursor: 'opaque-prior-cursor' })
const priorWatermark = '2026-08-13T09:00:00.000Z'
const priorFirstImportedAt = '2026-08-13T08:00:00.000Z'

const sentinels = [
  'credential_PRIVACY_SENTINEL',
  'private.person@example.test',
  'https://www.linkedin.com/in/privacy-sentinel',
  'full-provider-message-body-PRIVACY-SENTINEL',
]

let syncRunId: string | null = null

type TableSnapshot = Array<Record<string, unknown>>
type OutreachSnapshot = {
  campaignLeads: TableSnapshot
  identities: TableSnapshot
  conversations: TableSnapshot
  messages: TableSnapshot
  drafts: TableSnapshot
  providerRunStable: {
    syncCursor: string | null
    syncWatermark: string | null
    firstMessageImportedAt: string | null
  }
}

function syntheticProviderFailure(): Error & { status: number; body: string } {
  const body = sentinels.join(' | ')
  return Object.assign(new Error(body), { status: 403, body })
}

function expectNoSentinels(value: unknown): void {
  const serialized = JSON.stringify(value)
  for (const sentinel of sentinels) expect(serialized).not.toContain(sentinel)
}

async function seed(): Promise<void> {
  await rawClient.execute({
    sql: 'INSERT INTO conversations (id, title) VALUES (?, ?)',
    args: [conversationId, 'Privacy sync test'],
  })
  await rawClient.execute({
    sql: `INSERT INTO campaigns (id, tenant_id, conversation_id, title, hypothesis, status, channels, success_metrics, metrics)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [campaignId, tenantId, conversationId, 'Privacy campaign', 'No raw provider data escapes', 'draft', 'email', '{}', '{}'],
  })
  await rawClient.execute({
    sql: `INSERT INTO campaign_provider_runs
          (id, tenant_id, campaign_id, provider, external_campaign_id, external_name, sync_cursor, sync_watermark, first_message_imported_at)
          VALUES (?, ?, ?, 'instantly', ?, ?, ?, ?, ?)`,
    args: [providerRunId, tenantId, campaignId, 'privacy-external-campaign', 'Privacy provider campaign', priorCursor, priorWatermark, priorFirstImportedAt],
  })
  await rawClient.execute({
    sql: 'INSERT INTO campaign_leads (id, tenant_id, campaign_id, provider_id, source) VALUES (?, ?, ?, ?, ?)',
    args: [leadId, tenantId, campaignId, 'privacy-existing-provider-id', 'outreach_import'],
  })
  await rawClient.execute({
    sql: `INSERT INTO outreach_identities
          (id, tenant_id, campaign_id, campaign_lead_id, provider, identity_type, normalized_value, evidence_type)
          VALUES (?, ?, ?, ?, 'instantly', 'provider_id', ?, 'provider_payload')`,
    args: [identityId, tenantId, campaignId, leadId, 'privacy-existing-provider-id'],
  })
  await rawClient.execute({
    sql: `INSERT INTO outreach_conversations
          (id, tenant_id, campaign_lead_id, provider_run_id, provider, channel, external_thread_id)
          VALUES (?, ?, ?, ?, 'instantly', 'email', ?)`,
    args: [outreachConversationId, tenantId, leadId, providerRunId, 'privacy-existing-thread'],
  })
  await rawClient.execute({
    sql: `INSERT INTO outreach_messages
          (id, tenant_id, outreach_conversation_id, provider_run_id, provider, fingerprint, direction, message_kind, body_text, provider_timestamp)
          VALUES (?, ?, ?, ?, 'instantly', ?, 'inbound', 'human', ?, ?)`,
    args: [outreachMessageId, tenantId, outreachConversationId, providerRunId, 'privacy-existing-fingerprint', 'existing local body', priorWatermark],
  })
  await rawClient.execute({
    sql: `INSERT INTO outreach_drafts
          (id, tenant_id, campaign_lead_id, outreach_conversation_id, target_channel, body_text, origin)
          VALUES (?, ?, ?, ?, 'email', ?, 'manual')`,
    args: [draftId, tenantId, leadId, outreachConversationId, 'existing local draft'],
  })
}

async function snapshot(): Promise<OutreachSnapshot> {
  const rows = async (table: 'campaign_leads' | 'outreach_identities' | 'outreach_conversations' | 'outreach_messages' | 'outreach_drafts'): Promise<TableSnapshot> => {
    const result = await rawClient.execute({ sql: `SELECT * FROM ${table} WHERE tenant_id = ? ORDER BY id`, args: [tenantId] })
    return result.rows.map((row) => Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))))
  }
  const providerRun = await rawClient.execute({
    sql: `SELECT sync_cursor, sync_watermark, first_message_imported_at
          FROM campaign_provider_runs WHERE id = ? AND tenant_id = ?`,
    args: [providerRunId, tenantId],
  })
  const row = providerRun.rows[0] as Record<string, unknown> | undefined
  if (!row) throw new Error('missing privacy provider run')
  return {
    campaignLeads: await rows('campaign_leads'),
    identities: await rows('outreach_identities'),
    conversations: await rows('outreach_conversations'),
    messages: await rows('outreach_messages'),
    drafts: await rows('outreach_drafts'),
    providerRunStable: {
      syncCursor: typeof row.sync_cursor === 'string' ? row.sync_cursor : null,
      syncWatermark: typeof row.sync_watermark === 'string' ? row.sync_watermark : null,
      firstMessageImportedAt: typeof row.first_message_imported_at === 'string' ? row.first_message_imported_at : null,
    },
  }
}

async function providerFailureState(): Promise<{ lastSyncFailedAt: string | null; lastErrorCode: string | null }> {
  const result = await rawClient.execute({
    sql: `SELECT last_sync_failed_at, last_error_code
          FROM campaign_provider_runs WHERE id = ? AND tenant_id = ?`,
    args: [providerRunId, tenantId],
  })
  const row = result.rows[0] as Record<string, unknown> | undefined
  if (!row) throw new Error('missing privacy provider run failure state')
  return {
    lastSyncFailedAt: typeof row.last_sync_failed_at === 'string' ? row.last_sync_failed_at : null,
    lastErrorCode: typeof row.last_error_code === 'string' ? row.last_error_code : null,
  }
}

afterEach(async () => {
  if (syncRunId) await rawClient.execute({ sql: 'DELETE FROM outreach_sync_runs WHERE id = ? AND tenant_id = ?', args: [syncRunId, tenantId] })
  await rawClient.execute({ sql: 'DELETE FROM campaign_provider_runs WHERE id = ? AND tenant_id = ?', args: [providerRunId, tenantId] })
  await rawClient.execute({ sql: 'DELETE FROM campaigns WHERE id = ? AND tenant_id = ?', args: [campaignId, tenantId] })
  await rawClient.execute({ sql: 'DELETE FROM conversations WHERE id = ?', args: [conversationId] })
  syncRunId = null
  vi.restoreAllMocks()
})

describe('outreach privacy boundary', () => {
  it('projects a synthetic provider failure to safe adapter and sync-status DTOs without emitting or changing normalized state', async () => {
    const consoleSpies = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      trace: vi.spyOn(console, 'trace').mockImplementation(() => {}),
    }
    const adapter = new InstantlyOutreachReadAdapter({
      async listCampaignEmails() {
        throw syntheticProviderFailure()
      },
    })

    const adapterError = await adapter.readMessagePage({ externalCampaignId: 'privacy-external-campaign', cursor: null })
      .then(() => { throw new Error('expected a provider read failure') })
      .catch((error: unknown) => error)
    expect(adapterError).toMatchObject({ safeError: { category: 'forbidden', status: 403 } })

    await seed()
    const before = await snapshot()
    expect(before.campaignLeads.map((row) => row.id)).toEqual([leadId])
    expect(before.identities.map((row) => row.id)).toEqual([identityId])
    expect(before.conversations.map((row) => row.id)).toEqual([outreachConversationId])
    expect(before.messages.map((row) => row.id)).toEqual([outreachMessageId])
    expect(before.drafts.map((row) => row.id)).toEqual([draftId])
    expect(before.providerRunStable).toEqual({ syncCursor: priorCursor, syncWatermark: priorWatermark, firstMessageImportedAt: priorFirstImportedAt })
    let providerReads = 0
    const failingAdapter: OutreachReadAdapter = {
      provider: 'instantly',
      discoverCampaigns: async () => [],
      async readMessagePage() {
        providerReads += 1
        throw syntheticProviderFailure()
      },
    }
    const coordinator = new OutreachSyncCoordinator({
      raw: rawClient,
      autoStart: false,
      pacer: { wait: async () => {} },
      retryWait: async () => {},
      adapters: { forProvider: () => failingAdapter },
    })

    syncRunId = await coordinator.enqueue({ tenantId, campaignId, providers: ['instantly'] })
    await coordinator.drain(syncRunId)
    const syncStatus = await coordinator.getStatus(tenantId, syncRunId)
    const routes = createOutreachRoutes({ raw: rawClient, resolveTenant: () => tenantId, sync: coordinator })
    const response = await routes.request(`/sync/${syncRunId}?tenant=${tenantId}`)
    const apiStatus = await response.json()
    const after = await snapshot()
    const failureState = await providerFailureState()

    expect(response.status).toBe(200)
    expect(providerReads).toBe(1)
    expect(syncStatus).toMatchObject({
      status: 'failed',
      counts: { pagesProcessed: 0, conversationsProcessed: 0, messagesProcessed: 0 },
      providerSummary: {
        providers: [{
          provider: 'instantly',
          state: 'failed',
          mappings: [{ providerRunId, state: 'failed', pages: 0, errorCode: 'forbidden' }],
        }],
      },
    })
    expect(apiStatus).toMatchObject({
      status: 'failed',
      counts: { pagesProcessed: 0, conversationsProcessed: 0, messagesProcessed: 0 },
    })
    expect(after).toEqual(before)
    expect(failureState).toMatchObject({ lastErrorCode: 'forbidden', lastSyncFailedAt: expect.any(String) })
    expect(Date.parse(failureState.lastSyncFailedAt ?? '')).not.toBeNaN()

    expectNoSentinels(adapterError)
    expectNoSentinels(syncStatus)
    expectNoSentinels(apiStatus)
    expectNoSentinels(failureState)
    for (const spy of Object.values(consoleSpies)) expect(spy).not.toHaveBeenCalled()
  })
})
