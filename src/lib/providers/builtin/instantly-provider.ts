import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'
import { instantlyService, type SequenceStep } from '@/lib/services/instantly'

const EMAIL_COLUMNS: ColumnDef[] = [
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'first_name', label: 'First Name', type: 'text' },
  { key: 'last_name', label: 'Last Name', type: 'text' },
  { key: 'company_name', label: 'Company', type: 'text' },
  { key: 'status', label: 'Status', type: 'badge' },
  { key: 'opened_at', label: 'Opened', type: 'text' },
  { key: 'replied_at', label: 'Replied', type: 'text' },
  { key: 'bounced_at', label: 'Bounced', type: 'text' },
]

export class InstantlyProvider implements StepExecutor {
  id = 'instantly'
  name = 'Instantly'
  description = 'Cold email campaign management via Instantly.ai. Use for sending email sequences and tracking email campaign analytics.'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['export', 'search']

  isAvailable(): boolean {
    return instantlyService.isAvailable()
  }

  canExecute(step: WorkflowStepInput): boolean {
    if (step.provider === 'instantly') return true
    const desc = (step.description ?? '').toLowerCase()
    return (desc.includes('email') || desc.includes('cold email') || desc.includes('instantly'))
      && (step.stepType === 'export' || step.stepType === 'search')
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    if (step.stepType === 'export') {
      // Take leads from previousStepRows → create Instantly campaign → add leads
      const leads = (context.previousStepRows ?? []).filter(r => r.email)
      if (leads.length === 0) {
        yield { rows: [], batchIndex: 0, totalSoFar: 0 }
        return
      }

      const campaignName = String(step.config?.campaignName ?? step.title ?? 'YALC Campaign')

      // Sequences must be provided via step config — Instantly campaigns with no
      // sequences silently never send. Refuse to create one without them.
      const rawSequences = step.config?.sequences
      if (!Array.isArray(rawSequences) || rawSequences.length === 0) {
        throw new Error(
          `[instantly-provider] step.config.sequences is required (each: { subject?, body, delay_days? }). Refusing to create empty Instantly campaign "${campaignName}".`,
        )
      }
      const sequences: SequenceStep[] = (rawSequences as Array<Record<string, unknown>>).map(s => ({
        subject: s.subject != null ? String(s.subject) : undefined,
        body: String(s.body ?? ''),
        delay_days: typeof s.delay_days === 'number' ? s.delay_days : 0,
      }))
      if (sequences.some(s => !s.body)) {
        throw new Error('[instantly-provider] every sequence step must have a non-empty body')
      }

      // Idempotency: reuse an existing Instantly campaign with the same name if present.
      let campaign: { id: string; name: string; status: string }
      try {
        const existing = await instantlyService.listCampaigns()
        const match = existing.find(c => c.name === campaignName)
        if (match) {
          campaign = match
        } else {
          campaign = await instantlyService.createCampaign({
            name: campaignName,
            sequences,
            schedule: step.config?.schedule as { timezone?: string; days?: Record<string, { start: string; end: string }> } | undefined,
            account_ids: step.config?.account_ids as string[] | undefined,
          })
        }
      } catch {
        campaign = await instantlyService.createCampaign({
          name: campaignName,
          sequences,
          schedule: step.config?.schedule as { timezone?: string; days?: Record<string, { start: string; end: string }> } | undefined,
          account_ids: step.config?.account_ids as string[] | undefined,
        })
      }

      await instantlyService.addLeadsToCampaign(
        campaign.id,
        leads.map(l => ({
          email: String(l.email),
          first_name: String(l.first_name ?? ''),
          last_name: String(l.last_name ?? ''),
          company_name: String(l.company_name ?? l.company ?? ''),
          title: String(l.title ?? ''),
        })),
      )

      const rows = leads.map(l => ({
        ...l,
        status: 'queued',
        instantly_campaign_id: campaign.id,
      }))

      yield { rows, batchIndex: 0, totalSoFar: rows.length }
    } else if (step.stepType === 'search') {
      // Pull campaign analytics → yield as rows
      const campaignId = String(step.config?.campaignId ?? '')
      if (!campaignId) {
        // List all campaigns with analytics
        const campaigns = await instantlyService.listCampaigns()
        const rows = campaigns.map(c => ({
          campaign_id: c.id,
          campaign_name: c.name,
          status: c.status,
        }))
        yield { rows, batchIndex: 0, totalSoFar: rows.length }
        return
      }

      const analytics = await instantlyService.getCampaignAnalytics(campaignId)
      const leads = await instantlyService.listLeads(campaignId, context.totalRequested || 100)

      const rows = leads.map(l => ({
        email: l.email,
        status: l.status,
        opened_at: l.opened_at ?? '',
        replied_at: l.replied_at ?? '',
        bounced_at: l.bounced_at ?? '',
        _analytics: analytics,
      }))

      yield { rows, batchIndex: 0, totalSoFar: rows.length }
    }
  }

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    return EMAIL_COLUMNS
  }
}
