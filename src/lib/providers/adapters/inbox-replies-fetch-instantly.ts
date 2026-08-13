import type { CapabilityAdapter } from '../capabilities.js'
import { InstantlyOutreachReadAdapter } from '../../outreach/adapters/instantly.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface InboxRepliesFetchInput {
  campaignId?: string
  cursor?: string | null
  pageSize?: number
  /** Snake-case aliases. */
  campaign_id?: string
  page_size?: number
}

/**
 * Instantly inbox-replies-fetch adapter.
 *
 * Reads one normalized email page from Instantly's official, campaign-scoped
 * `/api/v2/emails` endpoint. Pagination belongs to the caller; this adapter
 * deliberately does not traverse pages or access a workspace-wide inbox.
 */
export const inboxRepliesFetchInstantlyAdapter: CapabilityAdapter = {
  capabilityId: 'inbox-replies-fetch',
  providerId: 'instantly',
  isAvailable: () => !!process.env.INSTANTLY_API_KEY,
  async execute(input) {
    if (!process.env.INSTANTLY_API_KEY) {
      throw new MissingApiKeyError('instantly', 'INSTANTLY_API_KEY')
    }
    const raw = (input ?? {}) as InboxRepliesFetchInput
    const campaignId = raw.campaignId ?? raw.campaign_id
    if (typeof campaignId !== 'string' || campaignId.length === 0) {
      throw new ProviderApiError(
        'instantly',
        'campaignId (or campaign_id) is required',
      )
    }
    try {
      const page = await new InstantlyOutreachReadAdapter().readMessagePage({
        externalCampaignId: campaignId,
        cursor: raw.cursor ?? null,
        pageSize: raw.pageSize ?? raw.page_size,
      })
      return { replies: page.messages, nextCursor: page.nextCursor }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('instantly', message)
    }
  },
}
