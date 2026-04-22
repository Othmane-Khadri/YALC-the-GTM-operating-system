import { readFileSync, existsSync } from 'fs'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { db } from '../db'
import { resultRows, campaignLeads, campaigns, conversations } from '../db/schema'
import { IntelligenceStore } from '../intelligence/store'
import { getRegistryReady } from '../providers/registry'
import { buildFrameworkContext } from '../framework/context'
import { notionService } from '../services/notion'
import { runImport } from './importers'
import { DedupEngine } from '../dedup/engine'
import { buildSuppressionSet } from '../dedup/live-sync'
import { sendConfirmation } from '../dedup/slack-confirm'
import type { GTMOSConfig } from '../config/types'
import type { LeadRecord, DedupConfig } from '../dedup/types'

const HOLDING_CAMPAIGN_TITLE = '__qualified_leads_pool__'

interface QualifyOptions {
  config: GTMOSConfig
  source?: string
  input?: string
  resultSetId?: string
  dryRun?: boolean
  /** Skip dedup gate entirely */
  noDedup?: boolean
  /** Enable Slack confirmation for ambiguous matches */
  slackConfirm?: boolean
  /** Dedup config overrides (from tenant YAML) */
  dedupConfig?: Partial<DedupConfig>
}

interface QualifyResult {
  resultSetId: string
  totalProcessed: number
  qualified: number
  disqualified: number
  skippedDedup: number
  skippedPreQual: number
  skippedExclusion: number
  skippedCompany: number
}

