// Bulk enrichment helper: walks a result set, deduplicates by domain,
// pulls PredictLeads signals for each unique domain, and (best-effort)
// mirrors a compact summary back onto the lead's Notion row.

import { eq } from 'drizzle-orm'
import { db } from '../db'
import { resultRows } from '../db/schema'
import { enrichDomain, parseSignalTypes } from './predictleads-enrichment'
import { syncSignalsToLead } from '../notion/sync'
import { notionService } from './notion'

export interface BulkEnrichOptions {
  resultSetId: string
  types?: string
  ttlDays?: number
  forceRefresh?: boolean
  tenantId?: string
}

interface LeadRow {
  rowId: string
  domain: string | null
  notionPageId: string | null
}

/** Extract a domain from a lead row's email or explicit domain fields. */
function extractDomain(data: Record<string, unknown>): string | null {
  const explicit = data.domain ?? data.company_domain ?? data.company_website ?? data.website
  if (typeof explicit === 'string' && explicit.length > 0) {
    return cleanDomain(explicit)
  }
  const email = data.email
  if (typeof email === 'string' && email.includes('@')) {
    const host = email.split('@')[1]
    if (host && !PERSONAL_EMAIL_DOMAINS.has(host.toLowerCase())) {
      return host.toLowerCase()
    }
  }
  return null
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
])

function cleanDomain(s: string): string {
  return s
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
    .trim()
}

export async function enrichResultSet(opts: BulkEnrichOptions): Promise<void> {
  const rows = await db.select().from(resultRows).where(eq(resultRows.resultSetId, opts.resultSetId))
  if (rows.length === 0) {
    console.log(`[signals:enrich] No rows in result set ${opts.resultSetId}`)
    return
  }

  // Build (rowId, domain, notionPageId) tuples; group by domain so we
  // only call PredictLeads once per company.
  const byDomain = new Map<string, LeadRow[]>()
  let leadsWithoutDomain = 0
  for (const r of rows) {
    const data = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as Record<string, unknown>
    const domain = extractDomain(data)
    const notionPageId = (data.notion_page_id ?? data.notionPageId) as string | undefined
    if (!domain) {
      leadsWithoutDomain++
      continue
    }
    const entry: LeadRow = {
      rowId: r.id,
      domain,
      notionPageId: typeof notionPageId === 'string' ? notionPageId : null,
    }
    const list = byDomain.get(domain) ?? []
    list.push(entry)
    byDomain.set(domain, list)
  }

  console.log(`[signals:enrich] ${rows.length} leads → ${byDomain.size} unique domains`)
  if (leadsWithoutDomain > 0) {
    console.log(`[signals:enrich] Skipped ${leadsWithoutDomain} leads with no resolvable domain`)
  }

  const types = parseSignalTypes(opts.types)
  let domainsProcessed = 0
  let signalsAdded = 0
  let cacheHits = 0
  const errors: string[] = []

  for (const [domain, leads] of byDomain) {
    domainsProcessed++
    const result = await enrichDomain(db, {
      domain,
      types,
      ttlDays: opts.ttlDays ?? 7,
      forceRefresh: opts.forceRefresh,
      tenantId: opts.tenantId,
    })

    for (const info of Object.values(result.perType)) {
      signalsAdded += info.count
      if (info.cacheHit) cacheHits++
    }
    if (result.errors.length > 0) {
      for (const e of result.errors) errors.push(`${domain}/${e.signalType}: ${e.message}`)
    }

    // Best-effort Notion mirror — skip if no NOTION_API_KEY set.
    if (notionService.isAvailable()) {
      for (const lead of leads) {
        if (!lead.notionPageId) continue
        try {
          await syncSignalsToLead(lead.notionPageId, domain, { tenantId: opts.tenantId })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          errors.push(`notion:${lead.notionPageId}: ${message}`)
        }
      }
    }

    if (domainsProcessed % 10 === 0) {
      console.log(`[signals:enrich] ${domainsProcessed}/${byDomain.size} domains`)
    }
  }

  console.log(
    `[signals:enrich] Done. domains=${domainsProcessed} signals=+${signalsAdded} cacheHits=${cacheHits} errors=${errors.length}`,
  )
  if (errors.length > 0 && errors.length <= 10) {
    for (const e of errors) console.log(`  ${e}`)
  }
}
