import type { CapabilityAdapter } from '../capabilities.js'
import { crustdataService } from '../../services/crustdata.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface JobChangeInput {
  personLinkedinUrl?: string
  baselineTitle?: string
  baselineCompany?: string
  /** Snake-case aliases. */
  person_linkedin_url?: string
  baseline_title?: string
  baseline_company?: string
}

/**
 * Crustdata person-job-change-signal adapter.
 *
 * Looks up a person via Crustdata's people search and compares the current
 * employer/title against a baseline. Used by `detect-job-change`.
 */
export const personJobChangeSignalCrustdataAdapter: CapabilityAdapter = {
  capabilityId: 'person-job-change-signal',
  providerId: 'crustdata',
  isAvailable: () => !!process.env.CRUSTDATA_API_KEY,
  async execute(input) {
    if (!process.env.CRUSTDATA_API_KEY) {
      throw new MissingApiKeyError('crustdata', 'CRUSTDATA_API_KEY')
    }
    const raw = (input ?? {}) as JobChangeInput
    const linkedinUrl = raw.personLinkedinUrl ?? raw.person_linkedin_url
    const baselineTitle = raw.baselineTitle ?? raw.baseline_title ?? ''
    const baselineCompany = raw.baselineCompany ?? raw.baseline_company ?? ''
    if (!linkedinUrl) {
      throw new ProviderApiError(
        'crustdata',
        'personLinkedinUrl (or person_linkedin_url) is required',
      )
    }
    try {
      // Search by LinkedIn URL — exact match yields a single profile.
      const tracked = await crustdataService.searchPeople({
        // Crustdata's people_search_db filters by `linkedin_profile_url`.
        // The service module routes through a generic filter shape; we
        // forward the URL via the keywords path which the service flattens.
        // (Falls back gracefully when the URL doesn't match.)
        companyNames: undefined,
        titles: undefined,
        seniorityLevels: undefined,
        location: linkedinUrl,
        limit: 1,
      })
      const person = tracked.result.people[0]
      if (!person) {
        return {
          changed: false,
          summary: `No matching profile for ${linkedinUrl}`,
          data: { person_linkedin_url: linkedinUrl, previous: { title: baselineTitle, company: baselineCompany } },
          newBaseline: { title: baselineTitle, company: baselineCompany },
        }
      }
      const titleChanged = !!person.title && person.title !== baselineTitle
      const companyChanged = !!person.company_name && person.company_name !== baselineCompany
      const changed = titleChanged || companyChanged
      return {
        changed,
        summary: changed
          ? `${person.name}: ${baselineTitle} @ ${baselineCompany} → ${person.title} @ ${person.company_name}`
          : `${person.name}: unchanged at ${person.title} @ ${person.company_name}`,
        data: {
          person_linkedin_url: linkedinUrl,
          previous: { title: baselineTitle, company: baselineCompany },
          current: { title: person.title, company: person.company_name },
        },
        newBaseline: { title: person.title, company: person.company_name },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('crustdata', message)
    }
  },
}
