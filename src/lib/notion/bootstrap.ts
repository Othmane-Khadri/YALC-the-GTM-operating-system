import { db } from '../db'
import { campaigns, campaignLeads, campaignVariants, conversations } from '../db/schema'
import { notionService } from '../services/notion'
import type { GTMOSConfig } from '../config/types'

interface BootstrapOptions {
  config: GTMOSConfig
}

export async function runBootstrap(opts: BootstrapOptions): Promise<void> {
  const { config } = opts
  console.log('[bootstrap] Importing existing data from Notion → SQLite...')

  // Create a conversation for imported campaigns
  const convId = crypto.randomUUID()
  await db.insert(conversations).values({
    id: convId,
    title: 'Notion Import',
  })

  // 1. Import campaigns
  console.log('[bootstrap] Fetching campaigns from Notion...')
  const campaignPages = await notionService.queryDatabase(config.notion.campaigns_ds)
  console.log(`[bootstrap] Found ${campaignPages.length} campaign(s)`)

  for (const page of campaignPages) {
    const p = page as { id: string; properties?: Record<string, unknown> }
    const props = p.properties ?? {}
    const title = extractTitle(props)
    const status = extractSelect(props, 'Status') ?? 'active'

    const campaignId = crypto.randomUUID()
    await db.insert(campaigns).values({
      id: campaignId,
      conversationId: convId,
      title: title ?? 'Imported Campaign',
      hypothesis: extractText(props, 'Hypothesis') ?? '',
      status: mapStatus(status),
      targetSegment: extractText(props, 'Target Segment'),
      channels: JSON.stringify(['linkedin']),
      successMetrics: JSON.stringify([]),
      metrics: JSON.stringify({}),
      linkedinAccountId: extractText(props, 'LinkedIn Account ID'),
      dailyLimit: extractNumber(props, 'Daily Limit') ?? 30,
      experimentStatus: extractSelect(props, 'Experiment Status'),
      winnerVariant: extractText(props, 'Winner Variant'),
      notionPageId: p.id,
    })

    console.log(`[bootstrap] ✓ Campaign: ${title} (${status})`)
  }

  // 2. Import variants
  console.log('\n[bootstrap] Fetching variants from Notion...')
  const variantPages = await notionService.queryDatabase(config.notion.variants_ds)
  console.log(`[bootstrap] Found ${variantPages.length} variant(s)`)

  for (const page of variantPages) {
    const p = page as { id: string; properties?: Record<string, unknown> }
    const props = p.properties ?? {}
    const name = extractTitle(props)

    // Find matching campaign by relation or title
    const campaignName = extractText(props, 'Campaign') ?? extractRelation(props, 'Campaign')

    await db.insert(campaignVariants).values({
      id: crypto.randomUUID(),
      campaignId: '', // Will need manual linking if relation doesn't resolve
      name: name ?? 'Imported Variant',
      status: extractSelect(props, 'Status') ?? 'active',
      connectNote: extractText(props, 'Connect Note') ?? '',
      dm1Template: extractText(props, 'DM1 Template') ?? '',
      dm2Template: extractText(props, 'DM2 Template') ?? '',
      sends: extractNumber(props, 'Sends') ?? 0,
      accepts: extractNumber(props, 'Accepts') ?? 0,
      acceptRate: extractNumber(props, 'Accept Rate') ?? 0,
      dmsSent: extractNumber(props, 'DMs Sent') ?? 0,
      replies: extractNumber(props, 'Replies') ?? 0,
      replyRate: extractNumber(props, 'Reply Rate') ?? 0,
      notionPageId: p.id,
    })

    console.log(`[bootstrap] ✓ Variant: ${name} (campaign: ${campaignName ?? 'unlinked'})`)
  }

  // 3. Import leads
  console.log('\n[bootstrap] Fetching leads from Notion...')
  const leadPages = await notionService.queryDatabase(config.notion.leads_ds)
  console.log(`[bootstrap] Found ${leadPages.length} lead(s)`)

  let imported = 0
  for (const page of leadPages) {
    const p = page as { id: string; properties?: Record<string, unknown> }
    const props = p.properties ?? {}

    const providerId = extractText(props, 'Provider ID')
    if (!providerId) continue // Skip leads without provider ID

    const lifecycleStatus = extractSelect(props, 'Lifecycle Status') ?? 'Qualified'

    await db.insert(campaignLeads).values({
      id: crypto.randomUUID(),
      campaignId: '', // Will need linking
      providerId,
      linkedinUrl: extractUrl(props, 'LinkedIn URL') ?? extractUrl(props, 'LinkedIn Profile'),
      firstName: extractText(props, 'First Name'),
      lastName: extractText(props, 'Last Name'),
      headline: extractText(props, 'Headline'),
      company: extractText(props, 'Company'),
      lifecycleStatus,
      qualificationScore: extractNumber(props, 'Score') ?? extractNumber(props, 'Qualification Score'),
      tags: JSON.stringify(extractMultiSelect(props, 'Tags')),
      source: extractSelect(props, 'Source'),
      notionPageId: p.id,
    })
    imported++
  }

  console.log(`[bootstrap] ✓ Imported ${imported} leads`)
  console.log('\n[bootstrap] Done! Run `gtm-os notion:sync --direction pull` to finalize linking.')
}

// ─── Notion Property Extractors ──────────────────────────────────────────────

function extractTitle(props: Record<string, unknown>): string | null {
  for (const val of Object.values(props)) {
    const v = val as { type?: string; title?: { plain_text?: string }[] }
    if (v?.type === 'title' && v.title?.[0]?.plain_text) {
      return v.title[0].plain_text
    }
  }
  return null
}

function extractText(props: Record<string, unknown>, key: string): string | null {
  const prop = props[key] as { type?: string; rich_text?: { plain_text?: string }[] } | undefined
  if (prop?.type === 'rich_text' && prop.rich_text?.[0]?.plain_text) {
    return prop.rich_text[0].plain_text
  }
  return null
}

function extractSelect(props: Record<string, unknown>, key: string): string | null {
  const prop = props[key] as { type?: string; select?: { name?: string } } | undefined
  return prop?.select?.name ?? null
}

function extractMultiSelect(props: Record<string, unknown>, key: string): string[] {
  const prop = props[key] as { type?: string; multi_select?: { name?: string }[] } | undefined
  return prop?.multi_select?.map(s => s.name ?? '').filter(Boolean) ?? []
}

function extractNumber(props: Record<string, unknown>, key: string): number | null {
  const prop = props[key] as { type?: string; number?: number | null } | undefined
  return prop?.number ?? null
}

function extractUrl(props: Record<string, unknown>, key: string): string | null {
  const prop = props[key] as { type?: string; url?: string | null } | undefined
  return prop?.url ?? null
}

function extractRelation(props: Record<string, unknown>, key: string): string | null {
  const prop = props[key] as { type?: string; relation?: { id: string }[] } | undefined
  return prop?.relation?.[0]?.id ?? null
}

function mapStatus(notionStatus: string): string {
  const map: Record<string, string> = {
    'Active': 'active',
    'Draft': 'draft',
    'Paused': 'paused',
    'Completed': 'completed',
    'Failed': 'failed',
  }
  return map[notionStatus] ?? notionStatus.toLowerCase()
}
