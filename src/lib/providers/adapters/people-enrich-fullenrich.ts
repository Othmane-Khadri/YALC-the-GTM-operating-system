import type { CapabilityAdapter } from '../capabilities.js'
import { fullenrichService, type FullEnrichContact } from '../../services/fullenrich.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface PeopleEnrichInput {
  contacts: FullEnrichContact[]
}

export const peopleEnrichFullenrichAdapter: CapabilityAdapter = {
  capabilityId: 'people-enrich',
  providerId: 'fullenrich',
  async execute(input) {
    if (!process.env.FULLENRICH_API_KEY) {
      throw new MissingApiKeyError('fullenrich', 'FULLENRICH_API_KEY')
    }
    const { contacts } = (input ?? {}) as PeopleEnrichInput
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return { results: [] }
    }
    try {
      const enrichmentId = await fullenrichService.enrichBulk(contacts)
      const results = await fullenrichService.pollResults(enrichmentId)
      return { results }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('fullenrich', message)
    }
  },
}
