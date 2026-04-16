/**
 * Memory store — Phase 1 / B4.
 *
 * Tenant-scoped CRUD on the memory layer. Patterned after
 * `src/lib/intelligence/store.ts` but aware of the dedup contract:
 * `upsertNodeBySourceHash` is the primitive all ingestion paths
 * (onboarding wizard, markdown-folder adapter, campaign compression)
 * call into, so a re-run of the same source only writes new nodes
 * for changed chunks and preserves `accessCount` / `createdAt` on
 * unchanged ones.
 *
 * Every read filters by tenantId. Every write sets it. There is no
 * way to instantiate this store without a tenant.
 */

import { randomUUID } from 'node:crypto'
import { eq, and, desc, inArray, sql, isNull } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  memoryNodes,
  memoryEmbeddings,
  memoryIndex,
  entities as entitiesTable,
  memoryEdges,
  memoryEpisodes,
  type MemoryNodeType,
  type MemoryConfidence,
  type EntityType,
  type EdgeRelation,
} from './schema.js'
import { packEmbedding, unpackEmbedding, type EmbeddingResult } from './embeddings.js'

export interface MemoryNodeRow {
  id: string
  tenantId: string
  type: MemoryNodeType
  content: string
  entities: string[] | null
  sourceType: string
  sourceRef: string
  sourceHash: string
  confidence: MemoryConfidence
  confidenceScore: number
  metadata: Record<string, unknown> | null
  createdAt: string | null
  lastAccessedAt: string | null
  accessCount: number
  validatedAt: string | null
  supersedes: string | null
  archivedAt: string | null
}

export interface UpsertNodeInput {
  type: MemoryNodeType
  content: string
  sourceType: string
  sourceRef: string
  sourceHash: string
  entities?: string[]
  metadata?: Record<string, unknown>
  confidence?: MemoryConfidence
  confidenceScore?: number
}

export interface UpsertResult {
  node: MemoryNodeRow
  /** true if a fresh row was inserted, false if an existing hash matched. */
  inserted: boolean
}

export class MemoryStore {
  constructor(public readonly tenantId: string) {
    if (!tenantId) throw new Error('MemoryStore requires a tenantId')
  }

  // ─── Node CRUD ─────────────────────────────────────────────────────

  /**
   * Primary ingestion primitive. Matches by (tenant, source_hash) so that
   * re-running ingestion on unchanged content is a no-op (and preserves
   * the existing row's access history and any accumulated edges).
   */
  async upsertNodeBySourceHash(input: UpsertNodeInput): Promise<UpsertResult> {
    const existing = await db
      .select()
      .from(memoryNodes)
      .where(
        and(
          eq(memoryNodes.tenantId, this.tenantId),
          eq(memoryNodes.sourceHash, input.sourceHash),
          isNull(memoryNodes.archivedAt),
        ),
      )
      .limit(1)

    if (existing.length > 0) {
      const row = existing[0]
      // Same hash → nothing to update. Caller can bump access via `touch()`.
      return { node: this.deserialize(row), inserted: false }
    }

    const id = randomUUID()
    await db.insert(memoryNodes).values({
      id,
      tenantId: this.tenantId,
      type: input.type,
      content: input.content,
      entities: input.entities ?? null,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      sourceHash: input.sourceHash,
      confidence: input.confidence ?? 'hypothesis',
      confidenceScore: input.confidenceScore ?? 0,
      metadata: input.metadata ?? null,
    })

    const fresh = await this.getNode(id)
    if (!fresh) throw new Error(`Failed to re-read inserted memory node ${id}`)
    return { node: fresh, inserted: true }
  }

  async getNode(id: string): Promise<MemoryNodeRow | null> {
    const rows = await db
      .select()
      .from(memoryNodes)
      .where(and(eq(memoryNodes.tenantId, this.tenantId), eq(memoryNodes.id, id)))
      .limit(1)
    if (rows.length === 0) return null
    return this.deserialize(rows[0])
  }

  async listNodes(opts: { type?: MemoryNodeType; limit?: number } = {}): Promise<MemoryNodeRow[]> {
    const conditions = [eq(memoryNodes.tenantId, this.tenantId), isNull(memoryNodes.archivedAt)]
    if (opts.type) conditions.push(eq(memoryNodes.type, opts.type))
    const rows = await db
      .select()
      .from(memoryNodes)
      .where(and(...conditions))
      .orderBy(desc(memoryNodes.createdAt))
      .limit(opts.limit ?? 1000)
    return rows.map((r) => this.deserialize(r))
  }

