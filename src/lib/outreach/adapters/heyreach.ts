import { createHash } from 'node:crypto'
import {
  getChatroom,
  listAllCampaigns,
  listCampaignConversationPage,
  type CampaignConversationPage,
  type Conversation,
} from '../../services/heyreach'
import type {
  MessageDirection,
  MessageKind,
  NormalizedMessage,
  OutreachReadAdapter,
  ProviderCampaign,
  ReadMessagePageInput,
  ReadMessagePageResult,
} from '../contracts'
import { toSafeProviderError, type SafeProviderError } from '../errors'
import { normalizeLinkedInUrl } from '../identity'

const DEFAULT_PAGE_SIZE = 50
const DEFAULT_OVERLAP_MS = 5 * 60_000

export interface HeyReachCampaignConversationReader {
  listCampaignConversationPage(input: {
    campaignId: number
    accountId: number
    offset: number
    limit: number
    bypass?: boolean
  }): Promise<CampaignConversationPage>
  getChatroom(input: {
    accountId: number
    conversationId: string
    bypass?: boolean
  }): Promise<Conversation>
}

/**
 * Scope supplied by the campaign_provider_runs row that owns this adapter.
 * It is deliberately required rather than inferred from the provider: an
 * unscoped HeyReach read can expose another sender's LinkedIn conversations.
 */
export interface HeyReachCampaignReadScope {
  senderAccountId: string | number | null | undefined
  syncWatermark?: string | null
  overlapMs?: number
}

type MessageClassification = {
  direction: MessageDirection
  kind: MessageKind
}

