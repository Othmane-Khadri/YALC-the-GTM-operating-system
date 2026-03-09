import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'
import { getApifyToken } from './apify-token'

const ENGAGERS_ACTOR = 'scraping_solutions/linkedin-posts-engagers-likers-and-commenters-no-cookies'
const PROFILE_ACTOR = 'harvestapi/linkedin-profile-scraper'
const POLL_INTERVAL_MS = 3000
const MAX_POLL_ATTEMPTS = 60

const ENGAGEMENT_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'headline', label: 'Headline', type: 'text' },
  { key: 'linkedin_url', label: 'LinkedIn', type: 'url' },
  { key: 'reaction_type', label: 'Reaction', type: 'badge' },
  { key: 'comment_text', label: 'Comment', type: 'text' },
  { key: 'company', label: 'Company', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'location', label: 'Location', type: 'text' },
]

export class ApifyLinkedInEngagementProvider implements StepExecutor {
  id = 'apify-linkedin-engagement'
  name = 'LinkedIn Post Engagement Scraper'
  description = 'Scrape people who liked or commented on a LinkedIn post. Returns names, headlines, LinkedIn URLs, reaction types. No cookies needed. Costs ~$1.20 per 1,000 profiles.'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['search', 'enrich']

  isAvailable(): boolean {
    return !!process.env.APIFY_TOKEN
  }

  canExecute(step: WorkflowStepInput): boolean {
    return step.provider === this.id || step.provider === 'linkedin-engagement'
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const token = await getApifyToken()

    const config = step.config ?? {}
    const postUrl = (config.postUrl ?? config.url ?? config.linkedinUrl) as string | undefined
    if (!postUrl || !postUrl.includes('linkedin.com')) {
      throw new Error('A valid LinkedIn post URL is required (postUrl, url, or linkedinUrl in step config)')
    }

    // 1. Scrape engagers
    const engagerInput = {
      postUrl,
      type: (config.engagementType as string) ?? 'all',
    }
    const engagerResults = await this.runApifyActor(ENGAGERS_ACTOR, engagerInput, token)

    // 2. Optionally enrich profiles
    let enrichedMap: Map<string, Record<string, unknown>> | null = null
    if (config.enrichProfiles === true && engagerResults.length > 0) {
      const profileUrls = engagerResults
        .map(r => (r.profileUrl ?? r.linkedin_url ?? r.linkedinUrl ?? r.url) as string)
        .filter(Boolean)

      if (profileUrls.length > 0) {
        const profileResults = await this.runApifyActor(PROFILE_ACTOR, { urls: profileUrls }, token)
        enrichedMap = new Map()
        for (const p of profileResults) {
          const url = (p.linkedinUrl ?? p.profileUrl ?? p.url) as string
          if (url) enrichedMap.set(url, p)
        }
      }
    }

    // 3. Normalize and yield in batches
    const batchSize = context.batchSize || 10
    let totalSoFar = 0
    const batches = Math.ceil(engagerResults.length / batchSize)

    for (let i = 0; i < batches; i++) {
      const slice = engagerResults.slice(i * batchSize, (i + 1) * batchSize)
      const rows = slice.map(raw => {
        const profileUrl = (raw.profileUrl ?? raw.linkedin_url ?? raw.linkedinUrl ?? raw.url ?? '') as string
        const enriched = enrichedMap?.get(profileUrl)
        return normalizeEngagementRow(raw, enriched)
      })
      totalSoFar += rows.length
      yield { rows, batchIndex: i, totalSoFar }
    }
  }

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    return ENGAGEMENT_COLUMNS
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

  private async runApifyActor(
    actorId: string,
    input: Record<string, unknown>,
    token: string
  ): Promise<Record<string, unknown>[]> {
    // Start actor run
    const startRes = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    )
    if (!startRes.ok) {
      const errText = await startRes.text()
      throw new Error(`Apify actor ${actorId} start failed (${startRes.status}): ${errText}`)
    }
    const runData = await startRes.json()
    const runId = runData.data?.id
    if (!runId) throw new Error(`Apify actor ${actorId} returned no run ID`)

    // Poll for completion
    let status = runData.data?.status
    let attempts = 0
    while (status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED') {
      if (attempts++ >= MAX_POLL_ATTEMPTS) {
        throw new Error(`Apify run timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`)
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`)
      const pollData = await pollRes.json()
      status = pollData.data?.status
    }

    if (status !== 'SUCCEEDED') {
      throw new Error(`Apify run ${status}: ${runId}`)
    }

    // Fetch results
    const datasetRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${token}&format=json`
    )
    if (!datasetRes.ok) {
      throw new Error(`Failed to fetch Apify dataset: ${datasetRes.status}`)
    }
    return await datasetRes.json()
  }
}

function normalizeEngagementRow(
  raw: Record<string, unknown>,
  enriched?: Record<string, unknown>
): Record<string, unknown> {
  return {
    name: raw.name ?? raw.fullName ?? raw.full_name ?? enriched?.name ?? '',
    headline: raw.headline ?? raw.tagline ?? enriched?.headline ?? '',
    linkedin_url: raw.profileUrl ?? raw.linkedin_url ?? raw.linkedinUrl ?? raw.url ?? '',
    reaction_type: raw.reactionType ?? raw.reaction_type ?? raw.type ?? '',
    comment_text: raw.comment ?? raw.commentText ?? raw.comment_text ?? '',
    company: raw.company ?? raw.companyName ?? enriched?.company ?? enriched?.companyName ?? '',
    title: raw.title ?? raw.jobTitle ?? enriched?.title ?? enriched?.jobTitle ?? '',
    location: raw.location ?? enriched?.location ?? '',
  }
}
