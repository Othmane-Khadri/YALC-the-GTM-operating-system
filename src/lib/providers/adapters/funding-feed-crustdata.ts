import type { CapabilityAdapter } from '../capabilities.js'
import { crustdataService } from '../../services/crustdata.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface FundingFeedInput {
  /** ICP segments to filter the feed by (e.g. industry hint). */
  segments?: string
  /** Skip rounds smaller than this dollar amount. */
  minRoundSizeUsd?: number
  /** Window like "24h" or "7d". */
  window?: string
  /** Optional cap on results. */
  limit?: number
  /** When set, the adapter compares against the stored baseline_funding_total
   *  for one specific company domain (used by `detect-funding`). */
  companyDomain?: string
  baselineFundingTotal?: number
  /** Snake-case aliases — markdown skills wire variables this way. */
  min_round_size_usd?: number
  company_domain?: string
  baseline_funding_total?: number
}

interface FundingRow {
  domain: string
  name: string
  round_type: string
  round_size_usd: number
  lead_investor: string
  announced_at: string
  rationale: string
}

const WINDOW_DAYS: Record<string, number> = {
  '24h': 1,
  '48h': 2,
  '72h': 3,
  '7d': 7,
  '14d': 14,
  '30d': 30,
}

function windowToCutoffIso(window: string | undefined): string {
  const days = window ? WINDOW_DAYS[window] ?? 1 : 1
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

/**
 * Crustdata funding-feed adapter.
 *
 * Two operating modes:
 * 1. Feed mode (default): scan recent funding announcements via
 *    `searchCompanies` filtered by `funding_stage` + `last_round_date`.
 * 2. Single-company mode: when a `companyDomain` + `baselineFundingTotal`
 *    are provided we delegate to `enrichCompany` and emit a delta event.
 *    This is the path `detect-funding.md` exercises.
 */
export const fundingFeedCrustdataAdapter: CapabilityAdapter = {
  capabilityId: 'funding-feed',
  providerId: 'crustdata',
  isAvailable: () => !!process.env.CRUSTDATA_API_KEY,
  async execute(input) {
    if (!process.env.CRUSTDATA_API_KEY) {
      throw new MissingApiKeyError('crustdata', 'CRUSTDATA_API_KEY')
    }
    const raw = (input ?? {}) as FundingFeedInput
    const companyDomain = raw.companyDomain ?? raw.company_domain
    const baseline = raw.baselineFundingTotal ?? raw.baseline_funding_total

    if (companyDomain) {
      try {
        const company = await crustdataService.enrichCompany(companyDomain)
        const companyAsRecord = company as unknown as Record<string, unknown>
        const currentTotalRaw = companyAsRecord.total_funding_usd
        const currentTotal = typeof currentTotalRaw === 'number' ? currentTotalRaw : 0
        const previous = typeof baseline === 'number' ? baseline : 0
        const changed = currentTotal > previous
        return {
          changed,
          summary: changed
            ? `${companyDomain} raised new funding: total now ${currentTotal} (previously ${previous})`
            : `${companyDomain} unchanged at ${currentTotal}`,
          data: {
            company_domain: companyDomain,
            previous_total: previous,
            current_total: currentTotal,
            delta: currentTotal - previous,
            company,
          },
          newBaseline: { funding_total: currentTotal },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new ProviderApiError('crustdata', message)
      }
    }

    // Feed mode. Use the company search endpoint with funding signal hints.
    const minRound = raw.minRoundSizeUsd ?? raw.min_round_size_usd ?? 0
    try {
      const companies = await crustdataService.searchCompanies({
        keywords: raw.segments,
        limit: raw.limit,
      })
      const cutoff = windowToCutoffIso(raw.window)
      const rows: FundingRow[] = companies
        .map((c) => {
          const r = c as unknown as Record<string, unknown>
          return {
            domain: c.website,
            name: c.name,
            round_type: c.funding_stage,
            round_size_usd: Number(r.last_round_size_usd ?? 0),
            lead_investor: String(r.lead_investor ?? ''),
            announced_at: String(r.last_round_date ?? ''),
            rationale: c.description,
          }
        })
        .filter((r) => r.round_size_usd >= minRound)
        .filter((r) => !r.announced_at || r.announced_at >= cutoff)
      return { companies: rows }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('crustdata', message)
    }
  },
}
