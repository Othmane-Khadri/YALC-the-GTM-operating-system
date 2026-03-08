import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'

const APIFY_LEADS_ACTOR = 'code_crafter/leads-finder'
const POLL_INTERVAL_MS = 3000
const MAX_POLL_ATTEMPTS = 60 // 3 min max wait

const APIFY_LEADS_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'title', label: 'Job Title', type: 'text' },
  { key: 'company', label: 'Company', type: 'text' },
  { key: 'linkedin_url', label: 'LinkedIn', type: 'url' },
  { key: 'industry', label: 'Industry', type: 'badge' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'company_size', label: 'Company Size', type: 'text' },
]

export class ApifyLeadsProvider implements StepExecutor {
  id = 'apify-leads'
  name = 'Apify Lead Finder'
  description = 'Search for real people/companies by criteria (industry, title, location, company size). Returns verified emails, LinkedIn URLs, and company data. Costs ~$1.50 per 1,000 leads.'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['search']

  canExecute(step: WorkflowStepInput): boolean {
    return step.provider === this.id ||
      (step.stepType === 'search' && step.provider === 'apify')
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const apiToken = process.env.APIFY_TOKEN
    if (!apiToken) {
      throw new Error('APIFY_TOKEN environment variable is required for real lead search. Set it in .env.local')
    }

    // Map workflow step config to Apify actor input
    const config = step.config ?? {}
    const actorInput: Record<string, unknown> = {
      query: config.query ?? step.description ?? step.title,
      maxResults: Math.min(step.estimatedRows ?? context.totalRequested, context.totalRequested),
    }
    if (config.industry) actorInput.industry = config.industry
    if (config.location) actorInput.location = config.location
    if (config.title) actorInput.jobTitle = config.title
    if (config.companySize) actorInput.companySize = config.companySize

    // 1. Start actor run
    const startRes = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_LEADS_ACTOR}/runs?token=${apiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(actorInput),
      }
    )
    if (!startRes.ok) {
      const errText = await startRes.text()
      throw new Error(`Apify actor start failed (${startRes.status}): ${errText}`)
    }
    const runData = await startRes.json()
    const runId = runData.data?.id
    if (!runId) throw new Error('Apify returned no run ID')

    // 2. Poll for completion
    let status = runData.data?.status
    let attempts = 0
    while (status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED') {
      if (attempts++ >= MAX_POLL_ATTEMPTS) {
        throw new Error(`Apify run timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`)
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      const pollRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${apiToken}`
      )
      const pollData = await pollRes.json()
      status = pollData.data?.status
    }

    if (status !== 'SUCCEEDED') {
      throw new Error(`Apify run ${status}: ${runId}`)
    }

    // 3. Fetch results from default dataset
    const datasetRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${apiToken}&format=json`
    )
    if (!datasetRes.ok) {
      throw new Error(`Failed to fetch Apify dataset: ${datasetRes.status}`)
    }
    const rawResults: Record<string, unknown>[] = await datasetRes.json()

    // 4. Normalize to our column schema and yield in batches
    const batchSize = context.batchSize || 10
    let totalSoFar = 0
    const batches = Math.ceil(rawResults.length / batchSize)

    for (let i = 0; i < batches; i++) {
      const slice = rawResults.slice(i * batchSize, (i + 1) * batchSize)
      const rows = slice.map(raw => normalizeLeadRow(raw))
      totalSoFar += rows.length
      yield { rows, batchIndex: i, totalSoFar }
    }
  }

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    return APIFY_LEADS_COLUMNS
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    const token = process.env.APIFY_TOKEN
    if (!token) return { ok: false, message: 'APIFY_TOKEN not set' }
    try {
      const res = await fetch(`https://api.apify.com/v2/users/me?token=${token}`)
      return res.ok
        ? { ok: true, message: 'Apify connection OK' }
        : { ok: false, message: `Apify auth failed: ${res.status}` }
    } catch (err) {
      return { ok: false, message: `Apify unreachable: ${err}` }
    }
  }
}

// Normalize Apify's raw output to match our column keys.
// Defensively tries multiple field name variants — update after inspecting
// the first real run's output if field names differ.
function normalizeLeadRow(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    name: raw.name ?? raw.fullName ?? raw.full_name ?? '',
    email: raw.email ?? raw.emailAddress ?? '',
    title: raw.title ?? raw.jobTitle ?? raw.job_title ?? '',
    company: raw.company ?? raw.companyName ?? raw.company_name ?? '',
    linkedin_url: raw.linkedin ?? raw.linkedinUrl ?? raw.linkedin_url ?? raw.profileUrl ?? '',
    industry: raw.industry ?? '',
    location: raw.location ?? raw.city ?? '',
    company_size: raw.companySize ?? raw.company_size ?? raw.employees ?? '',
  }
}
