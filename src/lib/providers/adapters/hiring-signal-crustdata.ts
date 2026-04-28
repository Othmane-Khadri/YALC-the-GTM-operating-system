import type { CapabilityAdapter } from '../capabilities.js'
import { crustdataService } from '../../services/crustdata.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface HiringSignalInput {
  companyDomain?: string
  baselineJobCount?: number
  threshold?: number
  /** Snake-case aliases for markdown skill wiring. */
  company_domain?: string
  baseline_job_count?: number
}

/**
 * Crustdata hiring-signal adapter.
 *
 * Detects whether a company has a meaningful surge in open job postings
 * relative to a baseline. Reads the company's `job_postings_count` via the
 * `enrichCompany` endpoint (cheap — 1 credit cached) and compares to the
 * caller-provided baseline.
 */
export const hiringSignalCrustdataAdapter: CapabilityAdapter = {
  capabilityId: 'hiring-signal',
  providerId: 'crustdata',
  isAvailable: () => !!process.env.CRUSTDATA_API_KEY,
  async execute(input) {
    if (!process.env.CRUSTDATA_API_KEY) {
      throw new MissingApiKeyError('crustdata', 'CRUSTDATA_API_KEY')
    }
    const raw = (input ?? {}) as HiringSignalInput
    const domain = raw.companyDomain ?? raw.company_domain
    if (!domain) {
      throw new ProviderApiError('crustdata', 'companyDomain (or company_domain) is required')
    }
    const baseline = raw.baselineJobCount ?? raw.baseline_job_count ?? 0
    const threshold = raw.threshold ?? 5
    try {
      const company = await crustdataService.enrichCompany(domain)
      const r = company as unknown as Record<string, unknown>
      const currentJobs = Number(r.job_postings_count ?? r.open_jobs ?? 0)
      const delta = currentJobs - baseline
      const changed = delta >= threshold
      return {
        changed,
        summary: changed
          ? `${domain} hiring surge: ${baseline} → ${currentJobs} (+${delta})`
          : `${domain} hiring stable at ${currentJobs}`,
        data: {
          company_domain: domain,
          previous_count: baseline,
          current_count: currentJobs,
          delta,
          threshold,
        },
        newBaseline: { job_count: currentJobs },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('crustdata', message)
    }
  },
}
