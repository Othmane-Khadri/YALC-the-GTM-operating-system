// Forward-looking campaign strategy advisor.
//
// Pairs with `campaign/improve.ts` (the retro). Where improve.ts looks
// BACKWARD at a finished campaign and proposes changes for next time, this
// module looks FORWARD: given a new campaign concept the operator is about
// to build, it gathers every past campaign + every past retro + every
// validated/proven intelligence entry, lets the reasoning happen in chat,
// then files a strategy brief that the next campaign should be built against.
//
// The split is the same as improve.ts:
//   --data-only            emit the data block; no LLM
//   --from-file <path>     validate + persist a brief authored in chat
//   (no flag)              unattended fallback that calls Anthropic
//
// The skill explicitly does NOT draft outbound copy — that's
// refine-outbound-copy. Strategy stops at angle / audience / batch size /
// channel choice / test design.

import { desc, eq } from 'drizzle-orm'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../db'
import { campaignLeads, campaignVariants, campaigns } from '../db/schema'
import { DEFAULT_TENANT } from '../tenant/index.js'
import { loadIntelligenceFromDir } from './improve'

export interface CampaignSnapshotWithCopy {
  id: string
  title: string
  hypothesis: string
  status: string
  targetSegment: string | null
  channels: string[]
  createdAt: string | null
  funnel: {
    leads: number
    connectsSent: number
    connectsAccepted: number
    dmsSent: number
    replies: number
    demos: number
    acceptRate: number
    replyRate: number
  }
  /** Sequence-step-level reply attribution from the chatroom extractor. */
  replyAttribution: Array<{ after_step: number; replies: number }>
  /** How many conversations were sampled to produce the attribution. */
  conversationsSampled: number
  variants: Array<{
    name: string
    status: string
    connectNote: string
    dm1Template: string
    dm2Template: string
    sends: number
    accepts: number
    acceptRate: number
    dmsSent: number
    replies: number
    replyRate: number
  }>
}

export interface StrategyDataBlock {
  concept: string
  tenantId: string
  intelligenceDir: string
  outputDir: string
  pastCampaigns: CampaignSnapshotWithCopy[]
  retroBriefs: unknown[]
  intelligence: unknown[]
}

export interface StrategyBrief {
  proposed_campaign_concept: string
  summary: string
  closest_past_campaigns: Array<{
    id: string
    name: string
    why_similar: string
    headline_metric: string
  }>
  what_worked_before: Array<{
    observation: string
    evidence: string
    confidence: 'hypothesis' | 'validated' | 'proven'
  }>
  what_to_carry_forward: Array<{
    decision: string
    rationale: string
    confidence: 'hypothesis' | 'validated' | 'proven'
  }>
  copy_devices_to_test: Array<{
    device: string
    seen_in: string
    why_might_work: string
    confidence: 'hypothesis' | 'validated' | 'proven'
  }>
  what_to_test: Array<{
    hypothesis: string
    test_design: string
    rationale: string
  }>
  open_strategic_questions: string[]
}

function safeJsonParse<T>(text: string | null | undefined): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function divSafe(numer: number, denom: number): number {
  return denom > 0 ? numer / denom : 0
}

