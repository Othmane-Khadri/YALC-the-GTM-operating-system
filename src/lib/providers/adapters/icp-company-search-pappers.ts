import type { CapabilityAdapter } from '../capabilities.js'
import { pappersService, type PappersSearchInput } from '../../services/pappers.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

/**
 * Pappers ICP company search adapter.
 *
 * Stub implementation — delegates to `PappersService.searchCompanies`
 * which currently throws "not yet implemented" so a misconfigured
 * priority list surfaces a clear error instead of silently returning
 * an empty list. The knowledge-base entry references this module so
 * `connect-provider pappers` resolves end-to-end; full wire-up is
 * tracked separately.
 */
export const icpCompanySearchPappersAdapter: CapabilityAdapter = {
  capabilityId: 'icp-company-search',
  providerId: 'pappers',
  isAvailable: () => !!process.env.PAPPERS_API_KEY,
  async execute(input) {
    const apiKey = process.env.PAPPERS_API_KEY
    if (!apiKey) {
      throw new MissingApiKeyError('pappers', 'PAPPERS_API_KEY')
    }
    const filters = (input ?? {}) as PappersSearchInput
    try {
      const companies = await pappersService.searchCompanies(filters)
      return { companies }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('pappers', message)
    }
  },
}
