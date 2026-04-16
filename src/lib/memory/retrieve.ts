/**
 * Hybrid retrieval — Phase 1 / B7.
 *
 * Implements the 7-step pipeline from plan §2b:
 *   1. Entity resolution          extract mentions from the query
 *   2. Graph walk                 gather candidate nodes around anchors
 *   3. Dense + keyword search     cosine (Float32 BLOB) + token overlap
 *   4. RRF fuse                   Reciprocal Rank Fusion with k=60
 *   5. Rerank                     confidence, recency decay, access count
 *   6. Filter                     drop archived + superseded rows
 *   7. Return top-K under a token budget; bump access counters
 *
 * We ship a lightweight keyword scorer instead of SQLite FTS5 because:
 *   (a) the FTS5 virtual tables on the live DB are already present for
 *       knowledge_items but not wired to memory_nodes, and
 *   (b) at Phase 1 scale a streaming token-overlap scorer is fast enough
 *       and avoids a schema migration. The retrieve module keeps a clean
 *       seam so a future BM25 upgrade only touches one function.
 */

import { extractEntities } from './entities.js'
import { walkFrom } from './graph.js'
import { cosineSimilarity, getEmbeddingProvider } from './embeddings.js'
import type { MemoryStore, MemoryNodeRow } from './store.js'

export interface RetrieveOptions {
  query: string
  topK?: number
  /** Optional explicit entity anchors; skips the Claude extraction step. */
  entityIds?: string[]
  /** Token budget for the concatenated content. Default 4000. */
  tokenBudget?: number
  /** Graph walk depth. Default 2. */
  graphDepth?: number
  /** When true, does not call Claude for entity extraction (offline mode). */
  skipEntityExtraction?: boolean
  /** When true, does not call the embedding provider (keyword-only). */
  skipEmbeddings?: boolean
}

export interface RetrievedNode {
  node: MemoryNodeRow
  score: number
  reasons: {
    rrf: number
    denseRank: number | null
    keywordRank: number | null
    confidenceBoost: number
    recencyDecay: number
    accessBoost: number
  }
}

const RRF_K = 60
const RECENCY_HALF_LIFE_DAYS = 90

// ─── Keyword scorer (token-overlap proxy for BM25/FTS5) ────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
}

function keywordScore(queryTokens: Set<string>, content: string): number {
  if (queryTokens.size === 0) return 0
  const tokens = tokenize(content)
  if (tokens.length === 0) return 0
  let hits = 0
  const seen = new Set<string>()
  for (const t of tokens) {
    if (queryTokens.has(t) && !seen.has(t)) {
      seen.add(t)
      hits++
    }
  }
  // Log-scale by content length so long chunks don't dominate purely by size.
  return hits / Math.max(1, Math.log2(tokens.length + 2))
}

// ─── Approx token count (shared convention with chunker) ───────────────

function approxTokens(text: string): number {
  return Math.ceil(text.length * 0.28)
}

// ─── Rerank helpers ────────────────────────────────────────────────────

function confidenceBoost(confidence: string): number {
  if (confidence === 'proven') return 0.4
  if (confidence === 'validated') return 0.2
  return 0
}

function recencyDecay(lastAccessedAt: string | null): number {
  if (!lastAccessedAt) return 0
  const then = new Date(lastAccessedAt).getTime()
  if (!Number.isFinite(then)) return 0
  const ageDays = (Date.now() - then) / (1000 * 60 * 60 * 24)
  // exp half-life decay: -0.2 after ~90 days
  return -0.2 * (1 - Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS))
}

function accessBoost(count: number): number {
  if (count <= 0) return 0
  return Math.min(0.15, Math.log2(count + 1) * 0.03)
}

// ─── Main ──────────────────────────────────────────────────────────────

