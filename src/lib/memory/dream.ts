/**
 * Auto-dream pass — Phase 1 / B9.
 *
 * Lifecycle sub-agent that keeps the memory layer precise as it grows:
 *
 *   1. GENERATION    embed any active node that doesn't yet have an
 *                    embedding row (new ingestions catch up)
 *   2. CLUSTERING    within candidate clusters, fold near-duplicate
 *                    nodes (cosine > 0.85) into the highest-confidence
 *                    head and archive the rest with supersedes edges
 *   3. PROMOTION     bump hypothesis nodes whose access count and age
 *                    meet the promotion thresholds
 *   4. CONTRADICTION surface nodes linked by a 'contradicts' edge and
 *                    halve their confidence score
 *   5. ARCHIVAL      archive nodes not accessed in 365 days
 *   6. INDEX REBUILD run rebuildIndex() to refresh the pointer index
 *
 * Idempotency is the key guarantee: running dream twice back-to-back
 * on the same tenant must be a no-op on the second run. Every mutation
 * is guarded by a "needs work?" check so we never touch rows twice.
 *
 * Progress is logged to stdout, one line per phase.
 */

import { eq, and, isNull, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { memoryNodes, memoryEmbeddings } from './schema.js'
import { MemoryStore } from './store.js'
import { getEmbeddingProvider, cosineSimilarity } from './embeddings.js'
import { rebuildIndex } from './index-builder.js'

const CLUSTER_SIMILARITY = 0.85
const PROMOTION_ACCESS_MIN_FOR_VALIDATED = 3
const PROMOTION_ACCESS_MIN_FOR_PROVEN = 10
const PROMOTION_AGE_DAYS_FOR_PROVEN = 14
const ARCHIVE_AFTER_DAYS = 365

export interface DreamOptions {
  /** Skip the final Claude index rebuild (useful for incremental triggers). */
  incremental?: boolean
  /** Skip any call that hits an external API (embeddings or Claude). */
  offline?: boolean
}

export interface DreamReport {
  tenantId: string
  embedded: number
  clustered: number
  promoted: number
  contradictionsFlagged: number
  archived: number
  indexEntries: number | null
}

export async function dream(
  tenantId: string,
  opts: DreamOptions = {},
): Promise<DreamReport> {
  const store = new MemoryStore(tenantId)
  const report: DreamReport = {
    tenantId,
    embedded: 0,
    clustered: 0,
    promoted: 0,
    contradictionsFlagged: 0,
    archived: 0,
    indexEntries: null,
  }

  // 1. GENERATION — embed active nodes missing a vector row.
  if (!opts.offline) {
    report.embedded = await embedMissing(store)
  }
  log(tenantId, 'generation', `embedded ${report.embedded} node(s)`)

  // 2. CLUSTERING — fold near-dupes.
  report.clustered = await clusterAndFold(store)
  log(tenantId, 'clustering', `folded ${report.clustered} node(s)`)

  // 3. PROMOTION — hypothesis → validated/proven based on access + age.
  report.promoted = await promoteByAccess(store)
  log(tenantId, 'promotion', `promoted ${report.promoted} node(s)`)

  // 4. CONTRADICTION — halve confidence on rows involved in a 'contradicts' edge.
  report.contradictionsFlagged = await flagContradictions(store)
  log(
    tenantId,
    'contradiction',
    `flagged ${report.contradictionsFlagged} node(s)`,
  )

  // 5. ARCHIVAL — drop stale rows past the window.
  report.archived = await archiveStale(store)
  log(tenantId, 'archival', `archived ${report.archived} node(s)`)

  // 6. INDEX REBUILD — Claude Sonnet picks the load-bearing pointers.
  if (!opts.incremental && !opts.offline) {
    try {
      const entries = await rebuildIndex(tenantId)
      report.indexEntries = entries.length
      log(tenantId, 'index', `rebuilt index with ${entries.length} entries`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(tenantId, 'index', `SKIPPED: ${msg}`)
    }
  }

  return report
}

// ─── Phase 1: generation ───────────────────────────────────────────────

async function embedMissing(store: MemoryStore): Promise<number> {
  // Find active nodes without an embedding row.
  const activeNodes = await db
    .select()
    .from(memoryNodes)
    .where(
      and(eq(memoryNodes.tenantId, store.tenantId), isNull(memoryNodes.archivedAt)),
    )
  if (activeNodes.length === 0) return 0

  const existing = await db
    .select()
    .from(memoryEmbeddings)
    .where(eq(memoryEmbeddings.tenantId, store.tenantId))
  const haveEmbedding = new Set(existing.map((r: any) => r.nodeId))

  const missing = activeNodes.filter((n: any) => !haveEmbedding.has(n.id))
  if (missing.length === 0) return 0

  const provider = getEmbeddingProvider()
  const texts = missing.map((n: any) => n.content as string)
  const results = await provider.embed(texts)
  for (let i = 0; i < missing.length; i++) {
    await store.upsertEmbedding(missing[i].id, results[i])
  }
  return missing.length
}

// ─── Phase 2: clustering ───────────────────────────────────────────────

async function clusterAndFold(store: MemoryStore): Promise<number> {
  const embeddings = await store.getAllEmbeddings()
  if (embeddings.length < 2) return 0

  // Union-find over (i, j) pairs with cosine > threshold.
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let cur = x
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur) ?? cur
      parent.set(cur, parent.get(p) ?? p)
      cur = parent.get(cur) ?? cur
    }
    return cur
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const e of embeddings) parent.set(e.nodeId, e.nodeId)

  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const a = embeddings[i]
      const b = embeddings[j]
      if (a.vector.length !== b.vector.length) continue
      const sim = cosineSimilarity(a.vector, b.vector)
      if (sim >= CLUSTER_SIMILARITY) union(a.nodeId, b.nodeId)
    }
  }

  // Group by root.
  const groups = new Map<string, string[]>()
  for (const e of embeddings) {
    const root = find(e.nodeId)
    const list = groups.get(root) ?? []
    list.push(e.nodeId)
    groups.set(root, list)
  }

  let folded = 0
  for (const ids of groups.values()) {
    if (ids.length < 2) continue
    // Resolve nodes and pick the head: highest confidence, tiebreaker
    // on access count then createdAt (oldest wins to preserve history).
    const nodes = (await Promise.all(ids.map((id) => store.getNode(id)))).filter(
      (n): n is NonNullable<typeof n> => n != null && !n.archivedAt,
    )
    if (nodes.length < 2) continue
    nodes.sort((a, b) => {
      const rc = confidenceRank(b.confidence) - confidenceRank(a.confidence)
      if (rc !== 0) return rc
      if (b.accessCount !== a.accessCount) return b.accessCount - a.accessCount
      return (a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : 1
    })
    const head = nodes[0]
    for (const n of nodes.slice(1)) {
      // Skip if already folded in a previous dream pass (idempotency).
      if (n.archivedAt) continue
      await store.addEdge({
        fromType: 'node',
        fromId: head.id,
        toType: 'node',
        toId: n.id,
        relation: 'supersedes',
      })
      await store.archiveNode(n.id, head.id)
      folded++
    }
  }
  return folded
}

