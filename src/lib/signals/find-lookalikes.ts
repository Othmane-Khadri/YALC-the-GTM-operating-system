// ─── Shared find-lookalikes helper ───────────────────────────────────────────
// In-process lookalike lookup used by both the `signals:similar` CLI command
// and the closed-won-lookalikes-watcher agent runner. Wraps the PredictLeads
// similar_companies endpoint, normalizes the JSON:API response, persists the
// rows to the company_signals cache, and returns a flat array of
// LookalikeResult records ranked by the upstream provider.
//
// This replaces the previous subprocess shell-out (`npx tsx src/cli/index.ts
// signals:similar ...`) the agent runner used to fan out per anchor domain.

import { predictleadsService } from '../services/predictleads.js'
import { db as defaultDb } from '../db/index.js'
import {
  upsertSignals,
  recordFetch,
} from '../services/predictleads-storage.js'
import { normalizeListResponse } from '../services/predictleads-enrichment.js'
import { DEFAULT_TENANT, resolveTenant } from '../tenant/index.js'

export interface LookalikeResult {
  /** Lookalike company domain (lower-case). */
  domain: string
  /** Best-effort display name, when the upstream payload carries one. */
  companyName?: string
  /** Provider similarity score, when present. */
  similarityScore?: number
  /** Free-form similarity reason, when present. */
  reason?: string
  /** Raw normalized payload, for callers that need every attribute. */
  raw: Record<string, unknown>
}

export interface FindLookalikesOptions {
  /** Max similar companies to fetch from PredictLeads. Defaults to 50. */
  limit?: number
  /** Tenant override; defaults to the active tenant from getTenant(). */
  tenantId?: string
  /** Persist results to the company_signals cache. Defaults to true. */
  persist?: boolean
  /** Inject a db instance for tests. Defaults to the production singleton. */
  db?: typeof defaultDb
}

/**
 * Fetch lookalike companies for a seed domain from PredictLeads.
 *
 * Side effects (when `persist` is left at its default true): upserts each
 * lookalike into `company_signals` and records a `company_signal_fetches`
 * row so the 7-day cache TTL is honored across callers.
 */
export async function findLookalikes(
  domain: string,
  opts: FindLookalikesOptions = {},
): Promise<LookalikeResult[]> {
  const limit = opts.limit ?? 50
  const persist = opts.persist ?? true
  const tenantId =
    opts.tenantId ?? resolveTenant({ env: process.env }) ?? DEFAULT_TENANT
  const dbInstance = opts.db ?? defaultDb

  const raw = await predictleadsService.getSimilarCompanies(domain, { limit })
  const signals = normalizeListResponse(raw)

  if (persist) {
    await upsertSignals(dbInstance, {
      domain,
      signalType: 'similar_company',
      signals,
      tenantId,
    })
    await recordFetch(dbInstance, {
      domain,
      signalType: 'similar_company',
      rowsReturned: signals.length,
      tenantId,
    })
  }

  return signals.map((sig) => {
    const payload = (sig.payload ?? {}) as Record<string, unknown>
    const similar = String(payload.similar_company ?? payload.domain ?? '')
      .toLowerCase()
      .trim()
    const score = payload.score
    const companyName =
      typeof payload.similar_company_name === 'string'
        ? (payload.similar_company_name as string)
        : typeof payload.company_name === 'string'
          ? (payload.company_name as string)
          : typeof payload.name === 'string'
            ? (payload.name as string)
            : undefined
    const reason =
      typeof payload.reason === 'string' ? (payload.reason as string) : undefined
    return {
      domain: similar,
      companyName,
      similarityScore: typeof score === 'number' ? score : undefined,
      reason,
      raw: payload,
    }
  })
}