function positiveInteger(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseOffset(cursor: string | null, incremental: boolean): number | null {
  if (cursor === null) return 0
  if (incremental) {
    // A plain offset belongs to the completed initial backfill persisted in
    // campaign_provider_runs. An incremental scan must always restart at zero.
    if (!cursor.startsWith('incremental:')) return 0
    cursor = cursor.slice('incremental:'.length)
  }
  if (!/^\d+$/.test(cursor)) return null
  const parsed = Number(cursor)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

function classify(sender: unknown): MessageClassification | null {
  if (sender === 'ME') return { direction: 'outbound', kind: 'campaign_automated' }
  if (sender === 'CORRESPONDENT') return { direction: 'inbound', kind: 'human' }
  return null
}

function externalMessageId(
  message: { id?: string; messageId?: string; createdAt: string; body: string; sender: string },
  externalThreadId: string,
): string {
  const providerId = typeof message.id === 'string' && message.id.trim()
    ? message.id.trim()
    : typeof message.messageId === 'string' && message.messageId.trim()
      ? message.messageId.trim()
      : null
  if (providerId) return providerId

  // The source fields can carry PII; the emitted fallback never does. Keep
  // tenant and campaign outside this fingerprint so their isolation remains a
  // database-query responsibility rather than an accidental string boundary.
  const source = [externalThreadId, message.sender, message.createdAt, message.body].join('\u0000')
  return `heyreach:${createHash('sha256').update(source).digest('hex')}`
}

function normalizeMessage(
  conversation: Conversation,
  message: NonNullable<Conversation['messages']>[number],
): NormalizedMessage | null {
  const externalThreadId = typeof conversation.id === 'string' && conversation.id.trim()
    ? conversation.id.trim()
    : null
  const classification = classify(message.sender)
  const bodyText = typeof message.body === 'string' && message.body.trim() ? message.body : null
  if (!externalThreadId || !classification || !bodyText || !validTimestamp(message.createdAt)) return null

  const subject = message.subject === null || typeof message.subject === 'string' ? message.subject : null
  if (message.subject !== null && typeof message.subject !== 'string') return null

  return {
    channel: 'linkedin',
    externalMessageId: externalMessageId(message, externalThreadId),
    externalThreadId,
    externalIdentityId: null,
    email: null,
    linkedinUrl: normalizeLinkedInUrl(conversation.correspondentProfile?.profileUrl),
    direction: classification.direction,
    kind: classification.kind,
    subject,
    bodyText,
    providerTimestamp: new Date(message.createdAt).toISOString(),
  }
}

function sortMessages(messages: NormalizedMessage[]): void {
  messages.sort((left, right) => (
    left.providerTimestamp.localeCompare(right.providerTimestamp)
    || left.externalThreadId.localeCompare(right.externalThreadId)
    || (left.externalMessageId ?? '').localeCompare(right.externalMessageId ?? '')
  ))
}

function watermarkCutoff(
  syncWatermark: string | null | undefined,
  overlapMs: number | undefined,
): number | null {
  if (syncWatermark === null || syncWatermark === undefined) return null
  if (!validTimestamp(syncWatermark)) return null
  const overlap = typeof overlapMs === 'number' && Number.isFinite(overlapMs) && overlapMs >= 0
    ? overlapMs
    : DEFAULT_OVERLAP_MS
  return Date.parse(syncWatermark) - overlap
}

/** Deliberately retains only shared safe provider metadata. */
export class HeyReachOutreachReadError extends Error {
  readonly safeError: SafeProviderError

  constructor(safeError: SafeProviderError) {
    super(`HeyReach outreach read failed: ${safeError.category}`)
    this.name = 'HeyReachOutreachReadError'
    this.safeError = safeError
  }
}

const defaultReader: HeyReachCampaignConversationReader = {
  listCampaignConversationPage,
  getChatroom,
}

/** Read-only, sender-scoped adapter for HeyReach LinkedIn conversations. */
export class HeyReachOutreachReadAdapter implements OutreachReadAdapter {
  readonly provider = 'heyreach' as const

  constructor(
    private readonly scope: HeyReachCampaignReadScope,
    private readonly reader: HeyReachCampaignConversationReader = defaultReader,
  ) {}

  async discoverCampaigns(): Promise<ProviderCampaign[]> {
    const senderAccountId = this.senderAccountId()
    try {
      const campaigns = await listAllCampaigns()
      return campaigns
        .filter((campaign) => campaign.campaignAccountIds.includes(senderAccountId))
        .map((campaign) => ({
          externalCampaignId: String(campaign.id),
          externalName: campaign.name,
          externalStatus: campaign.status ?? null,
        }))
    } catch (error) {
      if (error instanceof HeyReachOutreachReadError) throw error
      throw new HeyReachOutreachReadError(toSafeProviderError(error))
    }
  }

  async readMessagePage(input: ReadMessagePageInput): Promise<ReadMessagePageResult> {
    const senderAccountId = this.senderAccountId()
    const campaignId = positiveInteger(input.externalCampaignId)
    const cutoff = watermarkCutoff(this.scope.syncWatermark, this.scope.overlapMs)
    const offset = parseOffset(input.cursor, cutoff !== null)
    if (campaignId === null || offset === null || (this.scope.syncWatermark !== null && this.scope.syncWatermark !== undefined && cutoff === null)) {
      throw new HeyReachOutreachReadError({ category: 'invalid_payload' })
    }

    const requestedPageSize = input.pageSize ?? DEFAULT_PAGE_SIZE
    const limit = Number.isFinite(requestedPageSize)
      ? Math.min(Math.max(Math.floor(requestedPageSize), 1), DEFAULT_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE
    let page: CampaignConversationPage
    try {
      page = await this.reader.listCampaignConversationPage({
        campaignId,
        accountId: senderAccountId,
        offset,
        limit,
        bypass: true,
      })
    } catch (error) {
      throw new HeyReachOutreachReadError(toSafeProviderError(error))
    }

    if (!page || !Array.isArray(page.items)) {
      throw new HeyReachOutreachReadError({ category: 'invalid_payload' })
    }

    const messages: NormalizedMessage[] = []
    let malformed = 0
    let mismatched = 0
    for (const summary of page.items) {
      if (!Number.isSafeInteger(summary.linkedInAccountId) || !Number.isSafeInteger(summary.totalMessages) || summary.totalMessages < 0) {
        malformed += 1
        continue
      }
      if (summary.linkedInAccountId !== senderAccountId) {
        mismatched += 1
        continue
      }
      if (summary.totalMessages === 0) continue
      if (typeof summary.id !== 'string' || !summary.id.trim()) {
        malformed += 1
        continue
      }

      let chatroom = summary
      const needsHydration = !chatroom.messages
        || chatroom.messages.length === 0
        || chatroom.messages.length < chatroom.totalMessages
      if (needsHydration) {
        try {
          chatroom = await this.reader.getChatroom({
            accountId: senderAccountId,
            conversationId: summary.id,
            bypass: true,
          })
        } catch (error) {
          throw new HeyReachOutreachReadError(toSafeProviderError(error))
        }
      }
      if (!Number.isSafeInteger(chatroom.linkedInAccountId) || !Number.isSafeInteger(chatroom.totalMessages) || chatroom.totalMessages < 0) {
        malformed += 1
        continue
      }
      if (chatroom.id !== summary.id || chatroom.linkedInAccountId !== senderAccountId) {
        mismatched += 1
        continue
      }
      if (!chatroom.messages || chatroom.messages.length === 0) continue

      for (const message of chatroom.messages) {
        const normalized = normalizeMessage(chatroom, message)
        if (normalized) messages.push(normalized)
        else malformed += 1
      }
    }

    sortMessages(messages)
    const pageIsEntirelyBeforeWatermark = cutoff !== null
      && page.items.length > 0
      && page.items.every((conversation) => validTimestamp(conversation.lastMessageAt)
        && Date.parse(conversation.lastMessageAt) < cutoff)
    const nextCursor = page.items.length < limit || pageIsEntirelyBeforeWatermark
      ? null
      : cutoff === null
        ? String(offset + page.items.length)
        : `incremental:${offset + page.items.length}`

    return {
      messages,
      nextCursor,
      normalization: { imported: messages.length, malformed, mismatched },
    }
  }

  private senderAccountId(): number {
    const senderAccountId = positiveInteger(this.scope.senderAccountId)
    if (senderAccountId === null) {
      throw new HeyReachOutreachReadError({ category: 'invalid_payload' })
    }
    return senderAccountId
  }
}
