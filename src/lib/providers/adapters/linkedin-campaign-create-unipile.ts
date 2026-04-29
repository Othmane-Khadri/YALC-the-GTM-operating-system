import type { CapabilityAdapter } from '../capabilities.js'
import { unipileService } from '../../services/unipile.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface LinkedInCampaignCreateInput {
  accountId?: string
  campaignName?: string
  /** Each lead is `{ provider_id, message? }` for connection-request seed. */
  leads?: Array<{ provider_id?: string; message?: string }>
  /** Sequence is `[{ kind, delay_days?, body? }]` — kind=connection|dm. */
  sequence?: Array<{ kind: 'connection' | 'dm'; delay_days?: number; body: string }>
  /** Snake-case aliases. */
  account_id?: string
  campaign_name?: string
}

interface LinkedInCampaignCreateResult {
  campaignId: string
  status: string
  leadsAttempted: number
  leadsSucceeded: number
  failures: Array<{ provider_id: string; reason: string }>
  sequenceLength: number
  accountId: string
}

/**
 * Unipile linkedin-campaign-create adapter.
 *
 * Creates a logical "campaign" by:
 *   1. Sending the connection-request first step to every lead in `leads`
 *      (carrying the optional per-lead `message` if present, otherwise the
 *      first sequence-step body).
 *   2. Returning a deterministic campaign id derived from accountId + name
 *      + timestamp so the caller can persist it for the subsequent
 *      `campaign:track` poll loop.
 *
 * Multi-step DMs (DM1, DM2) are scheduled by the existing `campaign:track`
 * runner using the persisted sequence — this adapter only kicks the first
 * step. That keeps the adapter surface minimal and side-effects bounded.
 */
export const linkedinCampaignCreateUnipileAdapter: CapabilityAdapter = {
  capabilityId: 'linkedin-campaign-create',
  providerId: 'unipile',
  isAvailable: () => !!(process.env.UNIPILE_API_KEY && process.env.UNIPILE_DSN),
  async execute(input) {
    if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) {
      throw new MissingApiKeyError('unipile', 'UNIPILE_API_KEY/UNIPILE_DSN')
    }
    const raw = (input ?? {}) as LinkedInCampaignCreateInput
    const accountId = raw.accountId ?? raw.account_id
    const campaignName = (raw.campaignName ?? raw.campaign_name ?? '').trim()
    const leads = Array.isArray(raw.leads) ? raw.leads : []
    const sequence = Array.isArray(raw.sequence) ? raw.sequence : []

    if (!accountId) {
      throw new ProviderApiError('unipile', 'accountId (or account_id) is required')
    }
    if (!campaignName) {
      throw new ProviderApiError('unipile', 'campaignName is required')
    }
    if (leads.length === 0) {
      throw new ProviderApiError('unipile', 'leads must be a non-empty array')
    }
    if (sequence.length === 0) {
      throw new ProviderApiError('unipile', 'sequence must be a non-empty array')
    }
    const firstStep = sequence[0]
    if (firstStep.kind !== 'connection' && firstStep.kind !== 'dm') {
      throw new ProviderApiError('unipile', 'sequence[0].kind must be "connection" or "dm"')
    }

    const campaignId = `linkedin-${accountId}-${slugify(campaignName)}-${Date.now()}`
    const failures: LinkedInCampaignCreateResult['failures'] = []
    let succeeded = 0

    for (const lead of leads) {
      const providerId = (lead.provider_id ?? '').trim()
      if (!providerId) {
        failures.push({ provider_id: '', reason: 'missing provider_id' })
        continue
      }
      const messageBody = (lead.message ?? firstStep.body).slice(0, 300)
      try {
        if (firstStep.kind === 'connection') {
          await unipileService.sendConnection(accountId, providerId, messageBody)
        } else {
          await unipileService.sendMessage(accountId, providerId, messageBody)
        }
        succeeded++
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        failures.push({ provider_id: providerId, reason })
      }
    }

    const result: LinkedInCampaignCreateResult = {
      campaignId,
      status: succeeded > 0 ? 'started' : 'failed',
      leadsAttempted: leads.length,
      leadsSucceeded: succeeded,
      failures,
      sequenceLength: sequence.length,
      accountId,
    }
    return result
  },
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48)
}