export async function retrieve(
  store: MemoryStore,
  opts: RetrieveOptions,
): Promise<RetrievedNode[]> {
  const topK = opts.topK ?? 12
  const tokenBudget = opts.tokenBudget ?? 4000
  const graphDepth = opts.graphDepth ?? 2

  // 1. Entity resolution
  let entityIds: string[] = opts.entityIds ?? []
  if (entityIds.length === 0 && !opts.skipEntityExtraction) {
    try {
      const extracted = await extractEntities(opts.query)
      for (const e of extracted) {
        const matches = await store.findEntitiesByName(e.name, e.type)
        for (const m of matches) entityIds.push(m.id)
      }
    } catch {
      // Entity extraction is best-effort; continue without anchors.
    }
  }

  // 2. Graph walk from resolved entities
  let candidateIds: string[] = []
  if (entityIds.length > 0) {
    const walked = await walkFrom(
      store,
      entityIds.map((id) => ({ type: 'entity' as const, id })),
      { depth: graphDepth, includeIncoming: true },
    )
    candidateIds = walked
  }

  // If the graph walk returned nothing, fall back to all active nodes so
  // purely-semantic queries still work on a cold graph.
  let candidates: MemoryNodeRow[]
  if (candidateIds.length > 0) {
    const all: MemoryNodeRow[] = []
    for (const id of candidateIds) {
      const row = await store.getNode(id)
      if (row && !row.archivedAt) all.push(row)
    }
    candidates = all
  } else {
    candidates = await store.listNodes({ limit: 500 })
  }
  if (candidates.length === 0) return []

  // 6. Filter archived (and superseded via archivedAt convention)
  candidates = candidates.filter((c) => !c.archivedAt)
  if (candidates.length === 0) return []

  // 3a. Dense search — embed query + cosine against all stored vectors
  const denseRanks = new Map<string, number>()
  if (!opts.skipEmbeddings) {
    try {
      const provider = getEmbeddingProvider()
      const [qEmb] = await provider.embed([opts.query])
      const stored = await store.getAllEmbeddings()
      const byId = new Map(stored.map((s) => [s.nodeId, s.vector]))
      const scored: Array<{ id: string; sim: number }> = []
      for (const c of candidates) {
        const vec = byId.get(c.id)
        if (!vec || vec.length !== qEmb.vector.length) continue
        scored.push({ id: c.id, sim: cosineSimilarity(qEmb.vector, vec) })
      }
      scored.sort((a, b) => b.sim - a.sim)
      scored.forEach((s, i) => denseRanks.set(s.id, i + 1))
    } catch {
      // Embeddings unavailable — continue keyword-only.
    }
  }

  // 3b. Keyword search
  const queryTokens = new Set(tokenize(opts.query))
  const keywordScored = candidates
    .map((c) => ({ id: c.id, score: keywordScore(queryTokens, c.content) }))
    .sort((a, b) => b.score - a.score)
  const keywordRanks = new Map<string, number>()
  keywordScored.forEach((s, i) => {
    if (s.score > 0) keywordRanks.set(s.id, i + 1)
  })

  // 4. RRF fuse — 1 / (k + rank)
  const rrfScores = new Map<string, number>()
  for (const c of candidates) {
    const dRank = denseRanks.get(c.id)
    const kRank = keywordRanks.get(c.id)
    let s = 0
    if (dRank != null) s += 1 / (RRF_K + dRank)
    if (kRank != null) s += 1 / (RRF_K + kRank)
    rrfScores.set(c.id, s)
  }

  // 5. Rerank with confidence / recency / access
  const enriched: RetrievedNode[] = candidates.map((c) => {
    const rrf = rrfScores.get(c.id) ?? 0
    const cBoost = confidenceBoost(c.confidence)
    const rDecay = recencyDecay(c.lastAccessedAt)
    const aBoost = accessBoost(c.accessCount)
    const total = rrf + cBoost + rDecay + aBoost
    return {
      node: c,
      score: total,
      reasons: {
        rrf,
        denseRank: denseRanks.get(c.id) ?? null,
        keywordRank: keywordRanks.get(c.id) ?? null,
        confidenceBoost: cBoost,
        recencyDecay: rDecay,
        accessBoost: aBoost,
      },
    }
  })

  // Drop rows with no relevance signal at all
  const nonZero = enriched.filter(
    (e) => e.reasons.denseRank != null || e.reasons.keywordRank != null,
  )
  nonZero.sort((a, b) => b.score - a.score)

  // 7. Token budget + topK
  const selected: RetrievedNode[] = []
  let used = 0
  for (const r of nonZero) {
    if (selected.length >= topK) break
    const t = approxTokens(r.node.content)
    if (used + t > tokenBudget && selected.length > 0) break
    selected.push(r)
    used += t
  }

  // Side effect: bump access counters for the returned nodes.
  if (selected.length > 0) {
    await store.touchNodes(selected.map((r) => r.node.id))
  }

  return selected
}

// Exported for unit testing
export const _internal = {
  RRF_K,
  tokenize,
  keywordScore,
  confidenceBoost,
  recencyDecay,
  accessBoost,
}
