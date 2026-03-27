import { eq } from 'drizzle-orm'
import { db } from '../db'
import { campaigns, campaignLeads, campaignVariants } from '../db/schema'
import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'
import { notionService } from '../services/notion'
import {
  buildFunnelSection,
  buildVariantSection,
  buildTagSection,
  buildSourceSection,
  buildSegmentSection,
  buildScoringAccuracySection,
  buildTrendsSection,
  declareWinner,
} from './report-sections'
import type { CampaignReport } from './report-types'
import type { GTMOSConfig } from '../config/types'

interface ReportOptions {
  config: GTMOSConfig
  campaignId?: string
  week?: string
}

export async function generateCampaignReport(campaignId: string): Promise<CampaignReport> {
  const campaignRows = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))
  if (campaignRows.length === 0) throw new Error(`Campaign ${campaignId} not found`)

  const campaignRow = campaignRows[0]
  const leads = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, campaignId))
  const variants = await db.select().from(campaignVariants).where(eq(campaignVariants.campaignId, campaignId))

  // Build all 7 sections
  const funnel = buildFunnelSection(leads)
  const variantSection = buildVariantSection(leads, variants)
  const tags = buildTagSection(leads)
  const sources = buildSourceSection(leads)
  const segments = buildSegmentSection(leads)
  const scoringAccuracy = buildScoringAccuracySection(leads)
  const trends = buildTrendsSection(leads)
  const winner = declareWinner(variantSection.variants)

  // Auto-update variant stats in DB
  for (const vs of variantSection.variants) {
    await db.update(campaignVariants).set({
      sends: vs.sends,
      accepts: vs.accepts,
      acceptRate: vs.acceptRate,
      dmsSent: vs.dmsSent,
      replies: vs.replies,
      replyRate: vs.replyRate,
    }).where(eq(campaignVariants.id, vs.variantId))
  }

  // Update experiment status on winner
  if (winner) {
    await db.update(campaigns).set({
      experimentStatus: 'winner_declared',
      winnerVariant: winner.variantName,
      updatedAt: new Date().toISOString(),
    }).where(eq(campaigns.id, campaignId))
  }

  // Generate Claude narrative
  let narrative: string | null = null
  try {
    const anthropic = getAnthropicClient()
    const prompt = `Analyze this LinkedIn campaign performance and provide actionable insights:

Campaign: ${campaignRow.title}
Hypothesis: ${campaignRow.hypothesis}

Funnel: ${funnel.stages.map(s => `${s.stage}: ${s.count} (${s.dropoffRate}% dropoff)`).join(' → ')}

Variant Performance:
${variantSection.variants.map(v => `- ${v.name}: ${v.sends} sends, ${v.acceptRate}% accept, ${v.dmsSent} DMs, ${v.replyRate}% reply, avg accept ${v.avgTimeToAcceptHours ?? 'N/A'}h`).join('\n')}

${winner ? `WINNER: ${winner.variantName} (+${winner.margin}% margin)` : 'No winner yet'}

Tags: ${tags.tags.slice(0, 5).map(t => `${t.tag} (${t.count} leads, ${t.replyRate}% reply)`).join(', ')}
Sources: ${sources.sources.map(s => `${s.source} (${s.count} leads, ${s.replyRate}% reply)`).join(', ')}
Segments: ${segments.segments.slice(0, 5).map(s => `${s.segment} (${s.count} leads, ${s.replyRate}% reply)`).join(', ')}
Scoring Correlation: ${scoringAccuracy.pearsonCorrelation ?? 'N/A'}

Provide a 3-section report: Key Insights, Recommendations, Next Steps. Keep it concise.`

    const response = await anthropic.messages.create({
      model: PLANNER_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    narrative = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')
  } catch (err) {
    narrative = `AI analysis skipped: ${err instanceof Error ? err.message : err}`
  }

  return {
    campaignId,
    campaignTitle: campaignRow.title,
    generatedAt: new Date().toISOString(),
    funnel,
    variants: variantSection,
    tags,
    sources,
    segments,
    scoringAccuracy,
    trends,
    winner,
    narrative,
  }
}

export async function runReport(opts: ReportOptions): Promise<void> {
  console.log('[report] Generating campaign intelligence report...')

  let campaignRows
  if (opts.campaignId) {
    campaignRows = await db.select().from(campaigns).where(eq(campaigns.id, opts.campaignId))
  } else {
    campaignRows = await db.select().from(campaigns).where(eq(campaigns.status, 'active'))
  }

  if (campaignRows.length === 0) {
    console.log('[report] No active campaigns found.')
    return
  }

  for (const campaignRow of campaignRows) {
    console.log(`\n[report] ═══ ${campaignRow.title} ═══`)

    const report = await generateCampaignReport(campaignRow.id)

    // 1. Funnel
    console.log('\n── 1. Funnel ──')
    for (const stage of report.funnel.stages) {
      const bar = stage.count > 0 ? '█'.repeat(Math.min(Math.ceil(stage.count / 2), 30)) : ''
      console.log(`  ${stage.stage.padEnd(15)} ${String(stage.count).padStart(4)}  ${bar}  (${stage.dropoffRate}% drop)`)
    }

    // 2. Variant Performance
    console.log('\n── 2. Variant Performance ──')
    for (const v of report.variants.variants) {
      console.log(`\n  ${v.name}:`)
      console.log(`    Leads: ${v.leadsAssigned} | Sends: ${v.sends} | Accept: ${v.acceptRate}%`)
      console.log(`    DMs: ${v.dmsSent} | Replies: ${v.replies} | Reply Rate: ${v.replyRate}%`)
      if (v.avgTimeToAcceptHours) console.log(`    Avg accept time: ${v.avgTimeToAcceptHours}h`)
      if (v.avgTimeToReplyHours) console.log(`    Avg reply time: ${v.avgTimeToReplyHours}h`)
    }

    // 3. Tags
    if (report.tags.tags.length > 0) {
      console.log('\n── 3. Tag Performance ──')
      for (const t of report.tags.tags.slice(0, 10)) {
        console.log(`  ${t.tag.padEnd(25)} ${t.count} leads | ${t.acceptRate}% accept | ${t.replyRate}% reply`)
      }
    }

    // 4. Sources
    console.log('\n── 4. Source Performance ──')
    for (const s of report.sources.sources) {
      console.log(`  ${s.source.padEnd(20)} ${s.count} leads | ${s.acceptRate}% accept | ${s.replyRate}% reply`)
    }

    // 5. Segments
    console.log('\n── 5. Segment Performance ──')
    for (const s of report.segments.segments.slice(0, 8)) {
      console.log(`  ${s.segment.padEnd(25)} ${s.count} leads | ${s.acceptRate}% accept | ${s.replyRate}% reply`)
    }

    // 6. Scoring Accuracy
    console.log('\n── 6. Scoring Accuracy ──')
    for (const b of report.scoringAccuracy.buckets) {
      console.log(`  Score ${b.range.padEnd(6)} ${String(b.count).padStart(4)} leads | ${b.acceptRate}% accept | ${b.replyRate}% reply`)
    }
    if (report.scoringAccuracy.pearsonCorrelation != null) {
      console.log(`  Pearson correlation: ${report.scoringAccuracy.pearsonCorrelation}`)
    }

    // 7. Trends
    if (report.trends.weeks.length > 0) {
      console.log('\n── 7. Week-over-Week Trends ──')
      for (const w of report.trends.weeks) {
        console.log(`  ${w.weekStart}  ${w.sends} sends | ${w.acceptRate}% accept | ${w.replyRate}% reply`)
      }
    }

    // Winner
    if (report.winner) {
      console.log(`\n  🏆 WINNER: "${report.winner.variantName}" (+${report.winner.margin}% margin, ${report.winner.bestReplyRate}% vs ${report.winner.runnerUpReplyRate}%)`)
    }

    // AI Analysis
    if (report.narrative) {
      console.log('\n── AI Analysis ──')
      console.log(report.narrative)
    }

    // Notion sync
    if (opts.config.notion.parent_page) {
      try {
        await notionService.createPage(opts.config.notion.parent_page, {
          Name: { title: [{ text: { content: `Report: ${campaignRow.title} — ${new Date().toISOString().slice(0, 10)}` } }] },
        })
        console.log('\n[report] Report synced to Notion')
      } catch {
        // Notion push is optional
      }
    }
  }

  console.log('\n[report] Done.')
}
