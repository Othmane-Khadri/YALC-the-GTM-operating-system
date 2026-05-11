import { readFileSync, existsSync } from 'fs'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { db } from '../db'
import { resultRows, campaignLeads, campaigns, conversations } from '../db/schema'
import { IntelligenceStore } from '../intelligence/store'
import { getRegistryReady } from '../providers/registry'
import { buildFrameworkContext, loadFramework } from '../framework/context'
import { notionService } from '../services/notion'
import { runImport } from './importers'
import { DedupEngine } from '../dedup/engine'
import { buildSuppressionSet } from '../dedup/live-sync'
import { sendConfirmation } from '../dedup/slack-confirm'
import type { GTMOSConfig } from '../config/types'
import type { LeadRecord, DedupConfig } from '../dedup/types'
import type { ClientICP, VerifiedFields, DriftFlags, DisqualifyReason } from './types'

const HOLDING_CAMPAIGN_TITLE = '__qualified_leads_pool__'

// ─── Exported helpers (also used by Agent F unit tests) ──────────────────────

/**
 * Token-overlap match. Returns true when the smaller token set has at least
 * 50% of its tokens (min 1) present in the larger set, after lowercase /
 * punctuation-stripped normalization.
 */
export function looselyMatch(a: string, b: string): boolean {
  const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  const aTokens = new Set(tokenize(a))
  const bTokens = new Set(tokenize(b))
  if (aTokens.size === 0 || bTokens.size === 0) return false
  let overlap = 0
  for (const t of aTokens) if (bTokens.has(t)) overlap++
  return overlap >= Math.max(1, Math.min(aTokens.size, bTokens.size) / 2)
}

/**
 * Case-insensitive substring + small synonym map. Returns true when `text`
 * appears to match any of the `patterns` (or vice versa, since the verified
 * field may be more specific than the disqualifier or vice versa).
 */
export function matchesAnyPattern(text: string, patterns: string[]): boolean {
  if (!text) return false
  const lowerText = text.toLowerCase().trim()
  // Small synonym map. Extend as needed; keep alphabetized.
  const synonyms: Record<string, string[]> = {
    'hris': ['hr information systems'],
    'hr information systems': ['hris'],
    'insurance': ['insurance broker', 'insurance brokerage', 'insurance / risk consulting'],
    'insurance broker': ['insurance', 'insurance brokerage'],
  }
  for (const pat of patterns) {
    const lp = pat.toLowerCase().trim()
    if (!lp) continue
    if (lowerText.includes(lp) || lp.includes(lowerText)) return true
    for (const syn of synonyms[lp] ?? []) {
      if (lowerText.includes(syn) || syn.includes(lowerText)) return true
    }
  }
  return false
}

/**
 * Compute drift flags from a lead's source data + Unipile-verified fields.
 * Informational only in v1 — does not affect routing.
 */