async function loadCampaignsWithCopy(tenantId: string): Promise<CampaignSnapshotWithCopy[]> {
  const rows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.tenantId, tenantId))
    .orderBy(desc(campaigns.createdAt))

  const out: CampaignSnapshotWithCopy[] = []
  for (const c of rows) {
    const leads = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, c.id))
    const variantRows = await db.select().from(campaignVariants).where(eq(campaignVariants.campaignId, c.id))

    const connectsSent = leads.filter((l) => l.connectSentAt).length
    const connectsAccepted = leads.filter((l) => l.connectedAt).length
    const dmsSent = leads.filter((l) => l.dm1SentAt).length
    const replies = leads.filter((l) => l.repliedAt).length

    const metricsBlob = safeJsonParse<{
      replyAttribution?: Array<{ after_step: number; replies: number }>
      conversationsSampled?: number
    }>(c.metrics) ?? {}

    out.push({
      id: c.id,
      title: c.title,
      hypothesis: c.hypothesis,
      status: c.status,
      targetSegment: c.targetSegment ?? null,
      channels: safeJsonParse<string[]>(c.channels) ?? [],
      createdAt: c.createdAt ?? null,
      funnel: {
        leads: leads.length,
        connectsSent,
        connectsAccepted,
        dmsSent,
        replies,
        demos: leads.filter((l) => l.lifecycleStatus === 'Demo_Booked').length,
        acceptRate: divSafe(connectsAccepted, connectsSent),
        replyRate: divSafe(replies, dmsSent),
      },
      replyAttribution: metricsBlob.replyAttribution ?? [],
      conversationsSampled: metricsBlob.conversationsSampled ?? 0,
      variants: variantRows.map((v) => ({
        name: v.name,
        status: v.status,
        connectNote: v.connectNote,
        dm1Template: v.dm1Template,
        dm2Template: v.dm2Template,
        sends: v.sends ?? 0,
        accepts: v.accepts ?? 0,
        acceptRate: v.acceptRate ?? 0,
        dmsSent: v.dmsSent ?? 0,
        replies: v.replies ?? 0,
        replyRate: v.replyRate ?? 0,
      })),
    })
  }
  return out
}

function loadRetroBriefs(dir: string): unknown[] {
  if (!existsSync(dir)) return []
  const out: unknown[] = []
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('campaign_improvement_')) continue
    if (!name.endsWith('.json')) continue
    try {
      out.push(JSON.parse(readFileSync(join(dir, name), 'utf8')))
    } catch {
      // Skip unparseable briefs — never block strategy on a single bad file.
    }
  }
  return out
}

export interface StrategyDataOptions {
  tenantId?: string
  concept: string
  intelligenceDir?: string
  outputDir?: string
}

export async function runStrategyData(opts: StrategyDataOptions): Promise<StrategyDataBlock> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT
  const intelDir = opts.intelligenceDir ?? join(process.cwd(), 'data', 'intelligence')
  const outDir = opts.outputDir ?? intelDir

  const pastCampaigns = await loadCampaignsWithCopy(tenantId)
  const retroBriefs = loadRetroBriefs(intelDir)
  const intelligence = loadIntelligenceFromDir(intelDir)

  return {
    concept: opts.concept,
    tenantId,
    intelligenceDir: intelDir,
    outputDir: outDir,
    pastCampaigns,
    retroBriefs,
    intelligence,
  }
}

export interface StrategyWriteOptions {
  filePath: string
  outputDir?: string
}

export interface StrategyWriteResult {
  path: string
  result: StrategyBrief
  supersededId: string | null
}

function slugify(input: string, max = 50): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max)
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

function validateBrief(b: unknown): asserts b is StrategyBrief {
  const o = b as Record<string, unknown>
  const need = [
    'proposed_campaign_concept',
    'summary',
    'closest_past_campaigns',
    'what_worked_before',
    'what_to_carry_forward',
    'copy_devices_to_test',
    'what_to_test',
    'open_strategic_questions',
  ]
  for (const k of need) {
    if (!(k in o)) throw new Error(`Strategy brief is missing field: ${k}`)
  }
}

export async function runStrategyWrite(opts: StrategyWriteOptions): Promise<StrategyWriteResult> {
  const raw = readFileSync(opts.filePath, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  validateBrief(parsed)
  const brief = parsed as StrategyBrief

  const outDir = opts.outputDir ?? join(process.cwd(), 'data', 'intelligence')
  const slug = slugify(brief.proposed_campaign_concept)
  const outPath = join(outDir, `campaign_strategy_${slug}_${dateStamp()}.json`)

  // Supersede any prior strategy brief for the same slug on the same day.
  let supersededId: string | null = null
  if (existsSync(outPath)) {
    try {
      const prior = JSON.parse(readFileSync(outPath, 'utf8')) as { id?: string }
      supersededId = prior.id ?? null
    } catch {
      // Treat unparseable prior as no supersede.
    }
  }

  writeFileSync(outPath, JSON.stringify(brief, null, 2))
  return { path: outPath, result: brief, supersededId }
}
