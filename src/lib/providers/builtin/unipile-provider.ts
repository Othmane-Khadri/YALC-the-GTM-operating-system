import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability, ProviderHealthStatus } from '../types'
import type { ColumnDef } from '../../ai/types'
import { unipileService } from '../../services/unipile'
import { SEARCH_COLUMNS } from '../../execution/columns'
import type { VerifiedFields } from '../../qualification/types'

type LinkedInSection =
  | 'experience'
  | 'education'
  | 'languages'
  | 'skills'
  | 'certifications'
  | 'about'

export type LinkedInSectionsConfig = LinkedInSection | LinkedInSection[] | '*'

/**
 * Resolve which Unipile account ID to use for read/enrich operations.
 *
 * Per project hard rule: David Small's account is messaging-only and Doug Pearson's
 * account is reading/scraping-only. The `UNIPILE_READ_ACCOUNT_ID` env routes reads
 * to a specific account (typically Doug's). When unset we fall back to the existing
 * "first connected account" behavior to preserve backward compatibility.
 */
export async function resolveReadAccountId(): Promise<string> {
  const envAccountId = process.env.UNIPILE_READ_ACCOUNT_ID
  if (envAccountId) return envAccountId
  const accountsResponse = await unipileService.getAccounts()
  const accounts = accountsResponse?.items ?? []
  if (accounts.length === 0) {
    throw new Error('No LinkedIn account connected in Unipile. Connect one first.')
  }
  return String((accounts[0] as Record<string, unknown>).id)
}

/**
 * Normalize a `sections` config value to a flat list of requested LinkedIn sections.
 * '*' expands to all known sections. Returns [] when sections is undefined.
 */
export function normalizeSectionsConfig(sections: LinkedInSectionsConfig | undefined): LinkedInSection[] {
  if (sections === undefined) return []
  if (sections === '*') return ['experience', 'education', 'languages', 'skills', 'certifications', 'about']
  if (Array.isArray(sections)) return sections
  return [sections]
}

/**
 * Extract structured "verified" fields from a Unipile LinkedIn profile response.
 *
 * Throttle heuristic: when sections=experience was requested but `work_experience`
 * came back missing/empty, set `throttled=true` so caller's downstream gates skip
 * this lead instead of rejecting it. (No `throttled_sections` exists on the SDK
 * response — this is a heuristic.)
 */
export function extractVerifiedFields(
  profile: unknown,
  sectionsRequested: { experience: boolean },
): VerifiedFields {
  const p = (profile && typeof profile === 'object') ? (profile as Record<string, unknown>) : {}
  const work_experience = Array.isArray(p.work_experience)
    ? (p.work_experience as Array<Record<string, unknown>>)
    : []
  const active = work_experience.filter((e) => !e.end)
  const primary = active[0] // most recent active role

  const all_active_roles = active.map((e) => ({
    position: typeof e.position === 'string' ? e.position : null,
    company: typeof e.company === 'string' ? e.company : null,
  }))

  // Prior companies = work_experience entries that are not the primary active role.
  const priorEntries = primary
    ? work_experience.filter((e) => e !== primary)
    : work_experience
  const prior_companies = priorEntries
    .map((e) => (typeof e.company === 'string' ? e.company : null))
    .filter((c): c is string => !!c)

  const throttled = sectionsRequested.experience && work_experience.length === 0

  return {
    headline: typeof p.headline === 'string' ? p.headline : null,
    primary_company: primary && typeof primary.company === 'string' ? primary.company : null,
    primary_position: primary && typeof primary.position === 'string' ? primary.position : null,
    primary_company_industry: primary && typeof primary.industry === 'string' ? primary.industry : null,
    prior_companies,
    current_role_start_date: primary && typeof primary.start === 'string' ? primary.start : null,
    all_active_roles,
    throttled,
  }
}

const LINKEDIN_COLUMNS: ColumnDef[] = [
  ...SEARCH_COLUMNS,
  { key: 'first_name', label: 'First Name', type: 'text' },
  { key: 'last_name', label: 'Last Name', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'linkedin_url', label: 'LinkedIn', type: 'url' },
]

export class UnipileProvider implements StepExecutor {
  id = 'unipile'
  name = 'Unipile (LinkedIn)'
  description = 'LinkedIn search, profile enrichment, connection requests, and DMs via Unipile SDK.'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['search', 'enrich', 'linkedin_send']

  isAvailable(): boolean {
    return unipileService.isAvailable()
  }

