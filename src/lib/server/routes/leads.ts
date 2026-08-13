import { Hono } from 'hono'
import type { Client } from '@libsql/client'
import { randomUUID } from 'node:crypto'
import { rawClient } from '../../db/index.js'
import { deriveInboxBucket, parseInboxTimestamp, type InboxStateMessage, type LocalInboxState } from '../../outreach/inbox-state.js'
import { resolveTenant } from '../../tenant/index.js'

type RouteOptions = {
  raw?: Client
  resolveTenant?: () => string
  now?: () => Date
}

type Row = Record<string, unknown>

const PREVIEW_LENGTH = 240
export const MAX_DRAFT_BODY_CODE_POINTS = 10_000
const INBOX_STATES = new Set(['pending', 'resolved', 'snoozed'])
const CHANNELS = new Set(['linkedin', 'email'])
const DRAFT_ORIGINS = new Set(['manual', 'codex'])

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asCount(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}

function stringArray(value: unknown): string[] | null {
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : null
  } catch {
    return null
  }
}

function requestedTenantMatches(activeTenant: string, requestedTenant: unknown): boolean {
  return typeof requestedTenant !== 'string' || requestedTenant === activeTenant
}

function localState(row: Row): LocalInboxState {
  return {
    inboxState: asString(row.inbox_state) as LocalInboxState['inboxState'],
    snoozedUntil: asString(row.snoozed_until),
    inboxStateUpdatedAt: asString(row.inbox_state_updated_at),
  }
}

type TimelineCursor = { providerTimestamp: string, id: string }

function encodeCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeCursor(value: string | undefined): TimelineCursor | null {
  if (value === undefined) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const cursor = parsed as Record<string, unknown>
    if (typeof cursor.providerTimestamp !== 'string' || typeof cursor.id !== 'string'
      || !cursor.providerTimestamp || !cursor.id || Number.isNaN(Date.parse(cursor.providerTimestamp))) return null
    return { providerTimestamp: cursor.providerTimestamp, id: cursor.id }
  } catch {
    return null
  }
}

function pageLimit(value: string | undefined): number | null {
  if (value === undefined) return 50
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : null
}

function futureTimestamp(value: unknown, reference: Date): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = parseInboxTimestamp(value, 'snoozedUntil')
    if (parsed <= reference.getTime()) return null
    return new Date(parsed).toISOString()
  } catch {
    return null
  }
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

/**
 * Tenant-scoped local read model for the Inbox. It deliberately has no
 * provider adapter dependency: provider reads are committed before this route
 * is consulted, and drafts/state mutations remain local database writes.
 */
