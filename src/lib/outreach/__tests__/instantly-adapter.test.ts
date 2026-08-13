import { describe, expect, it, vi } from 'vitest'
import fixture from './fixtures/instantly-email-page.json'
import { InstantlyService } from '../../services/instantly'
import {
  InstantlyOutreachReadAdapter,
  type InstantlyCampaignEmailReader,
} from '../adapters/instantly'
import type { InstantlyEmail } from '../../services/instantly'

const campaignId = 'inst-campaign-42'

describe('Instantly campaign email reader', () => {
  it('uses the official v2 campaign email query with bounded pagination and watermark filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], next_starting_after: null }),
    })
    vi.stubEnv('INSTANTLY_API_KEY', 'test-key-not-a-provider-secret')
    vi.stubGlobal('fetch', fetchMock)

    await new InstantlyService().listCampaignEmails({
      campaignId,
      limit: 500,
      startingAfter: 'email-100',
      minTimestampCreated: '2026-08-13T00:00:00.000Z',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.instantly.ai/api/v2/emails?campaign_id=inst-campaign-42&limit=100&starting_after=email-100&min_timestamp_created=2026-08-13T00%3A00%3A00.000Z',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' })

    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
})

describe('Instantly outreach read adapter', () => {
  it('reads exactly one official page per call, advances the cursor, and normalizes only exact campaign messages', async () => {
    const calls: Array<{
      campaignId: string
      limit: number
      startingAfter: string | null
    }> = []
    const pages = [
      fixture,
      {
        items: [
          {
            id: 'email-200',
            campaign_id: campaignId,
            thread_id: 'thread-11',
            timestamp_created: '2026-08-13T10:00:00.000Z',
            body: { text: 'Second page plain text', html: '<p>Second page plain text</p>' },
            lead: 'recipient@example.test',
            lead_id: 'lead-11',
            ue_type: 2,
            is_auto_reply: 0,
          },
        ],
        next_starting_after: null,
      },
    ]
    const reader: InstantlyCampaignEmailReader = {
      async listCampaignEmails(input) {
        calls.push({
          campaignId: input.campaignId,
          limit: input.limit ?? 100,
          startingAfter: input.startingAfter ?? null,
        })
        const page = pages[calls.length - 1] as {
          items: InstantlyEmail[]
          next_starting_after: string | null
        }
        return { items: page.items, nextStartingAfter: page.next_starting_after }
      },
    }
    const adapter = new InstantlyOutreachReadAdapter(reader)

    const firstPage = await adapter.readMessagePage({ externalCampaignId: campaignId, cursor: null })
    const secondPage = await adapter.readMessagePage({
      externalCampaignId: campaignId,
      cursor: firstPage.nextCursor,
    })

    expect(calls).toEqual([
      { campaignId, limit: 100, startingAfter: null },
      { campaignId, limit: 100, startingAfter: 'email-100' },
    ])
    expect(firstPage.nextCursor).toBe('email-100')
    expect(secondPage.nextCursor).toBeNull()
    expect(firstPage.messages).toMatchObject([
      {
        externalMessageId: 'email-100',
        channel: 'email',
        direction: 'inbound',
        kind: 'human',
        externalThreadId: 'thread-7',
        externalIdentityId: 'lead-7',
        email: 'recipient@example.test',
        bodyText: 'Please send the details.',
      },
      { externalMessageId: 'email-101', direction: 'outbound', kind: 'campaign_automated' },
      { externalMessageId: 'email-102', direction: 'inbound', kind: 'auto_reply' },
      { externalMessageId: 'email-103', direction: 'outbound', kind: 'human' },
      { externalMessageId: 'email-104', direction: 'outbound', kind: 'campaign_automated' },
      { externalMessageId: 'email-105', direction: 'outbound', kind: 'unknown' },
    ])
    expect(firstPage.messages).toHaveLength(6)
    expect(JSON.stringify(firstPage.messages)).not.toContain('<img')
    expect(JSON.stringify(firstPage.messages)).not.toContain('attachment_json')
    expect(secondPage.messages).toMatchObject([
      { externalMessageId: 'email-200', bodyText: 'Second page plain text' },
    ])
  })
})