  canExecute(step: WorkflowStepInput): boolean {
    if (step.provider === 'unipile') return true
    if (step.stepType === 'linkedin_send') return true
    // Claim steps that mention LinkedIn
    const query = String(step.config?.query ?? step.description ?? '').toLowerCase()
    const url = String(step.config?.url ?? '').toLowerCase()
    if (query.includes('linkedin') || url.includes('linkedin.com')) {
      return step.stepType === 'search' || step.stepType === 'enrich'
    }
    return false
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!unipileService.isAvailable()) {
      return { ok: false, message: 'UNIPILE_API_KEY or UNIPILE_DSN not set' }
    }
    try {
      await Promise.race([
        unipileService.getAccounts(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Unipile health check timed out after 5s')), 5000),
        ),
      ])
      return { ok: true, message: 'Unipile accounts endpoint reachable' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  async selfHealthCheck(): Promise<ProviderHealthStatus> {
    if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) {
      return { status: 'warn', detail: 'UNIPILE_API_KEY or UNIPILE_DSN not set' }
    }
    try {
      const accountsResponse = await Promise.race([
        unipileService.getAccounts(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout after 8s')), 8000),
        ),
      ])
      const items = (accountsResponse as { items?: unknown[] })?.items ?? []
      if (items.length === 0) {
        return { status: 'warn', detail: 'connected but no LinkedIn accounts attached' }
      }
      return { status: 'ok', detail: `${items.length} account(s) connected` }
    } catch (err) {
      return {
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    // Resolve account ID — prefer UNIPILE_READ_ACCOUNT_ID env (Doug Pearson's read-only
    // account), fall back to first connected account.
    const accountId = await resolveReadAccountId()

    // linkedin_send — sub-discriminator on payload.kind: 'connect' | 'dm'
    if (step.stepType === 'linkedin_send') {
      const cfg = (step.config ?? {}) as Record<string, unknown>
      const payload = ((step as Record<string, unknown>).payload ?? {}) as Record<string, unknown>
      const merged = { ...cfg, ...payload }

      const kind = String(merged.kind ?? 'dm')
      const overrideAccountId = merged.accountId != null ? String(merged.accountId) : null
      const useAccount = overrideAccountId ?? accountId

      if (kind === 'connect') {
        const providerId = merged.providerId != null ? String(merged.providerId) : ''
        if (!providerId) {
          throw new Error('[unipile-provider] linkedin_send kind=connect requires "providerId" in step.config or step.payload')
        }
        const message = merged.message != null ? String(merged.message) : undefined
        await unipileService.sendConnection(useAccount, providerId, message)
        yield {
          rows: [{ kind: 'connect', provider_id: providerId, status: 'queued', provider: 'unipile' }],
          batchIndex: 0,
          totalSoFar: 1,
        }
        return
      }

      if (kind === 'dm') {
        const attendeeId = merged.attendeeId != null ? String(merged.attendeeId) : ''
        const text = merged.text != null ? String(merged.text) : ''
        if (!attendeeId || !text) {
          throw new Error('[unipile-provider] linkedin_send kind=dm requires "attendeeId" and "text" in step.config or step.payload')
        }
        await unipileService.sendMessage(useAccount, attendeeId, text)
        yield {
          rows: [{ kind: 'dm', attendee_id: attendeeId, status: 'queued', provider: 'unipile' }],
          batchIndex: 0,
          totalSoFar: 1,
        }
        return
      }

      throw new Error(`[unipile-provider] linkedin_send kind must be 'connect' or 'dm', got "${kind}"`)
    }

    // Enrich mode: get profile for each row's LinkedIn slug
    if (step.stepType === 'enrich' && context.previousStepRows?.length) {
      const batchSize = context.batchSize || 10
      let totalSoFar = 0

      const sections = (step.config as Record<string, unknown> | undefined)?.sections as
        | LinkedInSectionsConfig
        | undefined
      const sectionsAsked = normalizeSectionsConfig(sections)
      const experienceRequested = sectionsAsked.includes('experience')

      for (let i = 0; i < context.previousStepRows.length; i += batchSize) {
        const slice = context.previousStepRows.slice(i, i + batchSize)
        const enriched = await Promise.all(
          slice.map(async (row) => {
            const linkedinUrl = String(row.linkedin_url ?? row.linkedin ?? '')
            if (!linkedinUrl) return row
            try {
              const profile = sections === undefined
                ? await unipileService.getProfile(accountId, linkedinUrl)
                : await unipileService.getProfile(accountId, linkedinUrl, sections)
              const enrichedRow: Record<string, unknown> = { ...row, ...this.normalizeProfile(profile) }
              if (experienceRequested) {
                enrichedRow.verified = extractVerifiedFields(profile, { experience: true })
              }
              return enrichedRow
            } catch {
              return row
            }
          }),
        )
        totalSoFar += enriched.length
        yield { rows: enriched, batchIndex: Math.floor(i / batchSize), totalSoFar }
      }
      return
    }

    // Search mode: search LinkedIn people
    const query = step.config?.query ? String(step.config.query) : step.description
    const limit = context.totalRequested || 25
    const results = await unipileService.searchLinkedIn(accountId, query, limit)

    const rows = results.map((item) => this.normalizeProfile(item))

    if (rows.length === 0) {
      yield { rows: [], batchIndex: 0, totalSoFar: 0 }
      return
    }

    const batchSize = context.batchSize || 10
    let totalSoFar = 0
    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize)
      totalSoFar += slice.length
      yield { rows: slice, batchIndex: Math.floor(i / batchSize), totalSoFar }
    }
  }

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    return LINKEDIN_COLUMNS
  }

  private normalizeProfile(data: unknown): Record<string, unknown> {
    const d = (data ?? {}) as Record<string, unknown>
    return {
      first_name: d.first_name ?? d.firstName ?? '',
      last_name: d.last_name ?? d.lastName ?? '',
      title: d.headline ?? d.title ?? d.occupation ?? '',
      company_name: d.company_name ?? d.company ?? d.organization ?? '',
      website: d.website ?? d.websites ?? '',
      industry: d.industry ?? '',
      location: d.location ?? d.geo_location ?? '',
      description: d.summary ?? d.description ?? '',
      linkedin_url: d.linkedin_url ?? d.public_identifier
        ? `https://linkedin.com/in/${d.public_identifier}`
        : d.profile_url ?? '',
      employee_count: '',
    }
  }
}
