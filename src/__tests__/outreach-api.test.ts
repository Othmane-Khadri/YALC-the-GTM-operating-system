import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rawClient } from '../lib/db'
import { createOutreachRoutes } from '../lib/server/routes/outreach'

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

function appFor(tenantId = 'tenant-a') {
  return createOutreachRoutes({
    raw: rawClient,
    resolveTenant: () => tenantId,
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
    sql: 'DELETE FROM campaigns WHERE id LIKE ? OR id = ?',
    args: [`${TEST_PREFIX}%`, 'heyreach:tenant-a:9001'],
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
      }],
    })
    expect(JSON.stringify(body)).not.toMatch(/contact|message|email|bodyText/i)
  })

  it('adopts only an exact tenant-owned HeyReach legacy campaign with a valid sender', async () => {
    await seedCampaign({
      id: 'heyreach:tenant-a:9001',
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
          campaignId: 'heyreach:tenant-a:9001',
          senderAccountId: '77',
        },
      }],
    })
  })

  it('does not link similar campaign titles', async () => {
    await seedCampaign({ id: `${TEST_PREFIX}similar`, tenantId: 'tenant-a', title: 'Exact external campaign' })
    const { body } = await json(appFor(), '/provider-campaigns?provider=instantly&tenant=tenant-a')

    expect(body).toMatchObject({ campaigns: [{ link: null }] })
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