export function createLeadsRoutes(options: RouteOptions = {}) {
  const routes = new Hono()
  const raw = options.raw ?? rawClient
  const activeTenant = options.resolveTenant ?? (() => resolveTenant())
  const now = options.now ?? (() => new Date())

  routes.get('/', async (c) => {
    const tenantId = activeTenant()
    if (!requestedTenantMatches(tenantId, c.req.query('tenant'))) {
      return c.json({ error: 'tenant_forbidden' }, 403)
    }

    // This local read model has no canonical B2B/Partnerships column. Returning
    // an unfiltered result would let callers mistake all leads for that type.
    if (c.req.query('type')?.trim()) return c.json({ error: 'unsupported_filter' }, 400)

    const campaignId = c.req.query('campaignId') ?? c.req.query('campaign_id')
    const lifecycleStatuses = (c.req.query('lifecycleStatus') ?? c.req.query('status'))
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? []
    const search = (c.req.query('q') ?? c.req.query('search'))?.trim()
    const clauses = ['lead.tenant_id = ?']
    const args: Array<string | number | null> = [tenantId]
    if (campaignId) {
      clauses.push('lead.campaign_id = ?')
      args.push(campaignId)
    }
    if (lifecycleStatuses.length > 0) {
      clauses.push(`lead.lifecycle_status IN (${lifecycleStatuses.map(() => '?').join(', ')})`)
      args.push(...lifecycleStatuses)
    }
    if (search) {
      clauses.push(`(
        lower(coalesce(lead.first_name, '') || ' ' || coalesce(lead.last_name, '')) LIKE ?
        OR lower(coalesce(lead.company, '')) LIKE ?
        OR lower(coalesce(lead.email, '')) LIKE ?
      )`)
      const term = `%${search.toLowerCase()}%`
      args.push(term, term, term)
    }

    const leadResult = await raw.execute({
      sql: `SELECT lead.* FROM campaign_leads AS lead
        WHERE ${clauses.join(' AND ')}
        ORDER BY lead.updated_at DESC, lead.id ASC`,
      args,
    })

    const leads = await Promise.all(leadResult.rows.map(async (row) => {
      const lead = row as Row
      const leadId = asString(lead.id)!
      const messageResult = await raw.execute({
        sql: `SELECT conversation.id AS conversation_id, conversation.channel,
            message.id AS message_id, message.provider, message.direction,
            message.message_kind, message.provider_timestamp,
            substr(message.body_text, 1, ?) AS preview
          FROM outreach_conversations AS conversation
          INNER JOIN outreach_messages AS message
            ON message.outreach_conversation_id = conversation.id
            AND message.tenant_id = conversation.tenant_id
            AND message.provider_run_id = conversation.provider_run_id
          WHERE conversation.tenant_id = ? AND conversation.campaign_lead_id = ?
          ORDER BY message.provider_timestamp DESC, message.id DESC`,
        args: [PREVIEW_LENGTH, tenantId, leadId],
      })
      const messages = messageResult.rows as Row[]
      const counts = { email: 0, linkedin: 0, total: messages.length }
      const channels = new Set<'email' | 'linkedin'>()
      const inboxMessages: InboxStateMessage[] = []
      for (const message of messages) {
        const channel = asString(message.channel)
        if (channel === 'email' || channel === 'linkedin') {
          channels.add(channel)
          counts[channel] += 1
        }
        const conversationId = asString(message.conversation_id)
        const direction = asString(message.direction)
        const kind = asString(message.message_kind)
        const providerTimestamp = asString(message.provider_timestamp)
        if (conversationId && (direction === 'inbound' || direction === 'outbound')
          && (kind === 'campaign_automated' || kind === 'human' || kind === 'auto_reply' || kind === 'unknown')
          && providerTimestamp) {
          inboxMessages.push({
            conversationId,
            direction,
            kind,
            providerTimestamp,
          })
        }
      }

      const latest = messages[0]
      const state = localState(lead)
      return {
        id: leadId,
        campaignId: asString(lead.campaign_id),
        firstName: asString(lead.first_name),
        lastName: asString(lead.last_name),
        headline: asString(lead.headline),
        company: asString(lead.company),
        linkedinUrl: asString(lead.linkedin_url),
        lifecycleStatus: asString(lead.lifecycle_status),
        variantId: asString(lead.variant_id),
        qualificationScore: lead.qualification_score ?? null,
        tags: stringArray(lead.tags),
        source: asString(lead.source),
        email: asString(lead.email),
        instantlyCampaignId: asString(lead.instantly_campaign_id),
        connectSentAt: asString(lead.connect_sent_at),
        connectedAt: asString(lead.connected_at),
        dm1SentAt: asString(lead.dm1_sent_at),
        dm2SentAt: asString(lead.dm2_sent_at),
        repliedAt: asString(lead.replied_at),
        emailSentAt: asString(lead.email_sent_at),
        emailOpenedAt: asString(lead.email_opened_at),
        emailRepliedAt: asString(lead.email_replied_at),
        emailBouncedAt: asString(lead.email_bounced_at),
        emailStatus: asString(lead.email_status),
        createdAt: asString(lead.created_at),
        updatedAt: asString(lead.updated_at),
        channels: [...channels].sort(),
        messageCounts: counts,
        inboxBucket: deriveInboxBucket(inboxMessages, state, now()),
        inboxState: state.inboxState,
        snoozedUntil: state.snoozedUntil,
        inboxStateUpdatedAt: state.inboxStateUpdatedAt,
        lastActivityAt: latest ? asString(latest.provider_timestamp) : null,
        lastMessage: latest ? {
          id: asString(latest.message_id),
          conversationId: asString(latest.conversation_id),
          channel: asString(latest.channel),
          provider: asString(latest.provider),
          direction: asString(latest.direction),
          kind: asString(latest.message_kind),
          providerTimestamp: asString(latest.provider_timestamp),
          preview: asString(latest.preview) ?? '',
        } : null,
      }
    }))

    return c.json({ leads, count: leads.length })
  })

  routes.get('/:id/messages', async (c) => {
    const tenantId = activeTenant()
    if (!requestedTenantMatches(tenantId, c.req.query('tenant'))) {
      return c.json({ error: 'tenant_forbidden' }, 403)
    }
    const limit = pageLimit(c.req.query('limit'))
    if (limit === null) return c.json({ error: 'invalid_limit' }, 400)
    const cursor = decodeCursor(c.req.query('cursor'))
    if (c.req.query('cursor') !== undefined && cursor === null) return c.json({ error: 'invalid_cursor' }, 400)

    const leadId = c.req.param('id')
    const lead = await raw.execute({
      sql: 'SELECT id FROM campaign_leads WHERE id = ? AND tenant_id = ? LIMIT 1',
      args: [leadId, tenantId],
    })
    // A lead from another tenant is indistinguishable from an absent lead.
    if (lead.rows.length === 0) return c.json({ error: 'not_found' }, 404)

    const cursorClause = cursor === null
      ? ''
      : ' AND (message.provider_timestamp > ? OR (message.provider_timestamp = ? AND message.id > ?))'
    const timeline = await raw.execute({
      sql: `SELECT message.id, conversation.id AS conversation_id, conversation.channel,
          message.provider, message.direction, message.message_kind, message.subject,
          message.body_text, message.provider_timestamp
        FROM outreach_messages AS message
        INNER JOIN outreach_conversations AS conversation
          ON conversation.id = message.outreach_conversation_id
          AND conversation.tenant_id = message.tenant_id
          AND conversation.provider_run_id = message.provider_run_id
        WHERE message.tenant_id = ? AND conversation.tenant_id = ?
          AND conversation.campaign_lead_id = ?${cursorClause}
        ORDER BY message.provider_timestamp ASC, message.id ASC
        LIMIT ?`,
      args: [
        tenantId,
        tenantId,
        leadId,
        ...(cursor ? [cursor.providerTimestamp, cursor.providerTimestamp, cursor.id] : []),
        limit + 1,
      ],
    })
    const rows = timeline.rows as Row[]
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    const next = hasMore ? page[page.length - 1] : null
    const messages = page.map((message) => ({
      id: asString(message.id),
      leadId,
      conversationId: asString(message.conversation_id),
      channel: asString(message.channel),
      provider: asString(message.provider),
      direction: asString(message.direction),
      kind: asString(message.message_kind),
      subject: asString(message.subject),
      bodyText: asString(message.body_text) ?? '',
      providerTimestamp: asString(message.provider_timestamp),
    }))
    return c.json({
      messages,
      nextCursor: next ? encodeCursor({ providerTimestamp: asString(next.provider_timestamp)!, id: asString(next.id)! }) : null,
      truncated: hasMore,
    })
  })

  routes.patch('/:id/inbox-state', async (c) => {
    let parsed: unknown
    try {
      parsed = await c.req.json()
    } catch {
      return c.json({ error: 'bad_request' }, 400)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return c.json({ error: 'bad_request' }, 400)
    const body = parsed as Record<string, unknown>
    const tenantId = activeTenant()
    if (!requestedTenantMatches(tenantId, body.tenant)) return c.json({ error: 'tenant_forbidden' }, 403)
    if (typeof body.state !== 'string' || !INBOX_STATES.has(body.state)) return c.json({ error: 'invalid_state' }, 400)

    const timestamp = now()
    const snoozedUntil = body.state === 'snoozed'
      ? futureTimestamp(body.snoozedUntil, timestamp)
      : null
    if (body.state === 'snoozed' && snoozedUntil === null) return c.json({ error: 'invalid_snooze' }, 400)
    if (body.state !== 'snoozed' && body.snoozedUntil !== undefined && body.snoozedUntil !== null) {
      return c.json({ error: 'invalid_snooze' }, 400)
    }

    const leadId = c.req.param('id')
    const updatedAt = timestamp.toISOString()
    const result = await raw.execute({
      sql: `UPDATE campaign_leads
        SET inbox_state = ?, snoozed_until = ?, inbox_state_updated_at = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?`,
      args: [body.state, snoozedUntil, updatedAt, updatedAt, leadId, tenantId],
    })
    if (asCount(result.rowsAffected) === 0) return c.json({ error: 'not_found' }, 404)
    return c.json({
      inboxState: body.state,
      snoozedUntil,
      inboxStateUpdatedAt: updatedAt,
    })
  })

  routes.post('/:id/drafts', async (c) => {
    let parsed: unknown
    try {
      parsed = await c.req.json()
    } catch {
      return c.json({ error: 'bad_request' }, 400)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return c.json({ error: 'bad_request' }, 400)
    const body = parsed as Record<string, unknown>
    const tenantId = activeTenant()
    if (!requestedTenantMatches(tenantId, body.tenant)) return c.json({ error: 'tenant_forbidden' }, 403)
    if (typeof body.bodyText !== 'string' || !body.bodyText.trim()) return c.json({ error: 'invalid_body' }, 400)
    if (codePointLength(body.bodyText) > MAX_DRAFT_BODY_CODE_POINTS) return c.json({ error: 'body_too_long' }, 400)
    if (typeof body.channel !== 'string' || !CHANNELS.has(body.channel)) return c.json({ error: 'invalid_channel' }, 400)
    if (typeof body.origin !== 'string' || !DRAFT_ORIGINS.has(body.origin)) return c.json({ error: 'invalid_origin' }, 400)
    if (body.conversationId !== undefined && body.conversationId !== null && typeof body.conversationId !== 'string') {
      return c.json({ error: 'invalid_conversation' }, 400)
    }

    const leadId = c.req.param('id')
    const lead = await raw.execute({
      sql: 'SELECT id FROM campaign_leads WHERE id = ? AND tenant_id = ? LIMIT 1',
      args: [leadId, tenantId],
    })
    if (lead.rows.length === 0) return c.json({ error: 'not_found' }, 404)

    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null
    if (conversationId !== null) {
      const conversation = await raw.execute({
        sql: `SELECT id FROM outreach_conversations
          WHERE id = ? AND tenant_id = ? AND campaign_lead_id = ? AND channel = ?
          LIMIT 1`,
        args: [conversationId, tenantId, leadId, body.channel],
      })
      if (conversation.rows.length === 0) return c.json({ error: 'invalid_conversation' }, 400)
    }

    const id = randomUUID()
    const createdAt = now().toISOString()
    await raw.execute({
      sql: `INSERT INTO outreach_drafts
        (id, tenant_id, campaign_lead_id, outreach_conversation_id, target_channel, body_text, origin, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, tenantId, leadId, conversationId, body.channel, body.bodyText, body.origin, 'draft', createdAt, createdAt],
    })
    // This is intentionally a local insert only. The route owns no provider
    // adapter and does not expose a send/reply path.
    return c.json({
      id,
      leadId,
      conversationId,
      channel: body.channel,
      origin: body.origin,
      status: 'draft',
      createdAt,
      updatedAt: createdAt,
    }, 201)
  })

  return routes
}

export const leadsRoutes = createLeadsRoutes()