  async touchNodes(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const now = new Date().toISOString()
    await db
      .update(memoryNodes)
      .set({
        lastAccessedAt: now,
        accessCount: sql`${memoryNodes.accessCount} + 1`,
      })
      .where(and(eq(memoryNodes.tenantId, this.tenantId), inArray(memoryNodes.id, ids)))
  }

  async archiveNode(id: string, supersededBy?: string): Promise<void> {
    const now = new Date().toISOString()
    await db
      .update(memoryNodes)
      .set({ archivedAt: now, supersedes: supersededBy ?? null })
      .where(and(eq(memoryNodes.tenantId, this.tenantId), eq(memoryNodes.id, id)))
  }

  async setConfidence(
    id: string,
    confidence: MemoryConfidence,
    confidenceScore: number,
  ): Promise<void> {
    const now = new Date().toISOString()
    await db
      .update(memoryNodes)
      .set({
        confidence,
        confidenceScore,
        validatedAt: confidence !== 'hypothesis' ? now : undefined,
      })
      .where(and(eq(memoryNodes.tenantId, this.tenantId), eq(memoryNodes.id, id)))
  }

  // ─── Embeddings ────────────────────────────────────────────────────

  async upsertEmbedding(nodeId: string, result: EmbeddingResult): Promise<void> {
    const blob = packEmbedding(result.vector)
    // Delete-then-insert. Not wrapped in a transaction because libsql's
    // single-writer lock makes nested txs fragile under concurrency, and
    // this operation is idempotent — the dream pass re-upserts on the
    // next run if interrupted mid-sequence.
    await db
      .delete(memoryEmbeddings)
      .where(
        and(
          eq(memoryEmbeddings.tenantId, this.tenantId),
          eq(memoryEmbeddings.nodeId, nodeId),
        ),
      )
    await db.insert(memoryEmbeddings).values({
      nodeId,
      tenantId: this.tenantId,
      embedding: blob,
      model: result.model,
      dims: result.dims,
    })
  }

  async getAllEmbeddings(): Promise<
    Array<{ nodeId: string; vector: Float32Array; dims: number; model: string }>
  > {
    const rows = await db
      .select()
      .from(memoryEmbeddings)
      .where(eq(memoryEmbeddings.tenantId, this.tenantId))
    return rows.map((r: any) => ({
      nodeId: r.nodeId,
      vector: unpackEmbedding(r.embedding as Buffer),
      dims: r.dims,
      model: r.model,
    }))
  }

  // ─── Entities ──────────────────────────────────────────────────────

  async upsertEntity(input: {
    type: EntityType
    name: string
    aliases?: string[]
    properties?: Record<string, unknown>
  }): Promise<{ id: string; inserted: boolean }> {
    // Resolve by exact name OR alias match within this tenant+type.
    const candidates = await db
      .select()
      .from(entitiesTable)
      .where(and(eq(entitiesTable.tenantId, this.tenantId), eq(entitiesTable.type, input.type)))

    const target = candidates.find((e: any) => {
      if (e.name === input.name) return true
      const aliases = (e.aliases as string[] | null) ?? []
      if (aliases.includes(input.name)) return true
      if (input.aliases && aliases.some((a) => input.aliases!.includes(a))) return true
      return false
    })

    if (target) {
      // Merge any newly-observed aliases in.
      const existingAliases = ((target as any).aliases as string[] | null) ?? []
      const merged = Array.from(
        new Set([...existingAliases, ...(input.aliases ?? []), input.name]),
      ).filter((a) => a !== (target as any).name)
      if (merged.length !== existingAliases.length) {
        await db
          .update(entitiesTable)
          .set({ aliases: merged })
          .where(
            and(eq(entitiesTable.tenantId, this.tenantId), eq(entitiesTable.id, (target as any).id)),
          )
      }
      return { id: (target as any).id, inserted: false }
    }

    const id = randomUUID()
    await db.insert(entitiesTable).values({
      id,
      tenantId: this.tenantId,
      type: input.type,
      name: input.name,
      aliases: input.aliases ?? null,
      properties: input.properties ?? null,
    })
    return { id, inserted: true }
  }

