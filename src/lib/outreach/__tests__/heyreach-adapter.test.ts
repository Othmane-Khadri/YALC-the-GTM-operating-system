import { beforeEach, describe, expect, it, vi } from 'vitest'
import chatroom from './fixtures/heyreach-chatroom.json'
import partialSummary from './fixtures/heyreach-partial-summary.json'

vi.mock('../../services/heyreach', () => ({
  listAllCampaigns: vi.fn(),
  listCampaignConversationPage: vi.fn(),
  getChatroom: vi.fn(),
}))

import {
  getChatroom,
  listCampaignConversationPage,
} from '../../services/heyreach'
import type { Conversation } from '../../services/heyreach'
import { HeyReachOutreachReadAdapter } from '../adapters/heyreach'

const campaignId = '9001'

describe('HeyReach outreach read adapter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('uses the exact campaign and required sender scope, hydrates message-bearing rooms, and normalizes messages', async () => {
    vi.mocked(listCampaignConversationPage).mockResolvedValue({
      items: [
        {
          id: 'chat-1',
          read: false,
          totalMessages: 2,
          linkedInAccountId: 77,
          lastMessageAt: '2026-08-13T09:02:00.000Z',
        },
        {
          id: 'chat-empty',
          read: false,
          totalMessages: 0,
          linkedInAccountId: 77,
        },
      ],
      totalCount: 2,
    })
    vi.mocked(getChatroom).mockResolvedValue(chatroom as Conversation)

    const result = await new HeyReachOutreachReadAdapter({ senderAccountId: '77' })
      .readMessagePage({ externalCampaignId: campaignId, cursor: null })

    expect(listCampaignConversationPage).toHaveBeenCalledWith({
      campaignId: 9001,
      accountId: 77,
      offset: 0,
      limit: 50,
      bypass: true,
    })
    expect(getChatroom).toHaveBeenCalledWith({ accountId: 77, conversationId: 'chat-1', bypass: true })
    expect(result.messages.map((item) => item.direction)).toEqual(['outbound', 'inbound'])
    expect(result.messages.every((item) => item.externalThreadId === 'chat-1')).toBe(true)
    expect(result.messages.map((item) => item.externalMessageId)).toEqual([
      expect.stringMatching(/^heyreach:[a-f0-9]{64}$/),
      expect.stringMatching(/^heyreach:[a-f0-9]{64}$/),
    ])
    expect(result.messages[0]?.externalMessageId).not.toBe(result.messages[1]?.externalMessageId)
    expect(result.normalization).toEqual({ imported: 2, malformed: 0, mismatched: 0 })
    expect(result.nextCursor).toBeNull()
  })

  it('keeps the next offset for backfill, but stops an incremental page wholly before its overlap window', async () => {
    const currentPage = Array.from({ length: 50 }, (_, index) => ({
      id: `chat-${index}`,
      read: false,
      totalMessages: 0,
      linkedInAccountId: 77,
      lastMessageAt: '2026-08-13T10:00:00.000Z',
    }))
    vi.mocked(listCampaignConversationPage).mockResolvedValueOnce({ totalCount: 100, items: currentPage })
    vi.mocked(listCampaignConversationPage).mockResolvedValueOnce({
      totalCount: 100,
      items: currentPage.map((conversation) => ({
        ...conversation,
        lastMessageAt: '2026-08-13T08:00:00.000Z',
      })),
    })

    const backfill = new HeyReachOutreachReadAdapter({ senderAccountId: 77 })
    const incremental = new HeyReachOutreachReadAdapter({
      senderAccountId: 77,
      syncWatermark: '2026-08-13T09:00:00.000Z',
      overlapMs: 60_000,
    })

    await expect(backfill.readMessagePage({ externalCampaignId: campaignId, cursor: null }))
      .resolves.toMatchObject({ nextCursor: '50' })
    await expect(incremental.readMessagePage({
      externalCampaignId: campaignId,
      cursor: '50',
      syncRunId: 'incremental-run-1',
    }))
      .resolves.toMatchObject({ nextCursor: null })
    expect(listCampaignConversationPage).toHaveBeenLastCalledWith({
      campaignId: 9001,
      accountId: 77,
      offset: 0,
      limit: 50,
      bypass: true,
    })
  })

  it('continues an interrupted incremental run only when its opaque cursor belongs to that run', async () => {
    const currentPage = Array.from({ length: 50 }, (_, index) => ({
      id: `chat-${index}`,
      read: false,
      totalMessages: 0,
      linkedInAccountId: 77,
      lastMessageAt: '2026-08-13T10:00:00.000Z',
    }))
    vi.mocked(listCampaignConversationPage).mockResolvedValue({ totalCount: 150, items: currentPage })
    const scope = {
      senderAccountId: 77,
      syncWatermark: '2026-08-13T09:00:00.000Z',
      overlapMs: 60_000,
    }

    const firstPage = await new HeyReachOutreachReadAdapter(scope).readMessagePage({
      externalCampaignId: campaignId,
      cursor: null,
      syncRunId: 'run-alpha',
    })
    expect(firstPage.nextCursor).toMatch(/^incremental:[a-f0-9]{64}:50$/)
    expect(firstPage.nextCursor).not.toContain('run-alpha')

    await new HeyReachOutreachReadAdapter(scope).readMessagePage({
      externalCampaignId: campaignId,
      cursor: firstPage.nextCursor,
      syncRunId: 'run-alpha',
    })
    expect(listCampaignConversationPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 }))

    await new HeyReachOutreachReadAdapter(scope).readMessagePage({
      externalCampaignId: campaignId,
      cursor: firstPage.nextCursor,
      syncRunId: 'run-beta',
    })
    expect(listCampaignConversationPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }))
  })

  it('rejects invalid sender scope without making an unscoped provider read', async () => {
    await expect(
      new HeyReachOutreachReadAdapter({ senderAccountId: null })
        .readMessagePage({ externalCampaignId: campaignId, cursor: null }),
    ).rejects.toMatchObject({ safeError: { category: 'invalid_payload' } })
    expect(listCampaignConversationPage).not.toHaveBeenCalled()
  })

  it('hydrates a nonempty preview when it does not contain the complete chatroom transcript', async () => {
    vi.mocked(listCampaignConversationPage).mockResolvedValue({
      totalCount: 1,
      items: [partialSummary.summary as Conversation],
    })
    vi.mocked(getChatroom).mockResolvedValue(partialSummary.chatroom as Conversation)

    const result = await new HeyReachOutreachReadAdapter({ senderAccountId: 77 })
      .readMessagePage({ externalCampaignId: campaignId, cursor: null })

    expect(getChatroom).toHaveBeenCalledWith({ accountId: 77, conversationId: 'chat-preview', bypass: true })
    expect(result.messages.map((message) => message.bodyText)).toEqual([
      'Full transcript first message',
      'Full transcript reply',
      'Full transcript follow-up',
    ])
    expect(result.messages.map((message) => message.direction)).toEqual(['outbound', 'inbound', 'outbound'])
    expect(result.normalization).toEqual({ imported: 3, malformed: 0, mismatched: 0 })
  })

  it('returns only aggregate counts for mismatched conversations and malformed messages', async () => {
    const reader = {
      async listCampaignConversationPage() {
        return {
          totalCount: 2,
          items: [
            { id: 'wrong-sender', read: false, totalMessages: 1, linkedInAccountId: 78 },
            { id: 'bad-message', read: false, totalMessages: 1, linkedInAccountId: 77 },
          ],
        }
      },
      async getChatroom() {
        return {
          id: 'bad-message',
          read: false,
          totalMessages: 1,
          linkedInAccountId: 77,
          messages: [{
            createdAt: 'invalid-timestamp',
            body: 'Provider message must not escape through counts',
            subject: null,
            postLink: null,
            isInMail: false,
            sender: 'CORRESPONDENT' as const,
          }],
        }
      },
    }

    await expect(new HeyReachOutreachReadAdapter({ senderAccountId: 77 }, reader)
      .readMessagePage({ externalCampaignId: campaignId, cursor: null }))
      .resolves.toMatchObject({
        messages: [],
        normalization: { imported: 0, malformed: 1, mismatched: 1 },
      })
  })
})
