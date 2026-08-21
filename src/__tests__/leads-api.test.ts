import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rawClient } from '../lib/db/index.js'
import { createLeadsRoutes } from '../lib/server/routes/leads.js'

const PREFIX = 'task-9-'
const TENANT_A = 'task-9-tenant-a'
const TENANT_B = 'task-9-tenant-b'

function appFor(tenantId = TENANT_A, now?: Date) {
  return createLeadsRoutes({ raw: rawClient, resolveTenant: () => tenantId, now: now ? () => now : undefined })
}

async function request(path: string, init?: RequestInit, tenantId = TENANT_A) {
  const response = await appFor(tenantId).request(path, init)
  return { response, body: await response.json() as Record<string, unknown> }
}

async function seedCampaign(tenantId: string, id: string) {
  await rawClient.execute({
    sql: 'INSERT INTO conversations (id, title) VALUES (?, ?)',
    args: [`${id}-root`, 'Inbox API test'],
  })
  await rawClient.execute({
    sql: `INSERT INTO campaigns
      (id, tenant_id, conversation_id, title, hypothesis, status, channels, success_metrics, metrics)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, tenantId, `${id}-root`, 'Inbox campaign', 'Local read model', 'draft', 'linkedin,email', '{}', '{}'],
  })
}

async function seedLead(tenantId: string, id: string, campaignId: string) {
  await rawClient.execute({
    sql: `INSERT INTO campaign_leads
      (id, tenant_id, campaign_id, provider_id, first_name, last_name, company, email, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, tenantId, campaignId, `${id}-provider`, 'Ada', 'Lovelace', 'Analytical Engines', 'ada@example.test', 'outreach_import'],
  })
}

