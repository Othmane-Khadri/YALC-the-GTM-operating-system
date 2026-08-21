import { createHash, randomUUID } from 'node:crypto'
import type { Client, Transaction } from '@libsql/client'
import type { NormalizedMessage, OutreachProvider, ReadMessagePageResult } from './contracts'
import { buildIdentityCandidates, normalizeEmail, normalizeLinkedInUrl } from './identity'

type Database = Client | Transaction

type Row = Record<string, unknown>

export interface CommitOutreachPageInput {
  tenantId: string
  /** Canonical campaign scope. It is required for every identity and run lookup. */
  campaignId: string
  providerRunId: string
  /** The running outreach_sync_runs row that receives aggregate-only counters. */
  syncRunId: string
  provider: OutreachProvider
  page: ReadMessagePageResult
  /**
   * Human-confirmed links keyed by the provider's exact thread selector. A
   * mapping is considered only after provider, LinkedIn, and email evidence.
   */
  manualLeadIdByExternalThreadId?: Readonly<Record<string, string | null | undefined>>
}

export interface CommitOutreachPageResult {
  insertedMessages: number
  identityConflicts: number
}

type ScopedProviderRun = {
  syncCursor: string | null
  syncWatermark: string | null
}

type LeadResolution = {
  campaignLeadId: string
  identityConflicts: number
  candidates: ReturnType<typeof buildIdentityCandidates>
  matchedLeadIds: Map<string, string>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function requiredString(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`)
}

function normalizedTimestamp(value: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) throw new Error('providerTimestamp must be an ISO timestamp')
  return new Date(parsed).toISOString()
}

function digest(parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex')
}

/**
 * Stable opaque key for a message. When the provider did not supply a durable
 * message id, all provider message fields that define the event participate in
 * the SHA-256 digest. Nothing in this function is logged.
 */
export function messageFingerprint(provider: OutreachProvider, message: NormalizedMessage): string {
  if (message.externalMessageId?.trim()) {
    return digest(['outreach:external-message:v1', provider, message.externalMessageId.trim()])
  }
  return digest([
    'outreach:message:v1',
    provider,
    message.externalThreadId,
    message.direction,
    normalizedTimestamp(message.providerTimestamp),
    message.subject ?? '',
    message.bodyText,
  ])
}

function providerId(provider: OutreachProvider, message: NormalizedMessage): string {
  if (message.externalIdentityId?.trim()) return `outreach:${provider}:${message.externalIdentityId.trim()}`
  const fallback = normalizeEmail(message.email)
    ?? normalizeLinkedInUrl(message.linkedinUrl)
    ?? message.externalThreadId.trim()
  if (!fallback) throw new Error('message needs an external thread id')
  return `outreach:${provider}:${digest(['outreach:lead:v1', provider, fallback])}`
}

function identityKey(type: string, value: string): string {
  return `${type}\u0000${value}`
}

async function firstRow(database: Database, sql: string, args: Array<string | number | null>): Promise<Row | null> {
  const result = await database.execute({ sql, args })
  return (result.rows[0] as Row | undefined) ?? null
}

async function execute(database: Database, sql: string, args: Array<string | number | null>): Promise<void> {
  await database.execute({ sql, args })
}

/**
 * Transactional write-side boundary for already-normalized, provider-read
 * pages. It performs no provider I/O and deliberately does not log content or
 * identity values.
 */
export class OutreachRepository {
  constructor(private readonly raw: Client) {}

  async commitPage(input: CommitOutreachPageInput): Promise<CommitOutreachPageResult> {
    requiredString(input.tenantId, 'tenantId')
    requiredString(input.campaignId, 'campaignId')
    requiredString(input.providerRunId, 'providerRunId')
    requiredString(input.syncRunId, 'syncRunId')

    const transaction = await this.raw.transaction('write')
    try {
      const providerRun = await this.requireProviderRun(transaction, input)
      await this.requireSyncRun(transaction, input)

      let insertedMessages = 0
      let identityConflicts = 0
      const processedConversationIds = new Set<string>()
      let pageWatermark = providerRun.syncWatermark

      const orderedMessages = [...input.page.messages].sort((left, right) => (
        normalizedTimestamp(left.providerTimestamp).localeCompare(normalizedTimestamp(right.providerTimestamp))
        || left.externalThreadId.localeCompare(right.externalThreadId)
        || (left.externalMessageId ?? '').localeCompare(right.externalMessageId ?? '')
      ))

      for (const message of orderedMessages) {
        const timestamp = normalizedTimestamp(message.providerTimestamp)
        if (!message.externalThreadId.trim() || !message.bodyText.trim()) {
          throw new Error('normalized message requires a thread id and body text')
        }

        const resolution = await this.resolveLead(
          transaction,
          input,
          message,
          input.manualLeadIdByExternalThreadId?.[message.externalThreadId] ?? null,
        )
        identityConflicts += resolution.identityConflicts
        await this.persistUnambiguousIdentities(transaction, input, resolution)

        const conversationId = await this.upsertConversation(transaction, input, message, resolution.campaignLeadId, timestamp)
        processedConversationIds.add(conversationId)
        const inserted = await this.upsertMessage(transaction, input, message, conversationId, timestamp)
        if (inserted) insertedMessages += 1

        if (pageWatermark === null || timestamp > pageWatermark) pageWatermark = timestamp
      }

      const pageAlreadyCommitted = insertedMessages === 0 && providerRun.syncCursor === input.page.nextCursor
      if (!pageAlreadyCommitted) {
        await execute(transaction, `UPDATE campaign_provider_runs
          SET sync_cursor = ?, sync_watermark = ?, first_message_imported_at = COALESCE(first_message_imported_at, ?), updated_at = datetime('now')
          WHERE id = ? AND tenant_id = ? AND campaign_id = ? AND provider = ?`, [
          input.page.nextCursor,
          pageWatermark,
          orderedMessages[0] ? new Date().toISOString() : null,
          input.providerRunId,
          input.tenantId,
          input.campaignId,
          input.provider,
        ])
        await execute(transaction, `UPDATE outreach_sync_runs
          SET pages_processed = pages_processed + 1,
              conversations_processed = conversations_processed + ?,
              messages_processed = messages_processed + ?,
              malformed_messages = malformed_messages + ?,
              identity_conflicts = identity_conflicts + ?,
              updated_at = datetime('now')
          WHERE id = ? AND tenant_id = ? AND campaign_id = ?`, [
          processedConversationIds.size,
          insertedMessages,
          input.page.normalization.malformed,
          identityConflicts,
          input.syncRunId,
          input.tenantId,
          input.campaignId,
        ])
      }

      await transaction.commit()
      return { insertedMessages, identityConflicts }
    } catch (error) {
      await transaction.rollback()
      throw error
    } finally {
      transaction.close()
    }
  }

  private async requireProviderRun(transaction: Transaction, input: CommitOutreachPageInput): Promise<ScopedProviderRun> {
    const row = await firstRow(transaction, `SELECT sync_cursor, sync_watermark
      FROM campaign_provider_runs
      WHERE id = ? AND tenant_id = ? AND campaign_id = ? AND provider = ?`, [
      input.providerRunId, input.tenantId, input.campaignId, input.provider,
    ])
    if (!row) throw new Error('provider run is outside the tenant or canonical campaign')
    return { syncCursor: asString(row.sync_cursor), syncWatermark: asString(row.sync_watermark) }
  }

  private async requireSyncRun(transaction: Transaction, input: CommitOutreachPageInput): Promise<void> {
    const row = await firstRow(transaction, `SELECT id FROM outreach_sync_runs
      WHERE id = ? AND tenant_id = ? AND campaign_id = ?`, [input.syncRunId, input.tenantId, input.campaignId])
    if (!row) throw new Error('sync run is outside the tenant or canonical campaign')
  }

  private async resolveLead(
    transaction: Transaction,
    input: CommitOutreachPageInput,
    message: NormalizedMessage,
    manualLeadId: string | null,
  ): Promise<LeadResolution> {
    const candidates = buildIdentityCandidates({
      externalIdentityId: message.externalIdentityId,
      linkedinUrl: message.linkedinUrl,
      email: message.email,
    })
    const matchedLeadIds = new Map<string, string>()
    let selectedLeadId: string | null = null
    let identityConflicts = 0

    for (const candidate of candidates) {
      const leadId = await this.findLeadByIdentity(transaction, input, candidate.type, candidate.value)
      if (!leadId) continue
      matchedLeadIds.set(identityKey(candidate.type, candidate.value), leadId)
      if (selectedLeadId === null) selectedLeadId = leadId
      else if (selectedLeadId !== leadId) identityConflicts += 1
    }

    if (selectedLeadId === null && manualLeadId?.trim()) {
      selectedLeadId = await this.findManualLead(transaction, input, manualLeadId.trim())
      if (selectedLeadId === null) throw new Error('manual lead link is outside the tenant or canonical campaign')
    }

    if (selectedLeadId === null) {
      selectedLeadId = randomUUID()
      await execute(transaction, `INSERT INTO campaign_leads
        (id, tenant_id, campaign_id, provider_id, linkedin_url, email, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [
        selectedLeadId,
        input.tenantId,
        input.campaignId,
        providerId(input.provider, message),
        normalizeLinkedInUrl(message.linkedinUrl),
        normalizeEmail(message.email),
        'outreach_import',
      ])
    }

    return { campaignLeadId: selectedLeadId, identityConflicts, candidates, matchedLeadIds }
  }

  private async findLeadByIdentity(
    transaction: Transaction,
    input: CommitOutreachPageInput,
    type: 'provider_id' | 'linkedin_url' | 'email' | 'manual_link',
    value: string,
  ): Promise<string | null> {
    if (type === 'manual_link') return null
    const providerClause = type === 'provider_id' ? 'AND identity.provider = ?' : ''
    const row = await firstRow(transaction, `SELECT identity.campaign_lead_id
      FROM outreach_identities AS identity
      INNER JOIN campaign_leads AS lead
        ON lead.id = identity.campaign_lead_id AND lead.tenant_id = identity.tenant_id
      WHERE identity.tenant_id = ? AND identity.campaign_id = ?
        AND lead.campaign_id = ?
        AND identity.identity_type = ? AND identity.normalized_value = ? ${providerClause}
      LIMIT 1`, [
      input.tenantId,
      input.campaignId,
      input.campaignId,
      type,
      value,
      ...(type === 'provider_id' ? [input.provider] : []),
    ])
    return row ? asString(row.campaign_lead_id) : null
  }

  private async findManualLead(transaction: Transaction, input: CommitOutreachPageInput, manualLeadId: string): Promise<string | null> {
    const row = await firstRow(transaction, `SELECT id FROM campaign_leads
      WHERE id = ? AND tenant_id = ? AND campaign_id = ?`, [manualLeadId, input.tenantId, input.campaignId])
    return row ? asString(row.id) : null
  }

  private async persistUnambiguousIdentities(
    transaction: Transaction,
    input: CommitOutreachPageInput,
    resolution: LeadResolution,
  ): Promise<void> {
    for (const candidate of resolution.candidates) {
      if (candidate.type === 'manual_link') continue
      const matchedLeadId = resolution.matchedLeadIds.get(identityKey(candidate.type, candidate.value))
      // An independently matched identity belongs to another lead. It is
      // evidence of a conflict, never a reason to merge or reassign records.
      if (matchedLeadId && matchedLeadId !== resolution.campaignLeadId) continue
      await execute(transaction, `INSERT INTO outreach_identities
        (id, tenant_id, campaign_id, campaign_lead_id, provider, identity_type, external_identity_id, normalized_value, evidence_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, campaign_id, provider, identity_type, normalized_value) DO NOTHING`, [
        randomUUID(),
        input.tenantId,
        input.campaignId,
        resolution.campaignLeadId,
        input.provider,
        candidate.type,
        candidate.type === 'provider_id' ? candidate.value : null,
        candidate.value,
        candidate.evidenceType,
      ])
    }
  }

  private async upsertConversation(
    transaction: Transaction,
    input: CommitOutreachPageInput,
    message: NormalizedMessage,
    campaignLeadId: string,
    timestamp: string,
  ): Promise<string> {
    const existing = await firstRow(transaction, `SELECT conversation.id, conversation.last_message_at,
      conversation.last_inbound_at, conversation.last_human_outbound_at
      FROM outreach_conversations AS conversation
      INNER JOIN campaign_provider_runs AS run
        ON run.id = conversation.provider_run_id AND run.tenant_id = conversation.tenant_id
      WHERE conversation.tenant_id = ? AND conversation.provider = ? AND conversation.external_thread_id = ?
        AND run.campaign_id = ? AND conversation.provider_run_id = ?
      LIMIT 1`, [input.tenantId, input.provider, message.externalThreadId, input.campaignId, input.providerRunId])
    if (!existing) {
      const id = randomUUID()
      await execute(transaction, `INSERT INTO outreach_conversations
        (id, tenant_id, campaign_lead_id, provider_run_id, provider, channel, external_thread_id,
         last_message_at, last_inbound_at, last_human_outbound_at, last_direction, last_message_kind, first_seen_at, last_synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        id, input.tenantId, campaignLeadId, input.providerRunId, input.provider, message.channel, message.externalThreadId,
        timestamp,
        message.direction === 'inbound' ? timestamp : null,
        message.direction === 'outbound' && message.kind === 'human' ? timestamp : null,
        message.direction, message.kind, timestamp, new Date().toISOString(),
      ])
      return id
    }

    const existingLastMessageAt = asString(existing.last_message_at)
    const isLatest = existingLastMessageAt === null || timestamp >= existingLastMessageAt
    const existingLastInboundAt = asString(existing.last_inbound_at)
    const isLatestInbound = message.direction === 'inbound'
      && (existingLastInboundAt === null || timestamp >= existingLastInboundAt)
    const existingLastHumanOutboundAt = asString(existing.last_human_outbound_at)
    const isLatestHumanOutbound = message.direction === 'outbound' && message.kind === 'human'
      && (existingLastHumanOutboundAt === null || timestamp >= existingLastHumanOutboundAt)
    await execute(transaction, `UPDATE outreach_conversations
      SET last_message_at = CASE WHEN ? THEN ? ELSE last_message_at END,
          last_inbound_at = CASE WHEN ? THEN ? ELSE last_inbound_at END,
          last_human_outbound_at = CASE WHEN ? THEN ? ELSE last_human_outbound_at END,
          last_direction = CASE WHEN ? THEN ? ELSE last_direction END,
          last_message_kind = CASE WHEN ? THEN ? ELSE last_message_kind END,
          last_synced_at = ?
      WHERE id = ? AND tenant_id = ? AND provider_run_id = ?`, [
      isLatest ? 1 : 0, timestamp,
      isLatestInbound ? 1 : 0, timestamp,
      isLatestHumanOutbound ? 1 : 0, timestamp,
      isLatest ? 1 : 0, message.direction,
      isLatest ? 1 : 0, message.kind,
      new Date().toISOString(), asString(existing.id), input.tenantId, input.providerRunId,
    ])
    return asString(existing.id)!
  }

  private async upsertMessage(
    transaction: Transaction,
    input: CommitOutreachPageInput,
    message: NormalizedMessage,
    conversationId: string,
    timestamp: string,
  ): Promise<boolean> {
    const fingerprint = messageFingerprint(input.provider, message)
    const existing = await firstRow(transaction, `SELECT message.id
      FROM outreach_messages AS message
      INNER JOIN outreach_conversations AS conversation
        ON conversation.id = message.outreach_conversation_id AND conversation.tenant_id = message.tenant_id
      INNER JOIN campaign_provider_runs AS run
        ON run.id = conversation.provider_run_id AND run.tenant_id = conversation.tenant_id
      WHERE message.tenant_id = ? AND message.provider = ?
        AND run.campaign_id = ? AND conversation.provider_run_id = ? AND message.provider_run_id = ?
        AND (message.fingerprint = ? OR message.external_message_id = ?)
      LIMIT 1`, [
      input.tenantId,
      input.provider,
      input.campaignId,
      input.providerRunId,
      input.providerRunId,
      fingerprint,
      message.externalMessageId?.trim() || null,
    ])
    if (existing) return false
    await execute(transaction, `INSERT INTO outreach_messages
      (id, tenant_id, outreach_conversation_id, provider_run_id, provider, external_message_id, fingerprint,
       direction, message_kind, subject, body_text, provider_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      randomUUID(), input.tenantId, conversationId, input.providerRunId, input.provider, message.externalMessageId?.trim() || null, fingerprint,
      message.direction, message.kind, message.subject, message.bodyText, timestamp,
    ])
    return true
  }
}
