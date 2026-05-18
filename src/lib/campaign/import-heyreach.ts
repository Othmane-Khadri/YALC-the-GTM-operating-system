// Importer: pulls HeyReach campaigns into the local YALC SQLite so retro /
// dashboard / monthly-report skills can read them like native YALC campaigns.
//
// Design notes:
//
// 1. Idempotent. Campaign primary key is `heyreach:<campaignId>` so re-running
//    the importer upserts the same rows instead of duplicating.
// 2. Sender-scoped. The caller passes a LinkedIn account id (e.g. David's
//    160491) and only campaigns where that id appears in `campaignAccountIds`
//    get imported. Other senders' campaigns are skipped entirely.
// 3. HeyReach does not expose per-lead funnel timestamps via the public API,
//    only campaign-level aggregates. We synthesize `totalUsers` placeholder
//    `campaign_leads` rows per campaign and distribute the aggregate counts
//    (connectionsSent / connectionsAccepted / totalMessageStarted /
//    totalMessageReplies) across them with proportional timestamps. The
//    retro-skill snapshot reads its top-level funnel counts from those rows,
//    so this preserves the aggregate numbers without inventing per-lead
//    identity.
// 4. Variant aggregates are also written (`campaign_variants` row per campaign)
//    so the retro skill's prompt block surfaces sends/accepts/dms/replies
//    directly from HeyReach's overallStats.

import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db } from '../db'
import { campaignLeads, campaignVariants, campaigns, conversations } from '../db/schema'
import {
  extractCampaignCopy,
  filterCampaignsBySender,
  getOverallStats,
  listAllCampaigns,
  type ExtractedCopy,
  type HeyReachCampaign,
  type HeyReachStats,
} from '../services/heyreach'

export interface ImportOptions {
  tenantId: string
  /** LinkedIn account id to scope by — e.g. 160491 for David Small. */
  senderAccountId: number
  /** Hard-fail the run before any DB writes. */
  dryRun?: boolean
  /** Skip the HTTP cache for this run (forces fresh API responses). */
  bypassCache?: boolean
}

export interface ImportSummary {
  scanned: number
  matchedSender: number
  imported: Array<{
    heyreachId: number
    campaignRowId: string
    name: string
    status: string
    inserted: boolean
    updated: boolean
    leadsWritten: number
    funnel: { sent: number; accepted: number; dms: number; replies: number }
    /** Step at which each reply first arrived. e.g. [{after_step:1, replies:8},{after_step:2, replies:4}] */
    replyAttribution: Array<{ after_step: number; replies: number }>
    /** Whether the importer was able to extract real DM copy from chatrooms. */
    copyExtracted: boolean
  }>
  skipped: Array<{ heyreachId: number; name: string; reason: string }>
}

const STATUS_MAP: Record<string, string> = {
  DRAFT: 'draft',
  IN_PROGRESS: 'active',
  PAUSED: 'paused',
  FINISHED: 'completed',
  CANCELLED: 'completed',
}

function localCampaignId(heyreachId: number): string {
  return `heyreach:${heyreachId}`
}

function mapStatus(hrStatus: string): string {
  return STATUS_MAP[hrStatus] ?? 'active'
}

interface FunnelCounts {
  sent: number
  accepted: number
  dms: number
  replies: number
}

function deriveFunnel(stats: HeyReachStats): FunnelCounts {
  // Clamp pathological cases (replies > dms etc.) so the proportional fill
  // produces valid status timestamps.
  const sent = Math.max(0, Math.round(stats.connectionsSent))
  const accepted = Math.min(sent, Math.max(0, Math.round(stats.connectionsAccepted)))
  const dms = Math.min(accepted, Math.max(0, Math.round(stats.totalMessageStarted)))
  const replies = Math.min(dms, Math.max(0, Math.round(stats.totalMessageReplies)))
  return { sent, accepted, dms, replies }
}

interface LeadSyntheticRow {
  providerId: string
  lifecycleStatus: string
  connectSentAt: string | null
  connectedAt: string | null
  dm1SentAt: string | null
  repliedAt: string | null
}

/**
 * Distribute aggregate funnel counts across N placeholder leads.
 *
 *   replies         → 'Replied'      (sent + accepted + dm + reply timestamps)
 *   dms - replies   → 'DM1_Sent'     (sent + accepted + dm timestamps)
 *   accepted - dms  → 'Connected'    (sent + accepted timestamps)
 *   sent - accepted → 'Connect_Sent' (sent timestamp only)
 *   remaining       → 'Queued'       (no timestamps)
 */
