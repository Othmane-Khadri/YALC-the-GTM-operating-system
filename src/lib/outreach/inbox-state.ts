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

const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function timestamp(value: string | Date, name: string): number {
  if (typeof value === 'string') {
    const parts = TIMESTAMP_PATTERN.exec(value)
    if (!parts) throw new RangeError(`${name} must be an ISO 8601 timestamp with a timezone`)

    const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , , offsetHourText, offsetMinuteText] = parts
    const year = Number(yearText)
    const month = Number(monthText)
    const day = Number(dayText)
    const hour = Number(hourText)
    const minute = Number(minuteText)
    const second = Number(secondText)
    const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText)
    const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText)
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)
      || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
      throw new RangeError(`${name} must be a valid timestamp`)
    }
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
  const unansweredInboundTimestamps: number[] = []
  let hasOutbound = false
  for (const conversation of messagesByConversation.values()) {
    const humanOutboundTimestamps = conversation
      .filter((message) => message.direction === 'outbound' && message.kind === 'human')
      .map((message) => message.timestamp)
    for (const message of conversation) {
      if (message.direction === 'outbound') hasOutbound = true
      if (message.direction === 'inbound' && message.kind === 'human') {
        actionableInboundTimestamps.push(message.timestamp)
        if (!humanOutboundTimestamps.some((outboundTimestamp) => outboundTimestamp > message.timestamp)) {
          unansweredInboundTimestamps.push(message.timestamp)
        }
      }
    }
  }

  const stateUpdatedAt = localState?.inboxState === 'resolved' || localState?.inboxState === 'snoozed'
    ? localState.inboxStateUpdatedAt === null ? null : timestamp(localState.inboxStateUpdatedAt, 'inboxStateUpdatedAt')
    : null
  const hasInboundAfterLocalState = stateUpdatedAt !== null
    && actionableInboundTimestamps.some((inboundTimestamp) => inboundTimestamp > stateUpdatedAt)
  const activeSnooze = localState?.inboxState === 'snoozed'
    && localState.snoozedUntil !== null
    && timestamp(localState.snoozedUntil, 'snoozedUntil') > nowTimestamp

  if (unansweredInboundTimestamps.length > 0) {
    if (activeSnooze && stateUpdatedAt !== null && !hasInboundAfterLocalState) return null
    if (localState?.inboxState === 'resolved' && stateUpdatedAt !== null && !hasInboundAfterLocalState) return null
    return 'needs_reply'
  }

  if (localState?.inboxState === 'resolved' && stateUpdatedAt !== null && !hasInboundAfterLocalState) return null
  if (activeSnooze && stateUpdatedAt !== null && !hasInboundAfterLocalState) return null
  if (actionableInboundTimestamps.length > 0) return 'responded'
  return hasOutbound ? 'sent' : null
}
