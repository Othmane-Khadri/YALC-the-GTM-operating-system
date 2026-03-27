// ─── Campaign Report Section Builders ────────────────────────────────────────
// Pure functions — no DB, no side effects. Testable in isolation.

import type {
  FunnelSection,
  VariantSection,
  VariantStats,
  TagSection,
  SourceSection,
  SegmentSection,
  ScoringAccuracySection,
  TrendsSection,
  WinnerDeclaration,
} from './report-types'
import type { campaignLeads, campaignVariants } from '../db/schema'

type Lead = typeof campaignLeads.$inferSelect
type Variant = typeof campaignVariants.$inferSelect

const FUNNEL_STAGES = [
  'Queued',
  'Connect_Sent',
  'Connected',
  'DM1_Sent',
  'DM2_Sent',
  'Replied',
  'Demo_Booked',
  'Deal_Created',
  'Closed_Won',
] as const

// ─── Funnel ─────────────────────────────────────────────────────────────────

export function buildFunnelSection(leads: Lead[]): FunnelSection {
  const totalLeads = leads.length
  const stageOrder = [...FUNNEL_STAGES]

  // Count leads that have reached or passed each stage
  const stageCounts: Record<string, number> = {}
  for (const stage of stageOrder) {
    stageCounts[stage] = 0
  }

  for (const lead of leads) {
    const status = lead.lifecycleStatus
    const stageIndex = stageOrder.indexOf(status as typeof stageOrder[number])
    if (stageIndex >= 0) {
      // Lead counts toward its stage and all previous stages
      for (let i = 0; i <= stageIndex; i++) {
        stageCounts[stageOrder[i]]++
      }
    }
  }

  const stages = stageOrder.map((stage, i) => {
    const count = stageCounts[stage]
    const prevCount = i > 0 ? stageCounts[stageOrder[i - 1]] : totalLeads
    const dropoffRate = prevCount > 0 ? ((prevCount - count) / prevCount) * 100 : 0

    return { stage, count, dropoffRate: Math.round(dropoffRate * 10) / 10 }
  })

  const closedWon = stageCounts['Closed_Won'] ?? 0
  const overallConversionRate = totalLeads > 0 ? (closedWon / totalLeads) * 100 : 0

  return { stages, totalLeads, overallConversionRate: Math.round(overallConversionRate * 10) / 10 }
}

// ─── Variants ───────────────────────────────────────────────────────────────

function hoursBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const diff = new Date(b).getTime() - new Date(a).getTime()
  return diff > 0 ? diff / (1000 * 60 * 60) : null
}

export function buildVariantSection(leads: Lead[], variants: Variant[]): VariantSection {
  const variantStats: VariantStats[] = variants.map((v) => {
    const vLeads = leads.filter((l) => l.variantId === v.id)
    const sends = vLeads.filter((l) => l.connectSentAt).length
    const accepts = vLeads.filter((l) => l.connectedAt).length
    const dmsSent = vLeads.filter((l) => l.dm1SentAt).length
    const replies = vLeads.filter((l) => l.repliedAt).length

    // Avg time to accept
    const acceptTimes = vLeads
      .map((l) => hoursBetween(l.connectSentAt, l.connectedAt))
      .filter((h): h is number => h !== null)
    const avgTimeToAcceptHours =
      acceptTimes.length > 0 ? Math.round((acceptTimes.reduce((a, b) => a + b, 0) / acceptTimes.length) * 10) / 10 : null

    // Avg time to reply
    const replyTimes = vLeads
      .map((l) => hoursBetween(l.dm1SentAt, l.repliedAt))
      .filter((h): h is number => h !== null)
    const avgTimeToReplyHours =
      replyTimes.length > 0 ? Math.round((replyTimes.reduce((a, b) => a + b, 0) / replyTimes.length) * 10) / 10 : null

    return {
      name: v.name,
      variantId: v.id,
      sends,
      accepts,
      acceptRate: sends > 0 ? Math.round((accepts / sends) * 1000) / 10 : 0,
      dmsSent,
      replies,
      replyRate: dmsSent > 0 ? Math.round((replies / dmsSent) * 1000) / 10 : 0,
      leadsAssigned: vLeads.length,
      avgTimeToAcceptHours,
      avgTimeToReplyHours,
    }
  })

  return { variants: variantStats }
}