function buildSyntheticLeads(
  heyreachId: number,
  totalUsers: number,
  funnel: FunnelCounts,
  asOf: string,
): LeadSyntheticRow[] {
  const out: LeadSyntheticRow[] = []
  let idx = 0
  const make = (status: string, ts: Partial<LeadSyntheticRow>) => {
    out.push({
      providerId: `heyreach:${heyreachId}:${idx}`,
      lifecycleStatus: status,
      connectSentAt: ts.connectSentAt ?? null,
      connectedAt: ts.connectedAt ?? null,
      dm1SentAt: ts.dm1SentAt ?? null,
      repliedAt: ts.repliedAt ?? null,
    })
    idx++
  }
  for (let i = 0; i < funnel.replies; i++) {
    make('Replied', { connectSentAt: asOf, connectedAt: asOf, dm1SentAt: asOf, repliedAt: asOf })
  }
  for (let i = 0; i < funnel.dms - funnel.replies; i++) {
    make('DM1_Sent', { connectSentAt: asOf, connectedAt: asOf, dm1SentAt: asOf })
  }
  for (let i = 0; i < funnel.accepted - funnel.dms; i++) {
    make('Connected', { connectSentAt: asOf, connectedAt: asOf })
  }
  for (let i = 0; i < funnel.sent - funnel.accepted; i++) {
    make('Connect_Sent', { connectSentAt: asOf })
  }
  const queued = Math.max(0, totalUsers - funnel.sent)
  for (let i = 0; i < queued; i++) {
    make('Queued', {})
  }
  return out
}

async function upsertCampaignRow(
  c: HeyReachCampaign,
  tenantId: string,
  funnel: FunnelCounts,
  extract: ExtractedCopy | null,
): Promise<{ campaignId: string; inserted: boolean; updated: boolean }> {
  const campaignId = localCampaignId(c.id)
  const status = mapStatus(c.status)
  const channels = JSON.stringify(['linkedin'])
  const successMetrics = JSON.stringify([
    { metric: 'accept_rate', target: 30, baseline: null, actual: null },
    { metric: 'reply_rate', target: 10, baseline: null, actual: null },
  ])
  const metrics = JSON.stringify({
    totalLeads: c.progressStats.totalUsers,
    qualified: c.progressStats.totalUsers,
    contentGenerated: funnel.dms,
    sent: funnel.sent,
    opened: funnel.accepted, // closest analog: accepted = saw the request
    replied: funnel.replies,
    converted: 0,
    bounced: 0,
    // Extension: reply-step attribution (which sequence step each conversation
    // first replied after) and total conversations sampled. Strategy + retro
    // skills read this for copy-level reasoning.
    replyAttribution: extract?.replyAttribution ?? [],
    conversationsSampled: extract?.conversationsSampled ?? 0,
  })

  const existing = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignId)))
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(campaigns)
      .set({
        title: c.name,
        status,
        channels,
        metrics,
        successMetrics,
        linkedinAccountId: String(c.campaignAccountIds[0] ?? ''),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignId)))
    return { campaignId, inserted: false, updated: true }
  }

  // Need a conversation row first (FK NOT NULL).
  const conversationId = randomUUID()
  await db.insert(conversations).values({ id: conversationId, title: `HeyReach: ${c.name}` })
  await db.insert(campaigns).values({
    id: campaignId,
    tenantId,
    conversationId,
    title: c.name,
    hypothesis: `Imported from HeyReach campaign #${c.id}`,
    status,
    targetSegment: null,
    channels,
    successMetrics,
    metrics,
    linkedinAccountId: String(c.campaignAccountIds[0] ?? ''),
    createdAt: c.creationTime,
    updatedAt: new Date().toISOString(),
  })
  return { campaignId, inserted: true, updated: false }
}

function placeholder(label: string): string {
  return `(${label} — no data extracted)`
}

function copyFieldsFromExtract(extract: ExtractedCopy | null): {
  connectNote: string
  dm1Template: string
  dm2Template: string
} {
  if (!extract || extract.steps.length === 0) {
    return {
      connectNote: '(LinkedIn does not expose connect-request notes via API — paste with `campaign:annotate --connect-note`)',
      dm1Template: placeholder('no ME messages found in conversation history'),
      dm2Template: placeholder('no ME messages found in conversation history'),
    }
  }
  const step1 = extract.steps.find((s) => s.step === 1)?.exemplar ?? placeholder('step 1 not found')
  const step2 = extract.steps.find((s) => s.step === 2)?.exemplar ?? placeholder('step 2 not found')
  return {
    // LinkedIn API never exposes the connect-request note. Flag it for manual backfill.
    connectNote: '(LinkedIn does not expose connect-request notes via API — paste with `campaign:annotate --connect-note`)',
    dm1Template: step1,
    dm2Template: step2,
  }
}

/**
 * Preserve an existing column when its current value carries information
 * the new pull lacks. Specifically: if a human has already pasted in a
 * connect note via `campaign:annotate`, keep it — don't blow it away with
 * the auto-generated placeholder on every re-import.
 */
function preserveIfHumanFilled(existing: string | null | undefined, replacement: string): string {
  if (!existing) return replacement
  const isPlaceholder =
    existing.startsWith('(LinkedIn does not expose') ||
    existing.startsWith('(sequence not available') ||
    existing.startsWith('(no ') ||
    existing.startsWith('(partial') ||
    existing.startsWith('(unknown')
  return isPlaceholder ? replacement : existing
}

