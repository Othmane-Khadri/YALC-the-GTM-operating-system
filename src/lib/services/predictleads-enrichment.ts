// Orchestrator: ties the PredictLeads service to the local signal store.
// Handles TTL-cached fetches, JSON:API response normalization, and bulk
// domain enrichment.

import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { predictleadsService, type SignalType } from './predictleads'
import {
  upsertSignals,
  recordFetch,
  isCacheFresh,
  type SignalInput,
} from './predictleads-storage'

type DB = LibSQLDatabase<Record<string, unknown>>

export const ALL_SIGNAL_TYPES: SignalType[] = [
  'job_opening',
  'financing',
  'technology',
  'news',
  'similar_company',
]

export const TYPE_ALIASES: Record<string, SignalType> = {
  jobs: 'job_opening',
  job_opening: 'job_opening',
  funding: 'financing',
  financing: 'financing',
  tech: 'technology',
  technology: 'technology',
  news: 'news',
  similar: 'similar_company',
  similar_company: 'similar_company',
}

export function parseSignalTypes(input: string | undefined): SignalType[] {
  if (!input) return ALL_SIGNAL_TYPES.filter((t) => t !== 'similar_company')
  return input
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .map((s) => TYPE_ALIASES[s])
    .filter((s): s is SignalType => Boolean(s))
}

export interface JsonApiItem {
  id?: string
  type?: string
  attributes?: Record<string, unknown>
}

interface JsonApiRelationshipRef {
  data?: { id?: string; type?: string } | { id?: string; type?: string }[] | null
}

interface JsonApiItemFull extends JsonApiItem {
  relationships?: Record<string, JsonApiRelationshipRef>
}

/**
 * Normalize a JSON:API list response into SignalInput rows.
 *
 * PredictLeads returns `{ data: [{ id, type, attributes, relationships }], included: [{...}] }`.
 * For single resources the response is `{ data: {...}, included: [...] }`.
 *
 * Relationships are resolved against the top-level `included` array so the
 * normalized payload carries the resolved entity's attributes (e.g. for a
 * similar_company row, `similar_company.domain` shows up as `similar_company`
 * on the payload; for a technology_detection, the technology name shows up
 * as `technology`).
 *
 * eventDate is picked from common attribute names: first_seen_at, found_at,
 * published_at, announced_at, refreshed_at.
 */
export function normalizeListResponse(raw: unknown): SignalInput[] {
  const body = raw as {
    data?: JsonApiItemFull | JsonApiItemFull[]
    included?: JsonApiItemFull[]
  }
  if (!body || !body.data) return []
  const items = Array.isArray(body.data) ? body.data : [body.data]
  const includedMap = buildIncludedMap(body.included)

  return items.map((item) => {
    const attrs = item.attributes ?? {}
    const eventDate = pickEventDate(attrs)
    const resolvedRels = resolveRelationships(item.relationships, includedMap)
    return {
      signalId: item.id ?? null,
      payload: { id: item.id, type: item.type, ...attrs, ...resolvedRels },
      eventDate,
    }
  })
}

function buildIncludedMap(included: JsonApiItemFull[] | undefined): Map<string, JsonApiItemFull> {
  const map = new Map<string, JsonApiItemFull>()
  if (!Array.isArray(included)) return map
  for (const item of included) {
    if (item.id && item.type) map.set(`${item.type}:${item.id}`, item)
  }
  return map
}

/**
 * For each relationship, look up the referenced item(s) in `included` and
 * promote useful attributes onto the payload under the relationship key.
 *
 * Single ref: `{ key }: { domain, name, ... }` (just the attributes)
 * Multi ref:  `{ key }: [{ ... }, ...]`
 *
 * Special cases for terse display:
 *   - similar_company → flat string of the target domain (or company_name)
 *   - technology      → flat string of the technology name
 */
function resolveRelationships(
  rels: Record<string, JsonApiRelationshipRef> | undefined,
  included: Map<string, JsonApiItemFull>,
): Record<string, unknown> {
  if (!rels) return {}
  const out: Record<string, unknown> = {}
  for (const [key, ref] of Object.entries(rels)) {
    const data = ref?.data
    if (!data) continue
    if (Array.isArray(data)) {
      const resolved = data
        .map((d) => (d.id && d.type ? included.get(`${d.type}:${d.id}`) : undefined))
        .filter((x): x is JsonApiItemFull => Boolean(x))
        .map((x) => x.attributes ?? {})
      if (resolved.length > 0) out[key] = resolved
    } else {
      if (!data.id || !data.type) continue
      const item = included.get(`${data.type}:${data.id}`)
      if (!item) continue
      const attrs = item.attributes ?? {}
      // Terse string for display-friendly cases
      if (key === 'similar_company' && typeof attrs.domain === 'string') {
        out[key] = attrs.domain
        out.similar_company_name = attrs.company_name
      } else if (key === 'technology' && typeof attrs.name === 'string') {
        out[key] = attrs.name
      } else {
        out[key] = attrs
      }
    }
  }
  return out
}

