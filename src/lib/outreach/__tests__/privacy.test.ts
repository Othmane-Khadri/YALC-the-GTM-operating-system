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

const sentinels = [
  'credential_PRIVACY_SENTINEL',
  'private.person@example.test',
  'https://www.linkedin.com/in/privacy-sentinel',
  'full-provider-message-body-PRIVACY-SENTINEL',
]

let syncRunId: string | null = null

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
    sql: `INSERT INTO campaign_provider_runs (id, tenant_id, campaign_id, provider, external_campaign_id, external_name)
          VALUES (?, ?, ?, 'instantly', ?, ?)`,
    args: [providerRunId, tenantId, campaignId, 'privacy-external-campaign', 'Privacy provider campaign'],
  })
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
  it('projects a synthetic provider failure to safe adapter, sync, API, console, and metrics-facing structures without writing or advancing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
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
    const failingAdapter: OutreachReadAdapter = {
      provider: 'instantly',
      discoverCampaigns: async () => [],
      async readMessagePage() {
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
    const metricsFacing = {
      counts: syncStatus?.counts,
      providerSummary: syncStatus?.providerSummary,
    }

    expect(response.status).toBe(200)
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
    await expect(rawClient.execute({
      sql: 'SELECT sync_cursor FROM campaign_provider_runs WHERE id = ? AND tenant_id = ?',
      args: [providerRunId, tenantId],
    })).resolves.toMatchObject({ rows: [{ sync_cursor: null }] })
    await expect(rawClient.execute({
      sql: 'SELECT count(*) AS count FROM outreach_messages WHERE tenant_id = ?',
      args: [tenantId],
    })).resolves.toMatchObject({ rows: [{ count: 0 }] })

    expectNoSentinels(adapterError)
    expectNoSentinels(syncStatus)
    expectNoSentinels(apiStatus)
    expectNoSentinels(metricsFacing)
    expectNoSentinels(consoleError.mock.calls)
  })
})