export function computeDriftFlags(lead: Record<string, unknown>): DriftFlags {
  const verified = lead.verified as VerifiedFields | undefined
  if (!verified) return { title_mismatch: false, ex_employer_in_headline: false, recent_role_change: false }

  const sourceTitle = String(lead.title ?? lead.position ?? '').trim()
  const verifiedPosition = verified.primary_position ?? ''
  const headline = verified.headline ?? ''

  const title_mismatch = !!sourceTitle && !!verifiedPosition && !looselyMatch(sourceTitle, verifiedPosition)
  const ex_employer_in_headline = /\bex[-\s]([A-Z][\w &.,'-]{1,40})/.test(headline)
  let recent_role_change = false
  if (verified.current_role_start_date) {
    const startMs = Date.parse(verified.current_role_start_date)
    if (!Number.isNaN(startMs)) {
      const days = (Date.now() - startMs) / (1000 * 60 * 60 * 24)
      recent_role_change = days < 30 && days >= 0
    }
  }
  return { title_mismatch, ex_employer_in_headline, recent_role_change }
}

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
  /** Tenant slug, used for framework loading. Defaults to 'default'. */
  tenantId?: string
  /** Mandatory experience-section enrichment + drift gate + verified-employer ICP gate. Default: false (preserves today's behavior). */
  verifyExperience?: boolean
  /** Per-client ICP, resolved by CLI at plan time. Required for the new Gate 4.6 to fire. */
  clientICP?: ClientICP | null
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
  /** Count of leads marked verified.throttled = true. Only meaningful when verifyExperience is true. */
  throttled?: number
  /** Count of leads with any drift flag true. Only meaningful when verifyExperience is true. */
  driftTagged?: number
  /** Count of leads rejected at the verified-ICP gate, grouped by reason. */
  verifiedIcpRejections?: Record<string, number>
}

/**
 * Run the company-disqualifier regex against the pipeline. Extracted into a
 * helper so it can be invoked at different points based on the
 * `verifyExperience` flag (before enrichment when off; after enrichment when
 * on, so the disqualifier matches verified company data).
 */
function runCompanyDisqualifierGate(
  pipeline: Record<string, unknown>[],
  disqualifiers: string[],
  result: QualifyResult,
): Record<string, unknown>[] {
  if (disqualifiers.length === 0) return pipeline
  const passed: Record<string, unknown>[] = []
  for (const lead of pipeline) {
    const verified = lead.verified as VerifiedFields | undefined
    const verifiedCompany = verified?.primary_company ?? ''
    const sourceCompany = String(lead.company ?? lead.company_name ?? '').toLowerCase()
    const company = verifiedCompany ? verifiedCompany.toLowerCase() : sourceCompany
    const industry = String(lead.industry ?? '').toLowerCase()
    const disqualified = disqualifiers.some(dq => {
      const lower = dq.toLowerCase()
      return company.includes(lower) || industry.includes(lower)
    })
    if (disqualified) {
      result.skippedCompany++
    } else {
      passed.push(lead)
    }
  }
  return passed
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

  // ─── Gate 3 / Gate 4 ordering ────────────────────────────────────────────────
  // Default (verifyExperience=false): Gate 3 → Gate 4 (preserves byte-identical
  // legacy behavior). When verifyExperience=true: Gate 4 → Gate 3, so the
  // company-disqualifier regex matches against verified company data.
  const disqualifiers = loadRulesFile(opts.config.qualification.disqualifiers_path)
  const registry = await getRegistryReady()

  if (!opts.verifyExperience) {
    console.log('[qualify] Gate 3: Company disqualifiers...')
    pipeline = runCompanyDisqualifierGate(pipeline, disqualifiers, result)
    console.log(`[qualify] Gate 3: ${result.skippedCompany} company-disqualified, ${pipeline.length} remaining`)
  }

  // ─── Gate 4: Enrichment ──────────────────────────────────────────────────────
  if (opts.verifyExperience) {
    // Mandatory experience-section enrichment for ALL leads.
    console.log('[qualify] Gate 4: Enrichment with experience section (mandatory, all leads)...')
    if (pipeline.length > 0) {
      try {
        const hasLinkedIn = pipeline.some(l => String(l.linkedin_url ?? '').includes('linkedin'))
        const enrichProviderId = hasLinkedIn ? 'unipile' : 'auto'
        const enrichProvider = registry.resolve({ stepType: 'enrich', provider: enrichProviderId })
        const enriched = enrichProvider.execute(
          {
            stepIndex: 0,
            title: 'Enrich',
            stepType: 'enrich',
            provider: enrichProviderId,
            description: 'Enrich leads with LinkedIn profile data + experience section',
            config: { sections: 'experience' },
          },
          {
            frameworkContext: '',
            previousStepRows: pipeline,
            batchSize: 25,
            totalRequested: pipeline.length,
          }
        )
        for await (const batch of enriched) {
          for (const row of batch.rows) {
            const idx = pipeline.findIndex(l =>
              (l.linkedin_url && l.linkedin_url === row.linkedin_url) ||
              (l.provider_id && l.provider_id === row.provider_id)
            )
            if (idx >= 0) {
              // Preserve any existing fields (incl. verified) by spreading row last.
              pipeline[idx] = { ...pipeline[idx], ...row }
            }
          }
        }
      } catch (err) {
        console.log(`[qualify] Enrichment skipped: ${err instanceof Error ? err.message : err}`)
      }
    }
    let throttledCount = 0
    let enrichedCount = 0
    for (const lead of pipeline) {
      const v = lead.verified as VerifiedFields | undefined
      if (v) {
        enrichedCount++
        if (v.throttled) throttledCount++
      }
    }
    result.throttled = throttledCount
    console.log(`[qualify] Gate 4: Enriched ${enrichedCount} leads with experience section, ${throttledCount} throttled`)
  } else {
    // Legacy path: enrich only leads with missing data.
    console.log('[qualify] Gate 4: Enrichment (if needed)...')
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
  }

  // ─── Gate 3 (deferred): Company disqualifiers, after enrichment ──────────────
  if (opts.verifyExperience) {
    console.log('[qualify] Gate 3 (deferred): Company disqualifiers (verified data)...')
    pipeline = runCompanyDisqualifierGate(pipeline, disqualifiers, result)
    console.log(`[qualify] Gate 3: ${result.skippedCompany} company-disqualified, ${pipeline.length} remaining`)
  }

  // ─── Gate 4.5: Drift check (informational, verifyExperience only) ────────────
  if (opts.verifyExperience) {
    let driftCount = 0
    for (const lead of pipeline) {
      const verified = lead.verified as VerifiedFields | undefined
      if (!verified || verified.throttled) continue
      const drift = computeDriftFlags(lead)
      lead.drift = drift
      if (drift.title_mismatch || drift.ex_employer_in_headline || drift.recent_role_change) {
        driftCount++
      }
    }
    result.driftTagged = driftCount
    console.log(`[qualify] Gate 4.5: Drift check tagged ${driftCount}/${pipeline.length} leads (informational only)`)
  }

  // ─── Gate 4.6: Verified-employer ICP match (deterministic hard reject) ───────
  if (opts.verifyExperience && opts.clientICP) {
    const seg = opts.clientICP.primary_segment
    const before = pipeline.length
    const rejected: Array<{ id: unknown; reason: DisqualifyReason }> = []
    pipeline = pipeline.filter(lead => {
      const verified = lead.verified as VerifiedFields | undefined
      if (!verified || verified.throttled) return true  // Skip — no data, no reject
      const company = verified.primary_company ?? ''
      const industry = verified.primary_company_industry ?? ''
      if (company && matchesAnyPattern(company, seg.disqualifiers)) {
        lead.disqualified = { reason: 'company_in_disqualifiers', detail: company }
        rejected.push({ id: lead.id, reason: 'company_in_disqualifiers' })
        return false
      }
      if (industry && matchesAnyPattern(industry, seg.disqualifiers)) {
        lead.disqualified = { reason: 'industry_in_disqualifiers', detail: industry }
        rejected.push({ id: lead.id, reason: 'industry_in_disqualifiers' })
        return false
      }
      if (industry && seg.target_industries.length > 0 && !matchesAnyPattern(industry, seg.target_industries)) {
        lead.disqualified = { reason: 'industry_not_in_target', detail: industry }
        rejected.push({ id: lead.id, reason: 'industry_not_in_target' })
        return false
      }
      return true
    })
    const byReason: Record<string, number> = {}
    for (const r of rejected) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1
    result.verifiedIcpRejections = byReason
    console.log(`[qualify] Gate 4.6: ICP match rejected ${rejected.length}/${before} leads — ${JSON.stringify(byReason)}`)

    // Persist rejected lead metadata back into result_rows.data so the new
    // disqualified field survives. Mirrors how the qualified-leads loop below
    // persists qualified leads into campaignLeads (those rows' data already
    // lives in result_rows; we patch the JSON in place for rejections so the
    // operator can inspect them post-run).
    for (const r of rejected) {
      if (typeof r.id !== 'string') continue
      try {
        const existing = await db.select().from(resultRows).where(eq(resultRows.id, r.id)).limit(1)
        if (existing.length === 0) continue
        const data = typeof existing[0].data === 'string'
          ? JSON.parse(existing[0].data)
          : (existing[0].data as Record<string, unknown>)
        // Find the lead object we filtered out; its `disqualified` is the truth.
        // Fall back to enum-only if not found in memory (shouldn't happen).
        const filtered = leads.find(l => l.id === r.id)
        const disqualified = (filtered?.disqualified as Record<string, unknown> | undefined) ?? { reason: r.reason, detail: '' }
        const merged = { ...data, disqualified, verified: filtered?.verified, drift: filtered?.drift }
        await db.update(resultRows)
          .set({ data: JSON.stringify(merged) })
          .where(eq(resultRows.id, r.id))
      } catch {
        // Soft-fail — don't block the pipeline if persistence hiccups.
      }
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

      const tenantId = opts.tenantId ?? 'default'
      // Backward-compat: when neither verifyExperience nor a clientICP is set,
      // preserve the legacy `buildFrameworkContext(null)` behavior so the
      // existing AI prompt is byte-identical. The framework-load fix only
      // activates for new opt-in invocations.
      const loadedFramework = (opts.verifyExperience || opts.clientICP)
        ? await loadFramework(tenantId).catch(() => null)
        : null
      let frameworkContext = await buildFrameworkContext(loadedFramework, tenantId)

      // Yaml-fallback path: when ICP came from clients/<slug>.yml AND no tenant
      // framework was found, append a small ICP-context block so the qualify
      // prompt still receives the structured ICP rather than the
      // "no context loaded yet" placeholder from buildFrameworkContext(null).
      if (opts.clientICP && opts.clientICP.source === 'repo_yaml' && !loadedFramework) {
        const icp = opts.clientICP.primary_segment
        frameworkContext += `\n\n## ICP Override (from clients/${opts.clientICP.client_slug}.yml)\n`
        frameworkContext += `**Primary segment:** ${icp.name}\n`
        if (icp.target_roles.length) frameworkContext += `**Target roles:** ${icp.target_roles.join(', ')}\n`
        if (icp.target_industries.length) frameworkContext += `**Target industries:** ${icp.target_industries.join(', ')}\n`
        if (icp.disqualifiers.length) frameworkContext += `**Disqualifiers (HARD reject):** ${icp.disqualifiers.join(', ')}\n`
        if (icp.pain_points.length) frameworkContext += `**Pain points:** ${icp.pain_points.join(', ')}\n`
        if (icp.voice) frameworkContext += `**Voice:** ${icp.voice}\n`
        if (icp.messaging) frameworkContext += `**Messaging:** ${icp.messaging}\n`
      }

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

    // When verifyExperience is on, persist verified/drift back into result_rows.data
    // so the operator can inspect them post-run. No-op when those fields are absent.
    if (opts.verifyExperience && typeof lead.id === 'string') {
      try {
        const existing = await db.select().from(resultRows).where(eq(resultRows.id, lead.id)).limit(1)
        if (existing.length > 0) {
          const data = typeof existing[0].data === 'string'
            ? JSON.parse(existing[0].data)
            : (existing[0].data as Record<string, unknown>)
          const merged: Record<string, unknown> = { ...data }
          if (lead.verified !== undefined) merged.verified = lead.verified
          if (lead.drift !== undefined) merged.drift = lead.drift
          await db.update(resultRows)
            .set({ data: JSON.stringify(merged) })
            .where(eq(resultRows.id, lead.id))
        }
      } catch {
        // Soft-fail
      }
    }
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
  if (opts.verifyExperience) {
    console.log(`Throttled:            ${result.throttled ?? 0}`)
    console.log(`Drift-tagged:         ${result.driftTagged ?? 0}`)
    const totalIcpRej = Object.values(result.verifiedIcpRejections ?? {}).reduce((a, b) => a + b, 0)
    console.log(`Verified-ICP rejections: ${totalIcpRej} ${totalIcpRej > 0 ? JSON.stringify(result.verifiedIcpRejections) : ''}`.trimEnd())
  }
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