const EVENT_DATE_KEYS = [
  'first_seen_at',
  'found_at',
  'published_at',
  'announced_at',
  'date',
  'refreshed_at',
  'last_seen_at',
] as const

function pickEventDate(attrs: Record<string, unknown>): string | null {
  for (const key of EVENT_DATE_KEYS) {
    const v = attrs[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

export interface EnrichResult {
  domain: string
  perType: Record<SignalType, { fetched: boolean; count: number; cacheHit: boolean }>
  errors: { signalType: SignalType; message: string }[]
}

export interface EnrichOptions {
  domain: string
  types?: SignalType[]
  ttlDays?: number
  forceRefresh?: boolean
  tenantId?: string
}

/**
 * Pull signals for a single domain. Returns a per-type breakdown noting
 * cache hits, fetched counts, and per-type errors.
 *
 * Throttle: 250ms delay between API calls.
 */
export async function enrichDomain(db: DB, opts: EnrichOptions): Promise<EnrichResult> {
  const types = opts.types ?? parseSignalTypes(undefined)
  const ttlDays = opts.ttlDays ?? 7
  const result: EnrichResult = {
    domain: opts.domain,
    perType: {} as Record<SignalType, { fetched: boolean; count: number; cacheHit: boolean }>,
    errors: [],
  }

  for (const signalType of types) {
    if (!opts.forceRefresh) {
      const fresh = await isCacheFresh(db, { domain: opts.domain, signalType, ttlDays })
      if (fresh) {
        result.perType[signalType] = { fetched: false, count: 0, cacheHit: true }
        continue
      }
    }

    try {
      const raw = await callService(signalType, opts.domain)
      const signals = normalizeListResponse(raw)
      await upsertSignals(db, {
        domain: opts.domain,
        signalType,
        signals,
        tenantId: opts.tenantId,
      })
      await recordFetch(db, {
        domain: opts.domain,
        signalType,
        rowsReturned: signals.length,
        tenantId: opts.tenantId,
      })
      result.perType[signalType] = { fetched: true, count: signals.length, cacheHit: false }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push({ signalType, message })
      result.perType[signalType] = { fetched: false, count: 0, cacheHit: false }
    }

    await new Promise((r) => setTimeout(r, 250))
  }

  return result
}

async function callService(signalType: SignalType, domain: string): Promise<unknown> {
  switch (signalType) {
    case 'job_opening':
      return predictleadsService.getJobOpenings(domain)
    case 'financing':
      return predictleadsService.getFinancingEvents(domain)
    case 'news':
      return predictleadsService.getNewsEvents(domain)
    case 'technology':
      return predictleadsService.getTechnologies(domain)
    case 'similar_company':
      return predictleadsService.getSimilarCompanies(domain)
  }
}

/**
 * Build a compact one-line summary for Notion mirroring.
 * Reads the most recent N signals (any type) and produces a short string
 * like: `Series B $30M (2026-04-12) · Hiring 3 sales · Uses Salesforce`.
 */
export function buildNotionSummary(
  signals: { signalType: SignalType; payload: unknown; eventDate: string | null }[],
  maxItems = 3,
): string {
  return signals
    .slice(0, maxItems)
    .map((s) => describeSignal(s))
    .filter((s) => s.length > 0)
    .join(' · ')
}

function describeSignal(s: { signalType: SignalType; payload: unknown; eventDate: string | null }): string {
  const p = (s.payload ?? {}) as Record<string, unknown>
  switch (s.signalType) {
    case 'financing': {
      const round = String(p.round ?? p.financing_type ?? '')
      const amount = String(p.amount ?? '')
      const date = s.eventDate ? ` (${s.eventDate.slice(0, 10)})` : ''
      const label = [round, amount].filter(Boolean).join(' ').trim() || 'Funding'
      return `${label}${date}`
    }
    case 'job_opening': {
      const title = String(p.title ?? p.job_title ?? 'role')
      return `Hiring: ${title}`
    }
    case 'technology': {
      const tech = String(p.title ?? p.technology_name ?? p.name ?? 'tech')
      return `Uses: ${tech}`
    }
    case 'news': {
      const title = String(p.title ?? p.headline ?? p.summary ?? 'news')
      const truncated = title.length > 60 ? title.slice(0, 57) + '...' : title
      return truncated
    }
    case 'similar_company': {
      const sim = String(p.similar_company ?? p.domain ?? '')
      return sim ? `Similar: ${sim}` : ''
    }
  }
}