async function seedTimeline(input: {
  tenantId: string
  campaignId: string
  leadId: string
  runId?: string
  conversationId?: string
  messageId?: string
  timestamp?: string
  bodyText?: string
}) {
  const runId = input.runId ?? `${input.leadId}-run`
  const conversationId = input.conversationId ?? `${input.leadId}-conversation`
  const messageId = input.messageId ?? `${input.leadId}-message`
  const timestamp = input.timestamp ?? '2026-08-13T10:00:00.000Z'
  await rawClient.execute({
    sql: `INSERT INTO campaign_provider_runs
      (id, tenant_id, campaign_id, provider, external_campaign_id, external_name)
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: [runId, input.tenantId, input.campaignId, 'instantly', `${runId}-external`, 'Inbox email run'],
  })
  await rawClient.execute({
    sql: `INSERT INTO outreach_conversations
      (id, tenant_id, campaign_lead_id, provider_run_id, provider, channel, external_thread_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [conversationId, input.tenantId, input.leadId, runId, 'instantly', 'email', `${conversationId}-thread`],
  })
  await rawClient.execute({
    sql: `INSERT INTO outreach_messages
      (id, tenant_id, outreach_conversation_id, provider_run_id, provider, fingerprint, direction, message_kind, body_text, provider_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [messageId, input.tenantId, conversationId, runId, 'instantly', `${messageId}-fingerprint`, 'inbound', 'human', input.bodyText ?? 'x'.repeat(260), timestamp],
  })
}

async function seedMessage(input: {
  tenantId: string
  runId: string
  conversationId: string
  id: string
  timestamp: string
  direction?: 'inbound' | 'outbound'
  kind?: 'campaign_automated' | 'human' | 'auto_reply' | 'unknown'
  bodyText?: string
}) {
  await rawClient.execute({
    sql: `INSERT INTO outreach_messages
      (id, tenant_id, outreach_conversation_id, provider_run_id, provider, fingerprint, direction, message_kind, body_text, provider_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.id, input.tenantId, input.conversationId, input.runId, 'instantly', `${input.id}-fingerprint`,
      input.direction ?? 'outbound', input.kind ?? 'human', input.bodyText ?? input.id, input.timestamp,
    ],
  })
}

beforeEach(async () => {
  await seedCampaign(TENANT_A, `${PREFIX}campaign-a`)
  await seedCampaign(TENANT_B, `${PREFIX}campaign-b`)
  await seedLead(TENANT_A, `${PREFIX}lead-a`, `${PREFIX}campaign-a`)
  await seedLead(TENANT_B, `${PREFIX}lead-b`, `${PREFIX}campaign-b`)
  await seedTimeline({ tenantId: TENANT_A, campaignId: `${PREFIX}campaign-a`, leadId: `${PREFIX}lead-a` })
  await seedTimeline({ tenantId: TENANT_B, campaignId: `${PREFIX}campaign-b`, leadId: `${PREFIX}lead-b` })
})

afterEach(async () => {
  for (const table of ['outreach_drafts', 'outreach_messages', 'outreach_conversations', 'campaign_provider_runs', 'campaign_leads', 'campaigns', 'conversations']) {
    const column = table === 'conversations' ? 'id' : 'id'
    await rawClient.execute({ sql: `DELETE FROM ${table} WHERE ${column} LIKE ?`, args: [`${PREFIX}%`] })
  }
})

describe('tenant-safe multichannel lead list', () => {
  it('preserves lead identity fields while exposing bounded inbox metadata without full bodies', async () => {
    const { response, body } = await request('/?campaignId=task-9-campaign-a')

    expect(response.status).toBe(200)
    expect(body.leads).toHaveLength(1)
    expect(body.leads).toEqual([expect.objectContaining({
      id: `${PREFIX}lead-a`,
      firstName: 'Ada',
      lastName: 'Lovelace',
      company: 'Analytical Engines',
      channels: ['email'],
      messageCounts: { email: 1, linkedin: 0, total: 1 },
      inboxBucket: 'needs_reply',
      inboxState: null,
      lastActivityAt: '2026-08-13T10:00:00.000Z',
      lastMessage: expect.objectContaining({
        preview: 'x'.repeat(240),
        channel: 'email',
        provider: 'instantly',
      }),
    })])
    expect((body.leads as Array<Record<string, unknown>>)[0].lastMessage).not.toHaveProperty('bodyText')
    expect(JSON.stringify(body)).not.toContain('x'.repeat(241))
  })

  it('keeps the established list filter aliases and count response contract', async () => {
    const { response, body } = await request('/?campaignId=task-9-campaign-a&lifecycleStatus=Queued,Disqualified&q=ada&include=lastMessage')

    expect(response.status).toBe(200)
    expect(body.count).toBe(1)
    expect(body.leads).toEqual([expect.objectContaining({
      id: `${PREFIX}lead-a`,
      email: 'ada@example.test',
      instantlyCampaignId: null,
      tags: null,
      lastMessage: expect.objectContaining({ preview: 'x'.repeat(240) }),
    })])
  })

  it('rejects an unsupported canonical type filter instead of returning unfiltered leads', async () => {
    const { response, body } = await request('/?type=B2B')

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'unsupported_filter' })
  })

  it('returns globally chronological cursor pages without duplicates when timestamps tie', async () => {
    await seedMessage({
      tenantId: TENANT_A,
      runId: `${PREFIX}lead-a-run`,
      conversationId: `${PREFIX}lead-a-conversation`,
      id: `${PREFIX}message-11`,
      timestamp: '2026-08-13T11:00:00.000Z',
    })
    await seedMessage({
      tenantId: TENANT_A,
      runId: `${PREFIX}lead-a-run`,
      conversationId: `${PREFIX}lead-a-conversation`,
      id: `${PREFIX}message-12-a`,
      timestamp: '2026-08-13T12:00:00.000Z',
    })
    await seedMessage({
      tenantId: TENANT_A,
      runId: `${PREFIX}lead-a-run`,
      conversationId: `${PREFIX}lead-a-conversation`,
      id: `${PREFIX}message-12-b`,
      timestamp: '2026-08-13T12:00:00.000Z',
    })

    const first = await request(`/${PREFIX}lead-a/messages?limit=2`)

    expect(first.response.status).toBe(200)
    expect(first.body.messages).toEqual([
      expect.objectContaining({ id: `${PREFIX}lead-a-message`, leadId: `${PREFIX}lead-a`, providerTimestamp: '2026-08-13T10:00:00.000Z' }),
      expect.objectContaining({ id: `${PREFIX}message-11`, leadId: `${PREFIX}lead-a`, providerTimestamp: '2026-08-13T11:00:00.000Z' }),
    ])
    expect(first.body.nextCursor).toEqual(expect.any(String))
    expect(first.body.truncated).toBe(true)

    const second = await request(`/${PREFIX}lead-a/messages?limit=2&cursor=${encodeURIComponent(first.body.nextCursor as string)}`)
    expect(second.response.status).toBe(200)
    expect(second.body.messages).toEqual([
      expect.objectContaining({ id: `${PREFIX}message-12-a`, leadId: `${PREFIX}lead-a`, providerTimestamp: '2026-08-13T12:00:00.000Z' }),
      expect.objectContaining({ id: `${PREFIX}message-12-b`, leadId: `${PREFIX}lead-a`, providerTimestamp: '2026-08-13T12:00:00.000Z' }),
    ])
    expect(second.body.nextCursor).toBeNull()
    const allMessages = [
      ...(first.body.messages as Array<{ id: string }>).map((message) => message.id),
      ...(second.body.messages as Array<{ id: string }>).map((message) => message.id),
    ]
    expect(allMessages).toEqual([
      `${PREFIX}lead-a-message`,
      `${PREFIX}message-11`,
      `${PREFIX}message-12-a`,
      `${PREFIX}message-12-b`,
    ])
    expect(new Set(allMessages)).toHaveLength(4)

    const overLimit = await request(`/${PREFIX}lead-a/messages?limit=101`)
    expect(overLimit.response.status).toBe(400)
    expect(overLimit.body).toEqual({ error: 'invalid_limit' })
  })

  it('writes only valid local state with a deterministic timestamp and reopens on a newer inbound', async () => {
    const stateNow = new Date('2026-08-13T10:30:00.000Z')
    const route = appFor(TENANT_A, stateNow)
    const resolvedResponse = await route.request(`/${PREFIX}lead-a/inbox-state`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'resolved' }),
    })
    const resolved = await resolvedResponse.json() as Record<string, unknown>

    expect(resolvedResponse.status).toBe(200)
    expect(resolved).toEqual({
      inboxState: 'resolved',
      snoozedUntil: null,
      inboxStateUpdatedAt: '2026-08-13T10:30:00.000Z',
    })
    expect((await request('/?campaignId=task-9-campaign-a')).body.leads).toEqual([
      expect.objectContaining({ inboxState: 'resolved', inboxBucket: null }),
    ])

    await seedMessage({
      tenantId: TENANT_A,
      runId: `${PREFIX}lead-a-run`,
      conversationId: `${PREFIX}lead-a-conversation`,
      id: `${PREFIX}reopen-inbound`,
      timestamp: '2026-08-13T11:00:00.000Z',
      direction: 'inbound',
      kind: 'human',
    })
    expect((await request('/?campaignId=task-9-campaign-a')).body.leads).toEqual([
      expect.objectContaining({ inboxState: 'resolved', inboxBucket: 'needs_reply' }),
    ])

    const invalidState = await request(`/${PREFIX}lead-a/inbox-state`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: 'sending' }),
    })
    expect(invalidState.response.status).toBe(400)
    expect(invalidState.body).toEqual({ error: 'invalid_state' })

    const invalidSnooze = await request(`/${PREFIX}lead-a/inbox-state`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: 'snoozed', snoozedUntil: '2026-08-13T10:00:00.000Z' }),
    })
    expect(invalidSnooze.response.status).toBe(400)
    expect(invalidSnooze.body).toEqual({ error: 'invalid_snooze' })

    const impossibleSnoozeResponse = await route.request(`/${PREFIX}lead-a/inbox-state`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: 'snoozed', snoozedUntil: '2026-09-31T12:00:00.000Z' }),
    })
    const impossibleSnooze = await impossibleSnoozeResponse.json() as Record<string, unknown>
    expect(impossibleSnoozeResponse.status).toBe(400)
    expect(impossibleSnooze).toEqual({ error: 'invalid_snooze' })
  })

  it('stores a local draft without a provider path and rejects foreign lead or conversation references', async () => {
    const created = await request(`/${PREFIX}lead-a/drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bodyText: 'Thanks Ada, this is a local review-only draft.',
        channel: 'email',
        conversationId: `${PREFIX}lead-a-conversation`,
        origin: 'codex',
      }),
    })

    expect(created.response.status).toBe(201)
    expect(created.body).toEqual(expect.objectContaining({
      id: expect.any(String),
      leadId: `${PREFIX}lead-a`,
      conversationId: `${PREFIX}lead-a-conversation`,
      channel: 'email',
      origin: 'codex',
      status: 'draft',
    }))
    const persisted = await rawClient.execute({
      sql: 'SELECT body_text, tenant_id, campaign_lead_id, outreach_conversation_id FROM outreach_drafts WHERE id = ?',
      args: [created.body.id as string],
    })
    expect(persisted.rows).toEqual([{
      body_text: 'Thanks Ada, this is a local review-only draft.',
      tenant_id: TENANT_A,
      campaign_lead_id: `${PREFIX}lead-a`,
      outreach_conversation_id: `${PREFIX}lead-a-conversation`,
    }])

    const foreignConversation = await request(`/${PREFIX}lead-a/drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bodyText: 'Nope', channel: 'email', conversationId: `${PREFIX}lead-b-conversation`, origin: 'manual' }),
    })
    expect(foreignConversation.response.status).toBe(400)
    expect(foreignConversation.body).toEqual({ error: 'invalid_conversation' })

    const foreignLeadTimeline = await request(`/${PREFIX}lead-b/messages`)
    expect(foreignLeadTimeline.response.status).toBe(404)
    expect(foreignLeadTimeline.body).toEqual({ error: 'not_found' })

    const foreignLeadDraft = await request(`/${PREFIX}lead-b/drafts`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bodyText: 'Nope', channel: 'email', origin: 'manual' }),
    })
    expect(foreignLeadDraft.response.status).toBe(404)
    expect(foreignLeadDraft.body).toEqual({ error: 'not_found' })
  })

  it('accepts a 10,000-code-point local draft and rejects a larger Unicode body before insert', async () => {
    const maximum = 'a'.repeat(10_000)
    const boundary = await request(`/${PREFIX}lead-a/drafts`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bodyText: maximum, channel: 'email', origin: 'manual' }),
    })
    expect(boundary.response.status).toBe(201)

    const before = await rawClient.execute({
      sql: 'SELECT count(*) AS count FROM outreach_drafts WHERE tenant_id = ? AND campaign_lead_id = ?',
      args: [TENANT_A, `${PREFIX}lead-a`],
    })
    const overLimit = await request(`/${PREFIX}lead-a/drafts`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bodyText: `${maximum}😀`, channel: 'email', origin: 'manual' }),
    })
    const after = await rawClient.execute({
      sql: 'SELECT count(*) AS count FROM outreach_drafts WHERE tenant_id = ? AND campaign_lead_id = ?',
      args: [TENANT_A, `${PREFIX}lead-a`],
    })

    expect(overLimit.response.status).toBe(400)
    expect(overLimit.body).toEqual({ error: 'body_too_long' })
    expect(Array.from(`${maximum}😀`)).toHaveLength(10_001)
    expect(after.rows).toEqual(before.rows)
  })
})