async function upsertVariantRow(
  campaignRowId: string,
  tenantId: string,
  stats: HeyReachStats,
  extract: ExtractedCopy | null,
): Promise<string> {
  const existing = await db
    .select()
    .from(campaignVariants)
    .where(and(eq(campaignVariants.tenantId, tenantId), eq(campaignVariants.campaignId, campaignRowId)))
    .limit(1)

  const aggregateFields = {
    sends: stats.connectionsSent,
    accepts: stats.connectionsAccepted,
    acceptRate: stats.connectionAcceptanceRate,
    dmsSent: stats.totalMessageStarted,
    replies: stats.totalMessageReplies,
    replyRate: stats.messageReplyRate,
  }
  const copyFields = copyFieldsFromExtract(extract)

  if (existing.length > 0) {
    const prior = existing[0]
    await db
      .update(campaignVariants)
      .set({
        ...aggregateFields,
        connectNote: preserveIfHumanFilled(prior.connectNote, copyFields.connectNote),
        dm1Template: preserveIfHumanFilled(prior.dm1Template, copyFields.dm1Template),
        dm2Template: preserveIfHumanFilled(prior.dm2Template, copyFields.dm2Template),
      })
      .where(eq(campaignVariants.id, prior.id))
    return prior.id
  }

  const id = randomUUID()
  await db.insert(campaignVariants).values({
    id,
    tenantId,
    campaignId: campaignRowId,
    name: 'HeyReach (imported)',
    status: 'active',
    ...copyFields,
    ...aggregateFields,
  })
  return id
}

async function replaceLeadsForCampaign(
  campaignRowId: string,
  tenantId: string,
  variantId: string,
  rows: LeadSyntheticRow[],
): Promise<number> {
  // Delete existing rows (idempotency: we always rewrite the synthetic set
  // because the aggregate counts may have changed since last import).
  await db
    .delete(campaignLeads)
    .where(and(eq(campaignLeads.tenantId, tenantId), eq(campaignLeads.campaignId, campaignRowId)))

  if (rows.length === 0) return 0

  // Batch insert to keep the prepared statement small.
  const BATCH = 200
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH).map((r) => ({
      id: randomUUID(),
      tenantId,
      campaignId: campaignRowId,
      variantId,
      providerId: r.providerId,
      lifecycleStatus: r.lifecycleStatus,
      source: 'heyreach',
      connectSentAt: r.connectSentAt,
      connectedAt: r.connectedAt,
      dm1SentAt: r.dm1SentAt,
      repliedAt: r.repliedAt,
    }))
    await db.insert(campaignLeads).values(slice)
  }
  return rows.length
}

export async function importHeyReachCampaigns(opts: ImportOptions): Promise<ImportSummary> {
  const summary: ImportSummary = { scanned: 0, matchedSender: 0, imported: [], skipped: [] }
  const all = await listAllCampaigns({ bypass: opts.bypassCache })
  summary.scanned = all.length

  const mine = filterCampaignsBySender(all, opts.senderAccountId)
  summary.matchedSender = mine.length

  for (const c of mine) {
    try {
      const stats = await getOverallStats(c.id, [opts.senderAccountId], { bypass: opts.bypassCache })
      const funnel = deriveFunnel(stats)

      // Pull real DM copy + reply-step attribution from chatrooms. Non-fatal:
      // a campaign with zero replies has no chatrooms, so extract returns
      // empty — the import still completes.
      let extract: ExtractedCopy | null = null
      try {
        extract = await extractCampaignCopy({
          campaignId: c.id,
          accountId: opts.senderAccountId,
          bypass: opts.bypassCache,
        })
      } catch (err) {
        // Log and continue — copy extraction is best-effort.
        extract = null
      }

      if (opts.dryRun) {
        summary.imported.push({
          heyreachId: c.id,
          campaignRowId: localCampaignId(c.id),
          name: c.name,
          status: mapStatus(c.status),
          inserted: false,
          updated: false,
          leadsWritten: c.progressStats.totalUsers,
          funnel,
          replyAttribution: extract?.replyAttribution ?? [],
          copyExtracted: (extract?.steps.length ?? 0) > 0,
        })
        continue
      }

      const upsert = await upsertCampaignRow(c, opts.tenantId, funnel, extract)
      const variantId = await upsertVariantRow(upsert.campaignId, opts.tenantId, stats, extract)
      const asOf = c.startedAt ?? c.creationTime
      const synthetic = buildSyntheticLeads(c.id, c.progressStats.totalUsers, funnel, asOf)
      const leadsWritten = await replaceLeadsForCampaign(upsert.campaignId, opts.tenantId, variantId, synthetic)

      summary.imported.push({
        heyreachId: c.id,
        campaignRowId: upsert.campaignId,
        name: c.name,
        status: mapStatus(c.status),
        inserted: upsert.inserted,
        updated: upsert.updated,
        leadsWritten,
        funnel,
        replyAttribution: extract?.replyAttribution ?? [],
        copyExtracted: (extract?.steps.length ?? 0) > 0,
      })
    } catch (err) {
      summary.skipped.push({
        heyreachId: c.id,
        name: c.name,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return summary
}
