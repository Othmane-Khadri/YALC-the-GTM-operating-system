import { describe, expect, it } from 'vitest'
import { deriveInboxBucket } from '../inbox-state'

const NOW = '2026-08-13T12:00:00.000Z'

describe('deriveInboxBucket', () => {
  it('marks a human inbound without a later human reply as needing a reply', () => {
    expect(deriveInboxBucket([
      {
        conversationId: 'thread-a',
        direction: 'inbound',
        kind: 'human',
        providerTimestamp: '2026-08-13T10:00:00.000Z',
      },
    ], null, NOW)).toBe('needs_reply')
  })

  it('preserves an explicit resolve until a newer actionable inbound arrives', () => {
    expect(deriveInboxBucket([
      {
        conversationId: 'thread-a',
        direction: 'inbound',
        kind: 'human',
        providerTimestamp: '2026-08-13T10:00:00.000Z',
      },
      {
        conversationId: 'thread-a',
        direction: 'outbound',
        kind: 'human',
        providerTimestamp: '2026-08-13T10:01:00.000Z',
      },
    ], {
      inboxState: 'resolved',
      snoozedUntil: null,
      inboxStateUpdatedAt: '2026-08-13T10:02:00.000Z',
    }, NOW)).toBe(null)
  })

  it('does not make auto replies actionable and classifies outbound-only histories as sent', () => {
    expect(deriveInboxBucket([
      {
        conversationId: 'thread-a',
        direction: 'inbound',
        kind: 'auto_reply',
        providerTimestamp: '2026-08-13T10:00:00.000Z',
      },
    ], null, NOW)).toBe(null)

    expect(deriveInboxBucket([
      {
        conversationId: 'thread-a',
        direction: 'outbound',
        kind: 'campaign_automated',
        providerTimestamp: '2026-08-13T10:00:00.000Z',
      },
    ], null, NOW)).toBe('sent')
  })

  it('does not let automated, unknown, or another thread close an actionable inbound', () => {
    expect(deriveInboxBucket([
      {
        conversationId: 'thread-a',
        direction: 'inbound',
        kind: 'human',
        providerTimestamp: '2026-08-13T10:00:00.000Z',
      },
      {
        conversationId: 'thread-a',
        direction: 'outbound',
        kind: 'unknown',
        providerTimestamp: '2026-08-13T10:01:00.000Z',
      },
      {
        conversationId: 'thread-b',
        direction: 'outbound',
        kind: 'human',
        providerTimestamp: '2026-08-13T10:02:00.000Z',
      },
    ], null, NOW)).toBe('needs_reply')
  })

  it('marks a thread as responded only after a later confirmed human outbound in that thread', () => {
    expect(deriveInboxBucket([
      {
        conversationId: 'thread-a',
        direction: 'inbound',
        kind: 'human',
        providerTimestamp: '2026-08-13T10:00:00.000Z',
      },
      {
        conversationId: 'thread-a',
        direction: 'outbound',
        kind: 'human',
        providerTimestamp: '2026-08-13T10:01:00.000Z',
      },
    ], null, NOW)).toBe('responded')
  })

  it('reopens a resolved lead when a later actionable inbound arrives', () => {
    expect(deriveInboxBucket([
      {
        conversationId: 'thread-a',
        direction: 'inbound',
        kind: 'human',
        providerTimestamp: '2026-08-13T10:03:00.000Z',
      },
    ], {
      inboxState: 'resolved',
      snoozedUntil: null,
      inboxStateUpdatedAt: '2026-08-13T10:02:00.000Z',
    }, NOW)).toBe('needs_reply')
  })

  it('holds an active snooze but returns an unanswered inbound to pending after expiry', () => {
    const messages = [{
      conversationId: 'thread-a',
      direction: 'inbound' as const,
      kind: 'human' as const,
      providerTimestamp: '2026-08-13T10:00:00.000Z',
    }]

    expect(deriveInboxBucket(messages, {
      inboxState: 'snoozed',
      snoozedUntil: '2026-08-13T13:00:00.000Z',
      inboxStateUpdatedAt: '2026-08-13T10:01:00.000Z',
    }, NOW)).toBe(null)

    expect(deriveInboxBucket(messages, {
      inboxState: 'snoozed',
      snoozedUntil: '2026-08-13T11:00:00.000Z',
      inboxStateUpdatedAt: '2026-08-13T10:01:00.000Z',
    }, NOW)).toBe('needs_reply')
  })

  it('fails open to pending when a snooze has no state timestamp to prove it is newer', () => {
    expect(deriveInboxBucket([
      {
        conversationId: 'thread-a',
        direction: 'inbound',
        kind: 'human',
        providerTimestamp: '2026-08-13T10:00:00.000Z',
      },
    ], {
      inboxState: 'snoozed',
      snoozedUntil: '2026-08-13T13:00:00.000Z',
      inboxStateUpdatedAt: null,
    }, NOW)).toBe('needs_reply')
  })

  it('reopens an active snooze for an actionable inbound received after the snooze', () => {
    expect(deriveInboxBucket([
      {
        conversationId: 'thread-a',
        direction: 'inbound',
        kind: 'human',
        providerTimestamp: '2026-08-13T10:03:00.000Z',
      },
    ], {
      inboxState: 'snoozed',
      snoozedUntil: '2026-08-13T13:00:00.000Z',
      inboxStateUpdatedAt: '2026-08-13T10:02:00.000Z',
    }, NOW)).toBe('needs_reply')
  })

  it('uses normalized instants and requires a strictly later human response', () => {
    expect(deriveInboxBucket([
      {
        conversationId: 'thread-a',
        direction: 'inbound',
        kind: 'human',
        providerTimestamp: '2026-08-13T08:00:00.000Z',
      },
      {
        conversationId: 'thread-a',
        direction: 'outbound',
        kind: 'human',
        providerTimestamp: '2026-08-13T10:00:00.000+02:00',
      },
    ], null, NOW)).toBe('needs_reply')
  })
})