  async getEntity(id: string): Promise<any | null> {
    const rows = await db
      .select()
      .from(entitiesTable)
      .where(and(eq(entitiesTable.tenantId, this.tenantId), eq(entitiesTable.id, id)))
      .limit(1)
    return rows[0] ?? null
  }

  async findEntitiesByName(name: string, type?: EntityType): Promise<any[]> {
    const conditions = [eq(entitiesTable.tenantId, this.tenantId), eq(entitiesTable.name, name)]
    if (type) conditions.push(eq(entitiesTable.type, type))
    return db.select().from(entitiesTable).where(and(...conditions))
  }

  // ─── Edges ─────────────────────────────────────────────────────────

  async addEdge(input: {
    fromType: 'node' | 'entity'
    fromId: string
    toType: 'node' | 'entity'
    toId: string
    relation: EdgeRelation
    weight?: number
  }): Promise<string> {
    const id = randomUUID()
    await db.insert(memoryEdges).values({
      id,
      tenantId: this.tenantId,
      fromType: input.fromType,
      fromId: input.fromId,
      toType: input.toType,
      toId: input.toId,
      relation: input.relation,
      weight: input.weight ?? 1,
    })
    return id
  }

  async edgesFrom(
    fromType: 'node' | 'entity',
    fromId: string,
    relations?: EdgeRelation[],
  ): Promise<any[]> {
    const conditions = [
      eq(memoryEdges.tenantId, this.tenantId),
      eq(memoryEdges.fromType, fromType),
      eq(memoryEdges.fromId, fromId),
    ]
    if (relations && relations.length > 0) {
      conditions.push(inArray(memoryEdges.relation, relations))
    }
    return db.select().from(memoryEdges).where(and(...conditions))
  }

  async edgesTo(
    toType: 'node' | 'entity',
    toId: string,
    relations?: EdgeRelation[],
  ): Promise<any[]> {
    const conditions = [
      eq(memoryEdges.tenantId, this.tenantId),
      eq(memoryEdges.toType, toType),
      eq(memoryEdges.toId, toId),
    ]
    if (relations && relations.length > 0) {
      conditions.push(inArray(memoryEdges.relation, relations))
    }
    return db.select().from(memoryEdges).where(and(...conditions))
  }

  // ─── Index ─────────────────────────────────────────────────────────

  async replaceIndex(
    entries: Array<{
      name: string
      description: string
      nodeIds: string[]
      category: string
      priority?: number
    }>,
  ): Promise<void> {
    // Non-transactional delete+insert for the same reason as upsertEmbedding.
    // Worst case: a concurrent reader sees an empty or partially-built
    // index for a few ms, which is fine because the index is a hint layer.
    await db.delete(memoryIndex).where(eq(memoryIndex.tenantId, this.tenantId))
    if (entries.length === 0) return
    const now = new Date().toISOString()
    for (const e of entries) {
      await db.insert(memoryIndex).values({
        id: randomUUID(),
        tenantId: this.tenantId,
        name: e.name,
        description: e.description,
        nodeIds: e.nodeIds,
        category: e.category,
        priority: e.priority ?? 50,
        lastUpdated: now,
      })
    }
  }

  async getIndex(): Promise<any[]> {
    return db
      .select()
      .from(memoryIndex)
      .where(eq(memoryIndex.tenantId, this.tenantId))
      .orderBy(desc(memoryIndex.priority))
  }

  // ─── Episodes ──────────────────────────────────────────────────────

  async addEpisode(input: {
    kind: string
    payload: Record<string, unknown>
  }): Promise<string> {
    const id = randomUUID()
    await db.insert(memoryEpisodes).values({
      id,
      tenantId: this.tenantId,
      kind: input.kind,
      payload: input.payload,
    })
    return id
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private deserialize(row: any): MemoryNodeRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      type: row.type,
      content: row.content,
      entities: row.entities ?? null,
      sourceType: row.sourceType,
      sourceRef: row.sourceRef,
      sourceHash: row.sourceHash,
      confidence: row.confidence,
      confidenceScore: row.confidenceScore,
      metadata: row.metadata ?? null,
      createdAt: row.createdAt ?? null,
      lastAccessedAt: row.lastAccessedAt ?? null,
      accessCount: row.accessCount ?? 0,
      validatedAt: row.validatedAt ?? null,
      supersedes: row.supersedes ?? null,
      archivedAt: row.archivedAt ?? null,
    }
  }
}
