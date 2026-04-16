import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { MemoryStore } from '../store.js'
import { walkFrom, getCanonicalHead } from '../graph.js'
import { db } from '../../db/index.js'
import { memoryNodes, memoryEdges, entities as entitiesTable } from '../schema.js'

const TENANT = 'graph-test'

async function wipe() {
  await db.delete(memoryNodes).where(eq(memoryNodes.tenantId, TENANT))
  await db.delete(memoryEdges).where(eq(memoryEdges.tenantId, TENANT))
  await db.delete(entitiesTable).where(eq(entitiesTable.tenantId, TENANT))
}

describe('graph walker', () => {
  beforeEach(wipe)
  afterEach(wipe)

  it('BFS visits nodes reachable within depth', async () => {
    const store = new MemoryStore(TENANT)
    const { node: n1 } = await store.upsertNodeBySourceHash({
      type: 'fact',
      content: 'Node 1',
      sourceType: 'test',
      sourceRef: 't:1',
      sourceHash: 'h1',
    })
    const { node: n2 } = await store.upsertNodeBySourceHash({
      type: 'fact',
      content: 'Node 2',
      sourceType: 'test',
      sourceRef: 't:2',
      sourceHash: 'h2',
    })
    const { node: n3 } = await store.upsertNodeBySourceHash({
      type: 'fact',
      content: 'Node 3',
      sourceType: 'test',
      sourceRef: 't:3',
      sourceHash: 'h3',
    })

    // n1 -> n2 -> n3
    await store.addEdge({
      fromType: 'node',
      fromId: n1.id,
      toType: 'node',
      toId: n2.id,
      relation: 'derived_from',
    })
    await store.addEdge({
      fromType: 'node',
      fromId: n2.id,
      toType: 'node',
      toId: n3.id,
      relation: 'derived_from',
    })

    const depth1 = await walkFrom(store, [{ type: 'node', id: n1.id }], { depth: 1 })
    expect(depth1).toContain(n1.id)
    expect(depth1).toContain(n2.id)
    expect(depth1).not.toContain(n3.id)

    const depth2 = await walkFrom(store, [{ type: 'node', id: n1.id }], { depth: 2 })
    expect(depth2).toContain(n3.id)
  })

  it('relation filter narrows the walk', async () => {
    const store = new MemoryStore(TENANT)
    const { node: n1 } = await store.upsertNodeBySourceHash({
      type: 'fact',
      content: 'A',
      sourceType: 'test',
      sourceRef: 't:1',
      sourceHash: 'ha',
    })
    const { node: n2 } = await store.upsertNodeBySourceHash({
      type: 'fact',
      content: 'B',
      sourceType: 'test',
      sourceRef: 't:2',
      sourceHash: 'hb',
    })
    const { node: n3 } = await store.upsertNodeBySourceHash({
      type: 'fact',
      content: 'C',
      sourceType: 'test',
      sourceRef: 't:3',
      sourceHash: 'hc',
    })
    await store.addEdge({
      fromType: 'node', fromId: n1.id, toType: 'node', toId: n2.id, relation: 'supports',
    })
    await store.addEdge({
      fromType: 'node', fromId: n1.id, toType: 'node', toId: n3.id, relation: 'contradicts',
    })

    const supportsOnly = await walkFrom(
      store,
      [{ type: 'node', id: n1.id }],
      { depth: 1, relations: ['supports'] },
    )
    expect(supportsOnly).toContain(n2.id)
    expect(supportsOnly).not.toContain(n3.id)
  })

  it('getCanonicalHead walks supersedes chain', async () => {
    const store = new MemoryStore(TENANT)
    const { node: old } = await store.upsertNodeBySourceHash({
      type: 'fact',
      content: 'old',
      sourceType: 'test',
      sourceRef: 't:old',
      sourceHash: 'hold',
    })
    const { node: newer } = await store.upsertNodeBySourceHash({
      type: 'fact',
      content: 'newer',
      sourceType: 'test',
      sourceRef: 't:new',
      sourceHash: 'hnew',
    })
    // newer supersedes old
    await store.addEdge({
      fromType: 'node',
      fromId: newer.id,
      toType: 'node',
      toId: old.id,
      relation: 'supersedes',
    })

    const head = await getCanonicalHead(store, old.id)
    expect(head).toBe(newer.id)
  })
})
