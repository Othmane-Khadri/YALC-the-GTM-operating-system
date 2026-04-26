import { eq } from 'drizzle-orm'
import { db } from '../db'
import { campaigns, campaignLeads, campaignVariants, conversations } from '../db/schema'
import { notionService } from '../services/notion'
import type { GTMOSConfig } from '../config/types'

interface BootstrapOptions {
  config: GTMOSConfig
  dryRun?: boolean
}

export async function runBootstrap(opts: BootstrapOptions): Promise<void> {
  const { config } = opts
  console.log('[bootstrap] Importing existing data from Notion → SQLite...\n')

  // Create a conversation for imported campaigns
  const convId = crypto.randomUUID()
  await db.insert(conversations).values({
    id: convId,
    title: 'Notion Import',
  })

  // ── Step 1: Import campaigns ──────────────────────────────────────────────
  console.log('[bootstrap] Fetching campaigns from Notion...')
  const campaignPages = await notionService.queryDatabase(config.notion.campaigns_ds)
  console.log(`[bootstrap] Found ${campaignPages.length} campaign(s)`)

  // Map Notion page ID → SQLite campaign ID, and campaign name → campaign ID
  const notionToCampaignId = new Map<string, string>()
  const nameToCampaignId = new Map<string, string>()

  for (const page of campaignPages) {
    const p = page as { id: string; properties?: Record<string, unknown> }
    const props = p.properties ?? {}

    const title = extractTitle(props) // reads "Campaign Name" (title field)
    const status = extractSelect(props, 'Status') ?? 'Active'
    const campaignId = crypto.randomUUID()

    await db.insert(campaigns).values({
      id: campaignId,
      conversationId: convId,
      title: title ?? 'Imported Campaign',
      hypothesis: extractText(props, 'Sequence') ?? '',
      status: mapStatus(status),
      targetSegment: null,
      channels: JSON.stringify(['linkedin']),
      successMetrics: JSON.stringify([]),
      metrics: JSON.stringify({
        totalLeads: extractNumber(props, 'Total Leads') ?? 0,
        qualified: 0,
        contentGenerated: 0,
        sent: extractNumber(props, 'Connects Sent') ?? 0,
        opened: 0,
        replied: extractNumber(props, 'Replies') ?? 0,
        converted: extractNumber(props, 'Demos Booked') ?? 0,
        bounced: 0,
      }),
      linkedinAccountId: extractText(props, 'LinkedIn Account ID'),
      dailyLimit: extractNumber(props, 'Daily Limit') ?? 30,
      sequenceTiming: JSON.stringify({
        connect_to_dm1_days: extractNumber(props, 'Wait After Accept (days)') ?? 2,
        dm1_to_dm2_days: extractNumber(props, 'Wait After DM1 (days)') ?? 3,
      }),
      experimentStatus: mapExperimentStatus(extractSelect(props, 'Experiment Status')),
      winnerVariant: extractText(props, 'Winner Variant'),
      notionPageId: p.id,
    })

    notionToCampaignId.set(p.id, campaignId)
    if (title) nameToCampaignId.set(title, campaignId)

    console.log(`[bootstrap]   ✓ Campaign: ${title} (${status})`)
  }

  // ── Step 2: Import variants ───────────────────────────────────────────────
  console.log('\n[bootstrap] Fetching variants from Notion...')
  const variantPages = await notionService.queryDatabase(config.notion.variants_ds)
  console.log(`[bootstrap] Found ${variantPages.length} variant(s)`)

  // Map variant name → variant ID for lead linking
  const variantNameToCampaignMap = new Map<string, { variantId: string; campaignId: string }>()

  for (const page of variantPages) {
    const p = page as { id: string; properties?: Record<string, unknown> }
    const props = p.properties ?? {}

    const name = extractTitle(props) // "Variant Name" is the title field
    const campaignName = extractText(props, 'Campaign')
    const campaignId = campaignName ? nameToCampaignId.get(campaignName) : null

    if (!campaignId) {
      console.log(`[bootstrap]   ⚠ Variant "${name}" — campaign "${campaignName}" not found, skipping`)
      continue
    }

    const variantId = crypto.randomUUID()
    await db.insert(campaignVariants).values({
      id: variantId,
      campaignId,
      name: name ?? 'Imported Variant',
      status: mapVariantStatus(extractSelect(props, 'Status')),
      connectNote: extractText(props, 'Connect Note') ?? '',
      dm1Template: extractText(props, 'DM1') ?? '',
      dm2Template: extractText(props, 'DM2') ?? '',
      sends: extractNumber(props, 'Sends') ?? 0,
      accepts: extractNumber(props, 'Accepts') ?? 0,
      acceptRate: extractNumber(props, 'Accept Rate') ?? 0,
      dmsSent: extractNumber(props, 'DMs Sent') ?? 0,
      replies: extractNumber(props, 'Replies') ?? 0,
      replyRate: extractNumber(props, 'Reply Rate') ?? 0,
      notionPageId: p.id,
    })

    if (name) {
      variantNameToCampaignMap.set(name, { variantId, campaignId })
    }

    console.log(`[bootstrap]   ✓ Variant: ${name} → ${campaignName}`)
  }

  // ── Step 3: Import leads ──────────────────────────────────────────────────
  console.log('\n[bootstrap] Fetching leads from Notion...')
  const leadPages = await notionService.queryDatabase(config.notion.leads_ds)
  console.log(`[bootstrap] Found ${leadPages.length} lead(s)`)

  let imported = 0
  let skipped = 0

  for (const page of leadPages) {
    const p = page as { id: string; properties?: Record<string, unknown> }
    const props = p.properties ?? {}

    const providerId = extractText(props, 'Provider ID')
    if (!providerId) {
      skipped++
      continue
    }

    // Link to campaign by campaign name
    const campaignName = extractText(props, 'Campaign')
    const campaignId = campaignName ? nameToCampaignId.get(campaignName) : null

    if (!campaignId) {
      skipped++
      continue
    }

    // Link to variant by variant name
    const variantName = extractText(props, 'Variant')
    const variantInfo = variantName ? variantNameToCampaignMap.get(variantName) : null
    const variantId = variantInfo?.variantId ?? null

    const lifecycleStatus = extractSelect(props, 'Lifecycle Status') ?? 'Queued'
    const leadName = extractTitle(props) // "Lead Name" is the title field

    await db.insert(campaignLeads).values({
      id: crypto.randomUUID(),
      campaignId,
      variantId,
      providerId,
      linkedinUrl: extractUrl(props, 'LinkedIn URL'),
      firstName: leadName?.split(' ')[0] ?? null,
      lastName: leadName?.split(' ').slice(1).join(' ') ?? null,
      headline: extractText(props, 'Title'),
      company: extractText(props, 'Company'),
      lifecycleStatus,
      qualificationScore: extractNumber(props, 'Score'),
      tags: JSON.stringify(extractMultiSelect(props, 'Qualification Tags')),
      source: extractSelect(props, 'Source'),
      connectSentAt: extractDate(props, 'Connect Sent At'),
      connectedAt: extractDate(props, 'Connected At'),
      dm1SentAt: extractDate(props, 'DM1 Sent At'),
      dm2SentAt: extractDate(props, 'DM2 Sent At'),
      notionPageId: p.id,
    })
    imported++
  }

  console.log(`[bootstrap]   ✓ Imported ${imported} leads (${skipped} skipped — no provider ID or no campaign match)`)

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n[bootstrap] Done!`)
  console.log(`  Campaigns: ${campaignPages.length}`)
  console.log(`  Variants:  ${variantNameToCampaignMap.size}`)
  console.log(`  Leads:     ${imported}`)
  console.log(`\nRun \`yalc-gtm campaign:dashboard\` to visualize.`)
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

function extractDate(props: Record<string, unknown>, key: string): string | null {
  const prop = props[key] as { type?: string; date?: { start?: string } | null } | undefined
  return prop?.date?.start ?? null
}

function mapStatus(notionStatus: string): string {
  const map: Record<string, string> = {
    'Active': 'active',
    'Draft': 'draft',
    'Paused': 'paused',
    'Completed': 'completed',
  }
  return map[notionStatus] ?? notionStatus.toLowerCase()
}

function mapVariantStatus(status: string | null): string {
  if (!status) return 'active'
  const map: Record<string, string> = {
    'Active': 'active',
    'Winner': 'winner',
    'Retired': 'retired',
  }
  return map[status] ?? status.toLowerCase()
}

function mapExperimentStatus(status: string | null): string | null {
  if (!status) return null
  const map: Record<string, string> = {
    'Running': 'testing',
    'Winner Declared': 'winner_declared',
    'Inconclusive': 'inconclusive',
    'No Test': null!,
  }
  return map[status] ?? null
}
