/**
 * Graph walker — Phase 1 / B6.
 *
 * Thin traversal primitives on top of MemoryStore:
 *   - walkFrom(anchor, depth, relations?)  BFS over outgoing edges
 *   - getCanonicalHead(nodeId)             follow supersedes chain
 *   - collectCandidateNodeIds(anchors, ...) convenience used by retrieve
 *
 * The walker returns visited node IDs (deduped, original BFS order).
 * It never leaks cross-tenant rows because every call goes through
 * the tenant-bound MemoryStore.
 */

import type { MemoryStore } from './store.js'
import type { EdgeRelation } from './schema.js'

export interface WalkOptions {
  depth?: number
  relations?: EdgeRelation[]
  /** Also walk incoming edges (to_id = current). Default false. */
  includeIncoming?: boolean
}

interface Frontier {
  type: 'node' | 'entity'
  id: string
  depth: number
}

/**
 * BFS walk from one or more anchor (node|entity) identifiers.
 * Returns the set of distinct node IDs visited (anchors included if
 * they are nodes). Non-node entities encountered are traversed but
 * not returned — this matches the retrieve pipeline's need for a
 * candidate *node* set.
 */
export async function walkFrom(
  store: MemoryStore,
  anchors: Array<{ type: 'node' | 'entity'; id: string }>,
  opts: WalkOptions = {},
): Promise<string[]> {
  const maxDepth = opts.depth ?? 2
  const relations = opts.relations
  const includeIncoming = opts.includeIncoming ?? false

  const visitedNodes = new Set<string>()
  const visitedKey = new Set<string>()
  const queue: Frontier[] = []

  for (const a of anchors) {
    const key = `${a.type}:${a.id}`
    if (visitedKey.has(key)) continue
    visitedKey.add(key)
    queue.push({ ...a, depth: 0 })
    if (a.type === 'node') visitedNodes.add(a.id)
  }

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.depth >= maxDepth) continue

    const outgoing = await store.edgesFrom(current.type, current.id, relations)
    const incoming = includeIncoming
      ? await store.edgesTo(current.type, current.id, relations)
      : []

    for (const edge of outgoing) {
      const nextType = edge.toType as 'node' | 'entity'
      const nextId = edge.toId as string
      const nextKey = `${nextType}:${nextId}`
      if (visitedKey.has(nextKey)) continue
      visitedKey.add(nextKey)
      if (nextType === 'node') visitedNodes.add(nextId)
      queue.push({ type: nextType, id: nextId, depth: current.depth + 1 })
    }

    for (const edge of incoming) {
      const nextType = edge.fromType as 'node' | 'entity'
      const nextId = edge.fromId as string
      const nextKey = `${nextType}:${nextId}`
      if (visitedKey.has(nextKey)) continue
      visitedKey.add(nextKey)
      if (nextType === 'node') visitedNodes.add(nextId)
      queue.push({ type: nextType, id: nextId, depth: current.depth + 1 })
    }
  }

  return Array.from(visitedNodes)
}

/**
 * Follow the `supersedes` chain from a node id until we reach the canonical
 * head (a row whose `supersedes` field is null). Returns null if the id
 * does not exist. Guards against cycles with a visited set.
 */
export async function getCanonicalHead(
  store: MemoryStore,
  nodeId: string,
): Promise<string | null> {
  const seen = new Set<string>()
  let current: string | null = nodeId
  // `supersedes` semantics: row X.supersedes = Y means X replaces Y.
  // So the canonical head is reached by walking *in reverse* — from Y to X.
  // That's the `supersedes` edge in the memory_edges table with relation
  // 'supersedes'. We walk edgesTo('node', current, ['supersedes']).
  while (current) {
    if (seen.has(current)) return current // cycle break
    seen.add(current)
    const incoming = await store.edgesTo('node', current, ['supersedes'])
    if (incoming.length === 0) return current
    // If multiple nodes claim to supersede this one, pick the most recent.
    const next = incoming
      .map((e: any) => ({ id: e.fromId as string, createdAt: e.createdAt ?? '' }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
    current = next.id
  }
  return null
}

/**
 * Convenience used by retrieve.ts: for each anchor, walk and union the
 * resulting node IDs into a single candidate set.
 */
export async function collectCandidateNodeIds(
  store: MemoryStore,
  anchors: Array<{ type: 'node' | 'entity'; id: string }>,
  opts: WalkOptions = {},
): Promise<Set<string>> {
  const set = new Set<string>()
  const ids = await walkFrom(store, anchors, opts)
  for (const id of ids) set.add(id)
  return set
}