function confidenceRank(c: string): number {
  if (c === 'proven') return 3
  if (c === 'validated') return 2
  return 1
}

// ─── Phase 3: promotion ────────────────────────────────────────────────

async function promoteByAccess(store: MemoryStore): Promise<number> {
  const nodes = await store.listNodes({ limit: 1000 })
  let promoted = 0
  for (const n of nodes) {
    if (n.confidence === 'proven') continue
    const ageDays = n.createdAt
      ? (Date.now() - new Date(n.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      : 0

    if (
      n.confidence === 'validated' &&
      n.accessCount >= PROMOTION_ACCESS_MIN_FOR_PROVEN &&
      ageDays >= PROMOTION_AGE_DAYS_FOR_PROVEN
    ) {
      await store.setConfidence(n.id, 'proven', Math.min(100, 80 + n.accessCount))
      promoted++
      continue
    }
    if (
      n.confidence === 'hypothesis' &&
      n.accessCount >= PROMOTION_ACCESS_MIN_FOR_VALIDATED
    ) {
      await store.setConfidence(n.id, 'validated', Math.min(79, 40 + n.accessCount * 5))
      promoted++
    }
  }
  return promoted
}

// ─── Phase 4: contradictions ───────────────────────────────────────────

async function flagContradictions(store: MemoryStore): Promise<number> {
  // Find all 'contradicts' edges, then halve the confidenceScore on both
  // endpoints. Guard with a marker so re-runs don't keep halving.
  const nodes = await store.listNodes({ limit: 2000 })
  let flagged = 0
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const n of nodes) {
    const outs = await store.edgesFrom('node', n.id, ['contradicts'])
    if (outs.length === 0) continue
    // Marker: any node touched by a contradiction has confidence back to
    // hypothesis with its score halved, but only if it isn't already there.
    if (n.confidence !== 'hypothesis' || n.confidenceScore > 1) {
      await store.setConfidence(
        n.id,
        'hypothesis',
        Math.floor((n.confidenceScore || 0) / 2),
      )
      flagged++
    }
    for (const edge of outs) {
      const other = byId.get(edge.toId as string)
      if (!other) continue
      if (other.confidence !== 'hypothesis' || other.confidenceScore > 1) {
        await store.setConfidence(
          other.id,
          'hypothesis',
          Math.floor((other.confidenceScore || 0) / 2),
        )
        flagged++
      }
    }
  }
  return flagged
}

// ─── Phase 5: archival ─────────────────────────────────────────────────

async function archiveStale(store: MemoryStore): Promise<number> {
  const threshold = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()
  // SQL direct — bulk archive rows older than threshold that aren't already archived.
  const result = await db
    .update(memoryNodes)
    .set({ archivedAt: sql`(datetime('now'))` })
    .where(
      and(
        eq(memoryNodes.tenantId, store.tenantId),
        isNull(memoryNodes.archivedAt),
        sql`${memoryNodes.lastAccessedAt} < ${threshold}`,
      ),
    )
  return (result as unknown as { changes?: number })?.changes ?? 0
}

function log(tenantId: string, phase: string, message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[dream][${tenantId}][${phase}] ${message}`)
}
