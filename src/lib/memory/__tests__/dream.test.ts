import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { dream } from '../dream.js'
import { MemoryStore } from '../store.js'
import { db } from '../../db/index.js'
import {
  memoryNodes,
  memoryEdges,
  entities as entitiesTable,
  memoryEmbeddings,
  memoryIndex,
} from '../schema.js'

const TENANT = 'dream-test'

async function wipe() {
  await db.delete(memoryNodes).where(eq(memoryNodes.tenantId, TENANT))
  await db.delete(memoryEdges).where(eq(memoryEdges.tenantId, TENANT))
  await db.delete(entitiesTable).where(eq(entitiesTable.tenantId, TENANT))
  await db.delete(memoryEmbeddings).where(eq(memoryEmbeddings.tenantId, TENANT))
  await db.delete(memoryIndex).where(eq(memoryIndex.tenantId, TENANT))
}

describe('dream pass — offline mode', () => {
  beforeEach(wipe)
  afterEach(wipe)

  it('runs cleanly with an empty tenant', async () => {
    const report = await dream(TENANT, { offline: true })
    expect(report.tenantId).toBe(TENANT)
    expect(report.embedded).toBe(0)
    expect(report.clustered).toBe(0)
    expect(report.promoted).toBe(0)
    expect(report.archived).toBe(0)
    expect(report.contradictionsFlagged).toBe(0)
    expect(report.indexEntries).toBeNull()
  })

  it('promotes hypothesis nodes that meet the access threshold', async () => {
    const store = new MemoryStore(TENANT)
    const { node } = await store.upsertNodeBySourceHash({
      type: 'learning',
      content: 'Accessed a lot',
      sourceType: 'test',
      sourceRef: 't:1',
      sourceHash: 'h-promote',
    })
    // Touch >=3 times to cross PROMOTION_ACCESS_MIN_FOR_VALIDATED.
    await store.touchNodes([node.id])
    await store.touchNodes([node.id])
    await store.touchNodes([node.id])

    const report = await dream(TENANT, { offline: true })
    expect(report.promoted).toBeGreaterThanOrEqual(1)

    const refreshed = await store.getNode(node.id)
    expect(refreshed!.confidence).toBe('validated')
  })

  it('flags nodes linked by a contradicts edge', async () => {
    const store = new MemoryStore(TENANT)
    const { node: a } = await store.upsertNodeBySourceHash({
      type: 'claim',
      content: 'A',
      sourceType: 'test',
      sourceRef: 't:a',
      sourceHash: 'h-a',
      confidence: 'validated',
      confidenceScore: 60,
    })
    const { node: b } = await store.upsertNodeBySourceHash({
      type: 'claim',
      content: 'B',
      sourceType: 'test',
      sourceRef: 't:b',
      sourceHash: 'h-b',
      confidence: 'validated',
      confidenceScore: 60,
    })
    await store.addEdge({
      fromType: 'node',
      fromId: a.id,
      toType: 'node',
      toId: b.id,
      relation: 'contradicts',
    })

    const report = await dream(TENANT, { offline: true })
    expect(report.contradictionsFlagged).toBeGreaterThanOrEqual(2)

    const ra = await store.getNode(a.id)
    const rb = await store.getNode(b.id)
    expect(ra!.confidence).toBe('hypothesis')
    expect(rb!.confidence).toBe('hypothesis')
    expect(ra!.confidenceScore).toBeLessThan(60)
    expect(rb!.confidenceScore).toBeLessThan(60)
  })

  it('is idempotent — running twice does no additional work', async () => {
    const store = new MemoryStore(TENANT)
    await store.upsertNodeBySourceHash({
      type: 'fact',
      content: 'Static fact',
      sourceType: 'test',
      sourceRef: 't:1',
      sourceHash: 'h-static',
    })

    const first = await dream(TENANT, { offline: true })
    const second = await dream(TENANT, { offline: true })

    expect(second.embedded).toBe(0)
    expect(second.clustered).toBe(0)
    expect(second.promoted).toBe(0)
    expect(second.contradictionsFlagged).toBe(0)
    expect(second.archived).toBe(0)

    // Sanity: first run also did nothing because the node is hypothesis
    // with 0 accesses and has no contradiction or cluster peers.
    expect(first.clustered).toBe(0)
  })
})
