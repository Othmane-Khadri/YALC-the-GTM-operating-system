import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'
import { unipileService } from '@/lib/services/unipile'
import { SEARCH_COLUMNS } from '../../execution/columns'

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

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    // Get first LinkedIn account
    const accountsResponse = await unipileService.getAccounts()
    const accounts = accountsResponse?.items ?? []
    if (accounts.length === 0) {
      throw new Error('No LinkedIn account connected in Unipile. Connect one first.')
    }
    const accountId = String((accounts[0] as Record<string, unknown>).id)

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

      for (let i = 0; i < context.previousStepRows.length; i += batchSize) {
        const slice = context.previousStepRows.slice(i, i + batchSize)
        const enriched = await Promise.all(
          slice.map(async (row) => {
            const linkedinUrl = String(row.linkedin_url ?? row.linkedin ?? '')
            if (!linkedinUrl) return row
            try {
              const profile = await unipileService.getProfile(accountId, linkedinUrl)
              return { ...row, ...this.normalizeProfile(profile) }
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
