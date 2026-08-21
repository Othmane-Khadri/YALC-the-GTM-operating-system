import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rawClient } from '../lib/db'
import { createOutreachRoutes } from '../lib/server/routes/outreach'
import { OutreachSyncCoordinator } from '../lib/outreach/sync.js'

const TEST_PREFIX = 'task-7-'

async function seedCampaign(input: {
  id: string
  tenantId: string
  title: string
  linkedInAccountId?: string | null
}) {
  const conversationId = `${input.id}-conversation`
  await rawClient.execute({
    sql: 'INSERT INTO conversations (id, title) VALUES (?, ?)',
    args: [conversationId, 'Outreach API test'],
  })
  await rawClient.execute({
    sql: `INSERT INTO campaigns
      (id, tenant_id, conversation_id, title, hypothesis, status, channels, success_metrics, metrics, linkedin_account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.id,
      input.tenantId,
      conversationId,
      input.title,
      'Exact mappings only',
      'draft',
      'linkedin',
      '{}',
      '{}',
      input.linkedInAccountId ?? null,
    ],
  })
}

function appFor(tenantId = 'tenant-a', raw: typeof rawClient = rawClient, sync?: OutreachSyncCoordinator) {
  return createOutreachRoutes({
    raw,
    resolveTenant: () => tenantId,
    sync,
    discover: {
      instantly: async () => [{
        externalCampaignId: 'instant-9001',
        externalName: 'Exact external campaign',
        externalStatus: 'active',
        senderAccountIds: [],
      }],
      heyreach: async () => [{
        externalCampaignId: '9001',
        externalName: 'LinkedIn campaign',
        externalStatus: 'paused',
        senderAccountIds: ['77', '88'],
      }],
    },
  })
}

async function json(route: ReturnType<typeof appFor>, path: string, init?: RequestInit) {
  const response = await route.request(path, init)
  return { response, body: await response.json() as Record<string, unknown> }
}

beforeEach(async () => {
  await seedCampaign({ id: `${TEST_PREFIX}local-a`, tenantId: 'tenant-a', title: 'Local campaign' })
  await seedCampaign({ id: `${TEST_PREFIX}local-b`, tenantId: 'tenant-b', title: 'Tenant B campaign' })
})

afterEach(async () => {
  await rawClient.execute({
    sql: 'DELETE FROM campaigns WHERE id LIKE ? OR id IN (?, ?)',
    args: [`${TEST_PREFIX}%`, 'heyreach:9001', 'heyreach:tenant-a:9001'],
  })
  await rawClient.execute({
    sql: 'DELETE FROM conversations WHERE id LIKE ?',
    args: [`${TEST_PREFIX}%`],
  })
})

describe('campaign discovery', () => {
  it('returns only safe provider metadata and the tenant-scoped link state', async () => {
    const { response, body } = await json(appFor(), '/provider-campaigns?provider=instantly&tenant=tenant-a')

    expect(response.status).toBe(200)
    expect(body).toEqual({
      campaigns: [{
        provider: 'instantly',
        externalCampaignId: 'instant-9001',
        name: 'Exact external campaign',
        status: 'active',
        senderAccountIds: [],
        link: null,
        mappingLocked: false,
      }],
    })
    expect(JSON.stringify(body)).not.toMatch(/contact|message|email|bodyText/i)
  })

  it('adopts only an exact tenant-owned HeyReach legacy campaign with a valid sender', async () => {
    await seedCampaign({
      id: 'heyreach:9001',
      tenantId: 'tenant-a',
      title: 'Any title is ignored',
      linkedInAccountId: '77',
    })
    const { response, body } = await json(appFor(), '/provider-campaigns?provider=heyreach&tenant=tenant-a')

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      campaigns: [{
        externalCampaignId: '9001',
        link: {
          campaignId: 'heyreach:9001',
          senderAccountId: '77',
        },
      }],
    })
  })

  it('does not adopt tenant-prefixed or other legacy ID variants', async () => {
    await seedCampaign({
      id: 'heyreach:tenant-a:9001',
      tenantId: 'tenant-a',
      title: 'Looks legacy but is not the importer form',
      linkedInAccountId: '77',
    })

    const { response, body } = await json(appFor(), '/provider-campaigns?provider=heyreach&tenant=tenant-a')

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ campaigns: [{ externalCampaignId: '9001', link: null }] })
  })

  it('does not link similar campaign titles', async () => {
    await seedCampaign({ id: `${TEST_PREFIX}similar`, tenantId: 'tenant-a', title: 'Exact external campaign' })
    const { body } = await json(appFor(), '/provider-campaigns?provider=instantly&tenant=tenant-a')

    expect(body).toMatchObject({ campaigns: [{ link: null }] })
  })

  it('exposes only a boolean mapping lock before and after the first imported message', async () => {
    const route = appFor()
    const linked = await json(route, '/campaign-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-a', provider: 'instantly', externalCampaignId: 'instant-9001', campaignId: `${TEST_PREFIX}local-a`,
      }),
    })
    const runId = (linked.body.link as { id: string }).id

    const before = await json(route, '/provider-campaigns?provider=instantly&tenant=tenant-a')
    expect(before.body).toMatchObject({ campaigns: [{ link: { id: runId }, mappingLocked: false }] })

    await rawClient.execute({
      sql: 'UPDATE campaign_provider_runs SET first_message_imported_at = ? WHERE id = ?',
      args: ['2026-08-13T12:00:00.000Z', runId],
    })
    const after = await json(route, '/provider-campaigns?provider=instantly&tenant=tenant-a')
    expect(after.body).toMatchObject({ campaigns: [{ link: { id: runId }, mappingLocked: true }] })
    expect(JSON.stringify(after.body)).not.toMatch(/first_message_imported_at|2026-08-13T12:00:00\.000Z/)
  })
})

describe('campaign links', () => {
  it('links an exact external ID to an exact tenant-owned campaign idempotently', async () => {
    const route = appFor()
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-a',
        provider: 'instantly',
        externalCampaignId: 'instant-9001',
        campaignId: `${TEST_PREFIX}local-a`,
      }),
    }

    const first = await json(route, '/campaign-links', request)
    const second = await json(route, '/campaign-links', request)

    expect(first.response.status).toBe(201)
    expect(second.response.status).toBe(200)
    expect(second.body).toEqual(first.body)
  })

  it('requires a HeyReach sender that belongs to the discovered campaign', async () => {
    const { response, body } = await json(appFor(), '/campaign-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-a',
        provider: 'heyreach',
        externalCampaignId: '9001',
        campaignId: `${TEST_PREFIX}local-a`,
        senderAccountId: '999',
      }),
    })

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'invalid_sender' })
  })

  it('rejects reassignment after message import with a sanitized mapping_locked conflict', async () => {
    const route = appFor()
    const initial = await json(route, '/campaign-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-a', provider: 'instantly', externalCampaignId: 'instant-9001', campaignId: `${TEST_PREFIX}local-a`,
      }),
    })
    const runId = (initial.body.link as { id: string }).id
    await rawClient.execute({
      sql: 'UPDATE campaign_provider_runs SET first_message_imported_at = ? WHERE id = ?',
      args: ['2026-08-13T12:00:00.000Z', runId],
    })
    await seedCampaign({ id: `${TEST_PREFIX}replacement`, tenantId: 'tenant-a', title: 'Replacement' })

    const { response, body } = await json(route, '/campaign-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-a', provider: 'instantly', externalCampaignId: 'instant-9001', campaignId: `${TEST_PREFIX}replacement`,
      }),
    })

    expect(response.status).toBe(409)
    expect(body).toEqual({ error: 'mapping_locked' })
  })

  it('does not reassign when import marks the mapping locked after the initial read', async () => {
    const route = appFor()
    const initial = await json(route, '/campaign-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-a', provider: 'instantly', externalCampaignId: 'instant-9001', campaignId: `${TEST_PREFIX}local-a`,
      }),
    })
    const runId = (initial.body.link as { id: string }).id
    await seedCampaign({ id: `${TEST_PREFIX}race-replacement`, tenantId: 'tenant-a', title: 'Race replacement' })

    let importWon = false
    const racingRaw = {
      ...rawClient,
      execute: async (statement: Parameters<typeof rawClient.execute>[0], args?: Parameters<typeof rawClient.execute>[1]) => {
        const sql = typeof statement === 'string' ? statement : (statement as { sql: string }).sql
        if (!importWon && /UPDATE campaign_provider_runs/.test(sql) && /SET campaign_id/.test(sql)) {
          importWon = true
          await rawClient.execute({
            sql: 'UPDATE campaign_provider_runs SET first_message_imported_at = ? WHERE id = ?',
            args: ['2026-08-13T12:01:00.000Z', runId],
          })
        }
        return args === undefined ? rawClient.execute(statement) : rawClient.execute(statement, args)
      },
    } as typeof rawClient

    const { response, body } = await json(appFor('tenant-a', racingRaw), '/campaign-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-a', provider: 'instantly', externalCampaignId: 'instant-9001', campaignId: `${TEST_PREFIX}race-replacement`,
      }),
    })

    expect(response.status).toBe(409)
    expect(body).toEqual({ error: 'mapping_locked' })
  })

  it('treats simultaneous identical mapping requests as one idempotent mapping', async () => {
    const route = appFor()
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-a', provider: 'instantly', externalCampaignId: 'instant-9001', campaignId: `${TEST_PREFIX}local-a`,
      }),
    }

    const [left, right] = await Promise.all([
      json(route, '/campaign-links', request),
      json(route, '/campaign-links', request),
    ])

    expect([left.response.status, right.response.status].sort()).toEqual([200, 201])
    expect(left.body).toEqual(right.body)
  })

  it('allows only one concurrent reassignment from the same prior mapping', async () => {
    const initialRoute = appFor()
    await json(initialRoute, '/campaign-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-a', provider: 'instantly', externalCampaignId: 'instant-9001', campaignId: `${TEST_PREFIX}local-a`,
      }),
    })
    await seedCampaign({ id: `${TEST_PREFIX}concurrent-left`, tenantId: 'tenant-a', title: 'Concurrent left' })
    await seedCampaign({ id: `${TEST_PREFIX}concurrent-right`, tenantId: 'tenant-a', title: 'Concurrent right' })

    let readCount = 0
    let releaseFirstRead: (() => void) | null = null
    const racingRaw = {
      ...rawClient,
      execute: async (statement: Parameters<typeof rawClient.execute>[0], args?: Parameters<typeof rawClient.execute>[1]) => {
        const sql = typeof statement === 'string' ? statement : (statement as { sql: string }).sql
        const result = args === undefined ? await rawClient.execute(statement) : await rawClient.execute(statement, args)
        if (/SELECT id, campaign_id, sender_account_id, first_message_imported_at/.test(sql)) {
          readCount += 1
          if (readCount === 1) {
            await new Promise<void>((resolve) => { releaseFirstRead = resolve })
          } else if (readCount === 2) {
            releaseFirstRead?.()
          }
        }
        return result
      },
    } as typeof rawClient
    const route = appFor('tenant-a', racingRaw)
    const requestFor = (campaignId: string) => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-a', provider: 'instantly', externalCampaignId: 'instant-9001', campaignId,
      }),
    })

    const [left, right] = await Promise.all([
      json(route, '/campaign-links', requestFor(`${TEST_PREFIX}concurrent-left`)),
      json(route, '/campaign-links', requestFor(`${TEST_PREFIX}concurrent-right`)),
    ])

    expect([left.response.status, right.response.status].sort()).toEqual([200, 409])
    const winner = left.response.status === 200 ? left : right
    const loser = left.response.status === 409 ? left : right
    expect(loser.body).toEqual({ error: 'mapping_conflict' })
    await expect(rawClient.execute({
      sql: 'SELECT campaign_id FROM campaign_provider_runs WHERE tenant_id = ? AND provider = ? AND external_campaign_id = ?',
      args: ['tenant-a', 'instantly', 'instant-9001'],
    })).resolves.toMatchObject({ rows: [{ campaign_id: (winner.body.link as { campaignId: string }).campaignId }] })
  })

  it.each([null, [], 'not-an-object'])('rejects non-object JSON bodies without dereferencing them: %j', async (body) => {
    const { response, body: responseBody } = await json(appFor(), '/campaign-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(response.status).toBe(400)
    expect(responseBody).toEqual({ error: 'bad_request' })
  })

  it('does not allow a caller to select another tenant or link its campaign', async () => {
    const route = appFor('tenant-a')
    const discovery = await json(route, '/provider-campaigns?provider=instantly&tenant=tenant-b')
    const link = await json(route, '/campaign-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant: 'tenant-b', provider: 'instantly', externalCampaignId: 'instant-9001', campaignId: `${TEST_PREFIX}local-b`,
      }),
    })

    expect(discovery.response.status).toBe(403)
    expect(link.response.status).toBe(403)
    expect(discovery.body).toEqual({ error: 'tenant_forbidden' })
    expect(link.body).toEqual({ error: 'tenant_forbidden' })
  })

  it('mounts the outreach API below /api/outreach', async () => {
    const { createApp } = await import('../lib/server/index')
    const response = await createApp().request('/api/outreach/provider-campaigns?provider=unknown')
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_provider' })
  })
})

describe('sync', () => {
  it('rejects an explicitly empty provider selection with a sanitized validation error', async () => {
    const { response, body } = await json(appFor(), '/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: 'tenant-a', campaignId: `${TEST_PREFIX}local-a`, providers: [] }),
    })

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'invalid_provider' })
  })

  it('returns a tenant-scoped queued run before work finishes and exposes aggregate-only status', async () => {
    const coordinator = new OutreachSyncCoordinator({ raw: rawClient, autoStart: false })
    const route = appFor('tenant-a', rawClient, coordinator)
    const { response, body } = await json(route, '/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: 'tenant-a', campaignId: `${TEST_PREFIX}local-a`, providers: ['instantly'] }),
    })

    expect(response.status).toBe(202)
    expect(body).toMatchObject({ status: 'queued', statusUrl: expect.stringMatching(/^\/api\/outreach\/sync\//) })
    const runId = String(body.runId)
    const status = await json(route, `/sync/${runId}?tenant=tenant-a`)
    expect(status.response.status).toBe(200)
    expect(status.body).toMatchObject({ status: 'queued', requestedProviders: ['instantly'], counts: { messagesProcessed: 0 } })
    expect(JSON.stringify(status.body)).not.toMatch(/bodyText|email|thread|externalId|providerTimestamp/i)
  })

  it('does not reveal another tenant sync status', async () => {
    const coordinator = new OutreachSyncCoordinator({ raw: rawClient, autoStart: false })
    const tenantARoute = appFor('tenant-a', rawClient, coordinator)
    const start = await json(tenantARoute, '/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: 'tenant-a', campaignId: `${TEST_PREFIX}local-a`, providers: ['instantly'] }),
    })
    const tenantBRoute = appFor('tenant-b', rawClient, coordinator)
    const status = await json(tenantBRoute, `/sync/${String(start.body.runId)}?tenant=tenant-b`)
    expect(status.response.status).toBe(404)
    expect(status.body).toEqual({ error: 'not_found' })
  })
})
