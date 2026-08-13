import type { MessageDirection, MessageKind } from './contracts'

export type InboxBucket = 'needs_reply' | 'responded' | 'sent' | null

export interface InboxStateMessage {
  conversationId: string
  direction: MessageDirection
  kind: MessageKind
  providerTimestamp: string
}

export interface LocalInboxState {
  inboxState: 'pending' | 'resolved' | 'snoozed' | null
  snoozedUntil: string | null
  inboxStateUpdatedAt: string | null
}

function timestamp(value: string | Date, name: string): number {
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new RangeError(`${name} must be an ISO 8601 timestamp with a timezone`)
  }
  const result = new Date(value).getTime()
  if (Number.isNaN(result)) throw new RangeError(`${name} must be a valid timestamp`)
  return result
}

/**
 * Calculates a read-only, conservative Inbox bucket. A reply closes only the
 * actionable inbound messages in its own provider conversation.
 */
export function deriveInboxBucket(
  messages: readonly InboxStateMessage[],
  localState: LocalInboxState | null,
  now: string | Date,
): InboxBucket {
  const nowTimestamp = timestamp(now, 'now')
  const messagesByConversation = new Map<string, Array<{ direction: MessageDirection, kind: MessageKind, timestamp: number }>>()

  for (const message of messages) {
    if (!message.conversationId.trim()) throw new Error('conversationId is required')
    const conversation = messagesByConversation.get(message.conversationId) ?? []
    conversation.push({
      direction: message.direction,
      kind: message.kind,
      timestamp: timestamp(message.providerTimestamp, 'providerTimestamp'),
    })
    messagesByConversation.set(message.conversationId, conversation)
  }

  const actionableInboundTimestamps: number[] = []
  let hasOutbound = false
  for (const conversation of messagesByConversation.values()) {
    const humanOutboundTimestamps = conversation
      .filter((message) => message.direction === 'outbound' && message.kind === 'human')
      .map((message) => message.timestamp)
    for (const message of conversation) {
      if (message.direction === 'outbound') hasOutbound = true
      if (message.direction === 'inbound' && message.kind === 'human'
        && !humanOutboundTimestamps.some((outboundTimestamp) => outboundTimestamp > message.timestamp)) {
        actionableInboundTimestamps.push(message.timestamp)
      }
    }
  }

  if (actionableInboundTimestamps.length > 0) {
    const stateUpdatedAt = localState?.inboxStateUpdatedAt === null || localState?.inboxStateUpdatedAt === undefined
      ? null
      : timestamp(localState.inboxStateUpdatedAt, 'inboxStateUpdatedAt')
    const hasInboundAfterLocalState = stateUpdatedAt !== null
      && actionableInboundTimestamps.some((inboundTimestamp) => inboundTimestamp > stateUpdatedAt)
    const activeSnooze = localState?.inboxState === 'snoozed'
      && localState.snoozedUntil !== null
      && timestamp(localState.snoozedUntil, 'snoozedUntil') > nowTimestamp

    if (activeSnooze && stateUpdatedAt !== null && !hasInboundAfterLocalState) return null
    if (localState?.inboxState === 'resolved' && stateUpdatedAt !== null && !hasInboundAfterLocalState) return null
    return 'needs_reply'
  }

  const hasHumanInbound = messages.some((message) => message.direction === 'inbound' && message.kind === 'human')
  if (localState?.inboxState === 'resolved') return null
  if (localState?.inboxState === 'snoozed' && localState.snoozedUntil !== null
    && timestamp(localState.snoozedUntil, 'snoozedUntil') > nowTimestamp) return null
  if (hasHumanInbound) return 'responded'
  return hasOutbound ? 'sent' : null
}