// ─── Tags ───────────────────────────────────────────────────────────────────

export function buildTagSection(leads: Lead[]): TagSection {
  const tagMap = new Map<string, { count: number; accepted: number; replied: number }>()

  for (const lead of leads) {
    const tags = (lead.tags as string[] | null) ?? []
    for (const tag of tags) {
      const existing = tagMap.get(tag) ?? { count: 0, accepted: 0, replied: 0 }
      existing.count++
      if (lead.connectedAt) existing.accepted++
      if (lead.repliedAt) existing.replied++
      tagMap.set(tag, existing)
    }
  }

  const tags = Array.from(tagMap.entries())
    .map(([tag, stats]) => ({
      tag,
      count: stats.count,
      acceptRate: stats.count > 0 ? Math.round((stats.accepted / stats.count) * 1000) / 10 : 0,
      replyRate: stats.count > 0 ? Math.round((stats.replied / stats.count) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)

  return { tags }
}

// ─── Source ─────────────────────────────────────────────────────────────────

export function buildSourceSection(leads: Lead[]): SourceSection {
  const sourceMap = new Map<string, { count: number; accepted: number; replied: number }>()

  for (const lead of leads) {
    const source = lead.source ?? 'unknown'
    const existing = sourceMap.get(source) ?? { count: 0, accepted: 0, replied: 0 }
    existing.count++
    if (lead.connectedAt) existing.accepted++
    if (lead.repliedAt) existing.replied++
    sourceMap.set(source, existing)
  }

  const sources = Array.from(sourceMap.entries())
    .map(([source, stats]) => ({
      source,
      count: stats.count,
      acceptRate: stats.count > 0 ? Math.round((stats.accepted / stats.count) * 1000) / 10 : 0,
      replyRate: stats.count > 0 ? Math.round((stats.replied / stats.count) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)

  return { sources }
}

// ─── Segments ───────────────────────────────────────────────────────────────

function extractSegment(headline: string | null): string {
  if (!headline) return 'Unknown'

  const lower = headline.toLowerCase()
  if (lower.includes('ceo') || lower.includes('founder') || lower.includes('co-founder')) return 'Founder/CEO'
  if (lower.includes('cto') || lower.includes('vp engineering') || lower.includes('head of engineering')) return 'Engineering Leadership'
  if (lower.includes('cmo') || lower.includes('vp marketing') || lower.includes('head of marketing')) return 'Marketing Leadership'
  if (lower.includes('cro') || lower.includes('vp sales') || lower.includes('head of sales')) return 'Sales Leadership'
  if (lower.includes('product') || lower.includes('pm')) return 'Product'
  if (lower.includes('engineer') || lower.includes('developer')) return 'Engineering IC'
  if (lower.includes('marketing') || lower.includes('growth')) return 'Marketing'
  if (lower.includes('sales') || lower.includes('account executive') || lower.includes('sdr') || lower.includes('bdr')) return 'Sales'
  if (lower.includes('hr') || lower.includes('people') || lower.includes('talent')) return 'People/HR'
  return 'Other'
}

export function buildSegmentSection(leads: Lead[]): SegmentSection {
  const segMap = new Map<string, { count: number; accepted: number; replied: number }>()

  for (const lead of leads) {
    const segment = extractSegment(lead.headline)
    const existing = segMap.get(segment) ?? { count: 0, accepted: 0, replied: 0 }
    existing.count++
    if (lead.connectedAt) existing.accepted++
    if (lead.repliedAt) existing.replied++
    segMap.set(segment, existing)
  }

  const segments = Array.from(segMap.entries())
    .map(([segment, stats]) => ({
      segment,
      count: stats.count,
      acceptRate: stats.count > 0 ? Math.round((stats.accepted / stats.count) * 1000) / 10 : 0,
      replyRate: stats.count > 0 ? Math.round((stats.replied / stats.count) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)

  return { segments }
}

// ─── Scoring Accuracy ───────────────────────────────────────────────────────

function pearsonCorrelation(x: number[], y: number[]): number | null {
  const n = x.length
  if (n < 3) return null

  const meanX = x.reduce((a, b) => a + b, 0) / n
  const meanY = y.reduce((a, b) => a + b, 0) / n

  let num = 0
  let denX = 0
  let denY = 0

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    num += dx * dy
    denX += dx * dx
    denY += dy * dy
  }

  const den = Math.sqrt(denX * denY)
  return den === 0 ? null : Math.round((num / den) * 100) / 100
}

export function buildScoringAccuracySection(leads: Lead[]): ScoringAccuracySection {
  const ranges = [
    { range: '0-20', min: 0, max: 20 },
    { range: '21-40', min: 21, max: 40 },
    { range: '41-60', min: 41, max: 60 },
    { range: '61-80', min: 61, max: 80 },
    { range: '81-100', min: 81, max: 100 },
  ]

  const buckets = ranges.map(({ range, min, max }) => {
    const bucket = leads.filter((l) => {
      const score = l.qualificationScore ?? 0
      return score >= min && score <= max
    })

    const count = bucket.length
    const accepted = bucket.filter((l) => l.connectedAt).length
    const replied = bucket.filter((l) => l.repliedAt).length

    return {
      range,
      min,
      max,
      count,
      acceptRate: count > 0 ? Math.round((accepted / count) * 1000) / 10 : 0,
      replyRate: count > 0 ? Math.round((replied / count) * 1000) / 10 : 0,
    }
  })

  // Pearson: score vs outcome (1 = replied, 0.5 = accepted, 0 = neither)
  const scores: number[] = []
  const outcomes: number[] = []
  for (const lead of leads) {
    if (lead.qualificationScore != null) {
      scores.push(lead.qualificationScore)
      outcomes.push(lead.repliedAt ? 1 : lead.connectedAt ? 0.5 : 0)
    }
  }

  return {
    buckets,
    pearsonCorrelation: pearsonCorrelation(scores, outcomes),
  }
}

// ─── Trends ─────────────────────────────────────────────────────────────────

function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr)
  const day = date.getDay()
  const diff = date.getDate() - day + (day === 0 ? -6 : 1) // Monday start
  const monday = new Date(date.setDate(diff))
  return monday.toISOString().slice(0, 10)
}

export function buildTrendsSection(leads: Lead[]): TrendsSection {
  const weekMap = new Map<string, { sends: number; accepts: number; replies: number }>()

  for (const lead of leads) {
    if (!lead.connectSentAt) continue
    const weekStart = getWeekStart(lead.connectSentAt)
    const existing = weekMap.get(weekStart) ?? { sends: 0, accepts: 0, replies: 0 }
    existing.sends++
    if (lead.connectedAt) existing.accepts++
    if (lead.repliedAt) existing.replies++
    weekMap.set(weekStart, existing)
  }

  const weeks = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, stats]) => ({
      weekStart,
      sends: stats.sends,
      accepts: stats.accepts,
      acceptRate: stats.sends > 0 ? Math.round((stats.accepts / stats.sends) * 1000) / 10 : 0,
      replies: stats.replies,
      replyRate: stats.sends > 0 ? Math.round((stats.replies / stats.sends) * 1000) / 10 : 0,
    }))

  return { weeks }
}

// ─── Winner Declaration ─────────────────────────────────────────────────────

export function declareWinner(
  variantStats: VariantStats[],
  minDMs = 15,
  marginMultiplier = 1.5,
): WinnerDeclaration | null {
  const eligible = variantStats.filter((v) => v.dmsSent >= minDMs)
  if (eligible.length < 2) return null

  const sorted = [...eligible].sort((a, b) => b.replyRate - a.replyRate)
  const best = sorted[0]
  const runnerUp = sorted[1]

  if (runnerUp.replyRate === 0) {
    // Runner-up has 0% reply rate — best wins if it has any replies
    if (best.replyRate > 0) {
      return {
        variantName: best.name,
        margin: 100,
        isStatisticallySignificant: best.dmsSent >= minDMs && runnerUp.dmsSent >= minDMs,
        bestReplyRate: best.replyRate,
        runnerUpReplyRate: runnerUp.replyRate,
      }
    }
    return null
  }

  const margin = best.replyRate / runnerUp.replyRate
  if (margin < marginMultiplier) return null

  return {
    variantName: best.name,
    margin: Math.round((margin - 1) * 100),
    isStatisticallySignificant: true,
    bestReplyRate: best.replyRate,
    runnerUpReplyRate: runnerUp.replyRate,
  }
}
