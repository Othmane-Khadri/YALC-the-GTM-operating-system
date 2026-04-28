import type { CapabilityAdapter } from '../capabilities.js'
import { instantlyService } from '../../services/instantly.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface InboxRepliesFetchInput {
  lookbackHours?: number
  limit?: number
  /** Snake-case alias. */
  lookback_hours?: number
}

/**
 * Instantly inbox-replies-fetch adapter.
 *
 * Pulls inbound emails from Instantly's `/api/v2/unibox/emails` endpoint
 * within the requested lookback window. The Brevo equivalent will plug in
 * once the Brevo MCP ships; the capability registry's `defaultPriority`
 * already lists Brevo as a fallback.
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
    const lookbackHours = raw.lookbackHours ?? raw.lookback_hours
    if (typeof lookbackHours !== 'number' || lookbackHours <= 0) {
      throw new ProviderApiError(
        'instantly',
        'lookbackHours (or lookback_hours) is required and must be a positive number',
      )
    }
    try {
      const replies = await instantlyService.listInboxReplies({
        lookbackHours,
        limit: raw.limit,
      })
      return { replies }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('instantly', message)
    }
  },
}