export async function runQualify(opts: QualifyOptions): Promise<QualifyResult> {
  let resultSetId = opts.resultSetId

  // If no result set provided, import first
  if (!resultSetId && opts.source && opts.input) {
    const imported = await runImport({ config: opts.config, source: opts.source, input: opts.input })
    resultSetId = imported.resultSetId
  }

  if (!resultSetId) {
    throw new Error('Either --result-set or --source + --input must be provided')
  }

  console.log(`[qualify] Starting 7-gate qualification pipeline for result set: ${resultSetId}`)

  // Load rows
  const rows = await db.select().from(resultRows).where(eq(resultRows.resultSetId, resultSetId))
  const leads: Record<string, unknown>[] = rows.map(r => {
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
    return { id: r.id, ...(data as Record<string, unknown>) }
  })

  console.log(`[qualify] Loaded ${leads.length} leads`)

  const result: QualifyResult = {
    resultSetId,
    totalProcessed: leads.length,
    qualified: 0,
    disqualified: 0,
    skippedDedup: 0,
    skippedPreQual: 0,
    skippedExclusion: 0,
    skippedCompany: 0,
  }

  let pipeline: Record<string, unknown>[] = leads

  // ─── Gate 0: Dedup ───────────────────────────────────────────────────────────
  if (opts.noDedup) {
    console.log('[qualify] Gate 0: Dedup SKIPPED (--no-dedup flag)')
  } else {
    console.log('[qualify] Gate 0: Enhanced dedup check (live sync)...')

    // Build suppression set from all sources
    const suppressionSet = await buildSuppressionSet({
      tenantId: 'default',
      includeCampaigns: true,
      includeReplied: true,
      includeBlocklist: true,
    })

    const engine = new DedupEngine(opts.dedupConfig)
    const dedupResult = engine.dedup(
      pipeline as LeadRecord[],
      suppressionSet,
    )

    // Handle duplicates — skip them
    result.skippedDedup = dedupResult.duplicates.length
    for (const { lead, match } of dedupResult.duplicates) {
      console.log(`[qualify]   DUP (${match.confidence}%): ${lead.first_name ?? ''} ${lead.last_name ?? ''} matched via ${match.matcher} -> ${match.matchedSource}`)
    }

    // Handle pending review — send Slack confirmations if enabled
    if (dedupResult.pendingReview.length > 0 && opts.slackConfirm && opts.config.slack?.webhook_url) {
      console.log(`[qualify]   ${dedupResult.pendingReview.length} leads pending Slack review`)
      for (const { lead, match } of dedupResult.pendingReview) {
        await sendConfirmation(lead, match, {
          webhookUrl: opts.config.slack.webhook_url,
        })
        // Mark as pending — they'll proceed as unique for now (safe default)
        ;(lead as Record<string, unknown>).dedup_status = 'pending_review'
      }
      // Pending review leads are included in the pipeline (safe default: keep both)
      dedupResult.unique.push(...dedupResult.pendingReview.map(pr => pr.lead))
    } else if (dedupResult.pendingReview.length > 0) {
      // No Slack confirm — treat as unique (safe default)
      dedupResult.unique.push(...dedupResult.pendingReview.map(pr => pr.lead))
      console.log(`[qualify]   ${dedupResult.pendingReview.length} ambiguous matches kept (no Slack confirm)`)
    }

    pipeline = dedupResult.unique as Record<string, unknown>[]
    console.log(`[qualify] Gate 0: ${result.skippedDedup} duplicates removed, ${pipeline.length} remaining`)
  }

  // ─── Gate 1: Headline pre-qualification ──────────────────────────────────────
  console.log('[qualify] Gate 1: Headline pre-qualification...')
  const rules = loadRulesFile(opts.config.qualification.rules_path)
  if (rules.length > 0) {
    const preQualPassed: Record<string, unknown>[] = []
    for (const lead of pipeline) {
      const headline = String(lead.headline ?? lead.title ?? '')
      const matches = rules.some(rule => new RegExp(rule, 'i').test(headline))
      if (matches) {
        preQualPassed.push(lead)
      } else {
        result.skippedPreQual++
      }
    }
    pipeline = preQualPassed
  }
  console.log(`[qualify] Gate 1: ${result.skippedPreQual} failed headline pre-qual, ${pipeline.length} remaining`)

  // ─── Gate 2: Exclusion list ──────────────────────────────────────────────────
  console.log('[qualify] Gate 2: Exclusion list...')
  const exclusions = loadRulesFile(opts.config.qualification.exclusion_path)
  if (exclusions.length > 0) {
    const exclusionPassed: Record<string, unknown>[] = []
    for (const lead of pipeline) {
      const fullText = [
        lead.first_name, lead.last_name, lead.headline, lead.company, lead.linkedin_url,
      ].filter(Boolean).join(' ').toLowerCase()
      const excluded = exclusions.some(ex => fullText.includes(ex.toLowerCase()))
      if (excluded) {
        result.skippedExclusion++
      } else {
        exclusionPassed.push(lead)
      }
    }
    pipeline = exclusionPassed
  }
  console.log(`[qualify] Gate 2: ${result.skippedExclusion} excluded, ${pipeline.length} remaining`)

  // ─── Gate 3: Company disqualifiers ───────────────────────────────────────────
  console.log('[qualify] Gate 3: Company disqualifiers...')
  const disqualifiers = loadRulesFile(opts.config.qualification.disqualifiers_path)
  if (disqualifiers.length > 0) {
    const companyPassed: Record<string, unknown>[] = []
    for (const lead of pipeline) {
      const company = String(lead.company ?? lead.company_name ?? '').toLowerCase()
      const industry = String(lead.industry ?? '').toLowerCase()
      const disqualified = disqualifiers.some(dq =>
        company.includes(dq.toLowerCase()) || industry.includes(dq.toLowerCase())
      )
      if (disqualified) {
        result.skippedCompany++
      } else {
        companyPassed.push(lead)
      }
    }
    pipeline = companyPassed
  }
  console.log(`[qualify] Gate 3: ${result.skippedCompany} company-disqualified, ${pipeline.length} remaining`)

  // ─── Gate 4: Enrichment ──────────────────────────────────────────────────────
  console.log('[qualify] Gate 4: Enrichment (if needed)...')
  const registry = await getRegistryReady()
  const needsEnrich = pipeline.filter(l =>
    !l.company && !l.company_name && !l.industry
  )

  if (needsEnrich.length > 0) {
    console.log(`[qualify] ${needsEnrich.length} leads need enrichment`)
    try {
      // Use Unipile for LinkedIn-sourced leads, fall back to auto
      const hasLinkedIn = needsEnrich.some(l => String(l.linkedin_url ?? '').includes('linkedin'))
      const enrichProviderId = hasLinkedIn ? 'unipile' : 'auto'
      const enrichProvider = registry.resolve({ stepType: 'enrich', provider: enrichProviderId })
      const enriched = enrichProvider.execute(
        { stepIndex: 0, title: 'Enrich', stepType: 'enrich', provider: enrichProviderId, description: 'Enrich leads with LinkedIn profile data' },
        {
          frameworkContext: '',
          previousStepRows: needsEnrich,
          batchSize: 25,
          totalRequested: needsEnrich.length,
        }
      )
      for await (const batch of enriched) {
        for (const row of batch.rows) {
          const idx = pipeline.findIndex(l =>
            (l.linkedin_url && l.linkedin_url === row.linkedin_url) ||
            (l.provider_id && l.provider_id === row.provider_id)
          )
          if (idx >= 0) {
            pipeline[idx] = { ...pipeline[idx], ...row }
          }
        }
      }
    } catch (err) {
      console.log(`[qualify] Enrichment skipped: ${err instanceof Error ? err.message : err}`)
    }
  }

  // ─── Gate 5: AI Qualification ────────────────────────────────────────────────
  console.log('[qualify] Gate 5: AI qualification...')
  if (pipeline.length > 0) {
    try {
      const qualifyProvider = registry.resolve({ stepType: 'qualify', provider: 'qualify' })

      // Load intelligence for prompt injection
      const store = new IntelligenceStore()
      const learnings = await store.getForPrompt()
      const learningsContext = learnings.length > 0
        ? learnings.map(l => `- [${l.confidence}] ${l.insight}`).join('\n')
        : undefined

      const frameworkContext = await buildFrameworkContext(null)

      const scored: Record<string, unknown>[] = []
      const qualResults = qualifyProvider.execute(
        { stepIndex: 0, title: 'Qualify', stepType: 'qualify', provider: 'qualify', description: 'AI qualification' },
        {
          frameworkContext,
          learningsContext,
          previousStepRows: pipeline,
          batchSize: 10,
          totalRequested: pipeline.length,
        }
      )

      for await (const batch of qualResults) {
        scored.push(...batch.rows)
      }
      pipeline = scored
    } catch (err) {
      console.log(`[qualify] AI qualification skipped: ${err instanceof Error ? err.message : err}`)
    }
  }

  // ─── Gate 6: Score threshold ─────────────────────────────────────────────────
  console.log('[qualify] Gate 6: Score threshold filter...')
  const minScore = 50
  const qualified = pipeline.filter(l => {
    const score = Number(l.icp_score ?? l.qualificationScore ?? 0)
    return score >= minScore
  })
  result.disqualified = pipeline.length - qualified.length
  result.qualified = qualified.length
  pipeline = qualified
  console.log(`[qualify] Gate 6: ${result.qualified} qualified, ${result.disqualified} below threshold`)

  // ─── Insert qualified leads into campaignLeads ───────────────────────────────
  console.log(`[qualify] Inserting ${pipeline.length} qualified leads...`)

  // Ensure a holding campaign exists for unassigned leads
  const holdingCampaignId = await getOrCreateHoldingCampaign()

  for (const lead of pipeline) {
    await db.insert(campaignLeads).values({
      id: randomUUID(),
      campaignId: holdingCampaignId,
      providerId: String(lead.provider_id ?? lead.providerId ?? randomUUID()),
      linkedinUrl: String(lead.linkedin_url ?? lead.linkedinUrl ?? ''),
      firstName: String(lead.first_name ?? lead.firstName ?? ''),
      lastName: String(lead.last_name ?? lead.lastName ?? ''),
      headline: String(lead.headline ?? ''),
      company: String(lead.company ?? lead.company_name ?? ''),
      lifecycleStatus: 'Qualified',
      qualificationScore: Number(lead.icp_score ?? lead.qualificationScore ?? 0),
      tags: JSON.stringify(lead.tags ?? []),
      source: String(lead.source ?? 'csv'),
    })
  }

  // ─── Push to Notion ──────────────────────────────────────────────────────────
  if (pipeline.length > 0 && opts.config.notion.leads_ds) {
    console.log(`[qualify] Pushing ${pipeline.length} leads to Notion...`)
    try {
      const { created, failed } = await notionService.bulkCreateLeads(
        opts.config.notion.leads_ds,
        pipeline,
      )
      console.log(`[qualify] Notion: ${created} created, ${failed} failed`)
    } catch (err) {
      console.log(`[qualify] Notion push skipped: ${err instanceof Error ? err.message : err}`)
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n─── Qualification Summary ───')
  console.log(`Total processed:      ${result.totalProcessed}`)
  console.log(`Dedup skipped:        ${result.skippedDedup}`)
  console.log(`Pre-qual skipped:     ${result.skippedPreQual}`)
  console.log(`Exclusion skipped:    ${result.skippedExclusion}`)
  console.log(`Company disqualified: ${result.skippedCompany}`)
  console.log(`Below threshold:      ${result.disqualified}`)
  console.log(`QUALIFIED:            ${result.qualified}`)

  return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrCreateHoldingCampaign(): Promise<string> {
  // Check if holding campaign already exists
  const existing = await db.select().from(campaigns)
    .where(eq(campaigns.title, HOLDING_CAMPAIGN_TITLE))
    .limit(1)

  if (existing.length > 0) return existing[0].id

  // Create one
  const conversationId = randomUUID()
  await db.insert(conversations).values({
    id: conversationId,
    title: 'Qualified Leads Pool',
  })

  const id = randomUUID()
  await db.insert(campaigns).values({
    id,
    conversationId,
    title: HOLDING_CAMPAIGN_TITLE,
    hypothesis: 'Holding campaign for qualified leads not yet assigned to a campaign',
    status: 'draft',
    channels: JSON.stringify([]),
    successMetrics: JSON.stringify([]),
    metrics: JSON.stringify({ totalLeads: 0, qualified: 0, contentGenerated: 0, sent: 0, opened: 0, replied: 0, converted: 0, bounced: 0 }),
  })

  return id
}

function loadRulesFile(path: string): string[] {
  if (!path || !existsSync(path)) return []
  try {
    const content = readFileSync(path, 'utf-8')
    return content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  } catch {
    return []
  }
}
