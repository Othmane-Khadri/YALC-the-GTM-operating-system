import type { CapabilityAdapter } from '../capabilities.js'
import { instantlyService, type SequenceStep } from '../../services/instantly.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface EmailCampaignCreateInput {
  campaignName?: string
  leads?: Array<{ email: string; first_name?: string; last_name?: string; company?: string }>
  sequence?: Array<{ subject?: string; body: string; delay_days?: number; variant_label?: string }>
  accountIds?: string[]
  schedule?: {
    timezone?: string
    days?: Record<string, { start: string; end: string }>
  }
  /** Snake-case aliases. */
  campaign_name?: string
  account_ids?: string[]
}

interface EmailCampaignCreateResult {
  campaignId: string
  status: string
  leadsAttempted: number
  leadsAdded: number
  sequenceLength: number
}

/**
 * Instantly email-campaign-create adapter.
 *
 * Creates a campaign in Instantly via `POST /api/v2/campaigns`, attaches
 * the supplied leads via `addLeadsToCampaign`, and resumes it so the
 * sequence starts dripping immediately. Returns the campaign id so the
 * caller can persist it for `campaign:report` and reply-tracking.
 */
export const emailCampaignCreateInstantlyAdapter: CapabilityAdapter = {
  capabilityId: 'email-campaign-create',
  providerId: 'instantly',
  isAvailable: () => !!process.env.INSTANTLY_API_KEY,
  async execute(input) {
    if (!process.env.INSTANTLY_API_KEY) {
      throw new MissingApiKeyError('instantly', 'INSTANTLY_API_KEY')
    }
    const raw = (input ?? {}) as EmailCampaignCreateInput
    const campaignName = (raw.campaignName ?? raw.campaign_name ?? '').trim()
    const leads = Array.isArray(raw.leads) ? raw.leads : []
    const sequence = Array.isArray(raw.sequence) ? raw.sequence : []
    const accountIds = raw.accountIds ?? raw.account_ids

    if (!campaignName) {
      throw new ProviderApiError('instantly', 'campaignName is required')
    }
    if (sequence.length === 0) {
      throw new ProviderApiError('instantly', 'sequence must be a non-empty array')
    }

    const sequences: SequenceStep[] = sequence.map((s) => ({
      subject: s.subject,
      body: s.body,
      delay_days: s.delay_days,
      variant_label: s.variant_label,
    }))

    let campaign
    try {
      campaign = await instantlyService.createCampaign({
        name: campaignName,
        account_ids: accountIds,
        sequences,
        schedule: raw.schedule,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('instantly', `createCampaign failed: ${message}`)
    }

    let leadsAdded = 0
    if (leads.length > 0) {
      try {
        await instantlyService.addLeadsToCampaign(campaign.id, leads)
        leadsAdded = leads.length
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new ProviderApiError('instantly', `addLeadsToCampaign failed: ${message}`)
      }
    }

    try {
      await instantlyService.resumeCampaign(campaign.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Don't blow up if resume fails — the campaign + leads are already in
      // place; the user can resume manually from the Instantly UI.
      // eslint-disable-next-line no-console
      console.warn(`[instantly] resumeCampaign(${campaign.id}) failed: ${message}`)
    }

    const result: EmailCampaignCreateResult = {
      campaignId: campaign.id,
      status: 'started',
      leadsAttempted: leads.length,
      leadsAdded,
      sequenceLength: sequence.length,
    }
    return result
  },
}
