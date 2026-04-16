import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { MemoryStore } from '../store.js'
import { db } from '../../db/index.js'
import {
  memoryNodes,
  memoryEdges,
  entities as entitiesTable,
  memoryIndex,
  memoryEmbeddings,
} from '../schema.js'

/**
 * Phase 1 / B4 tests — memory store smoke + tenant isolation guard.
 * Uses a dedicated tenant slug to avoid colliding with default tenant data.
 */
const TENANT_A = 'mem-test-a'
const TENANT_B = 'mem-test-b'

async function wipeTenant(t: string) {
  await db.delete(memoryNodes).where(eq(memoryNodes.tenantId, t))
  await db.delete(memoryEdges).where(eq(memoryEdges.tenantId, t))
  await db.delete(entitiesTable).where(eq(entitiesTable.tenantId, t))
  await db.delete(memoryIndex).where(eq(memoryIndex.tenantId, t))
  await db.delete(memoryEmbeddings).where(eq(memoryEmbeddings.tenantId, t))
}

describe('MemoryStore', () => {
  beforeEach(async () => {
    await wipeTenant(TENANT_A)
    await wipeTenant(TENANT_B)
  })
  afterEach(async () => {
    await wipeTenant(TENANT_A)
    await wipeTenant(TENANT_B)
  })

  it('upsertNodeBySourceHash is idempotent on the same hash', async () => {
    const store = new MemoryStore(TENANT_A)
    const input = {
      type: 'document_chunk' as const,
      content: 'The voice for LinkedIn outbound is blunt and specific.',
      sourceType: 'markdown-folder',
      sourceRef: 'file://brand-voice.md#voice-1',
      sourceHash: 'hash-abc',
    }
    const r1 = await store.upsertNodeBySourceHash(input)
    const r2 = await store.upsertNodeBySourceHash(input)
    expect(r1.inserted).toBe(true)
    expect(r2.inserted).toBe(false)
    expect(r2.node.id).toBe(r1.node.id)
  })

  it('tenants cannot see each others nodes', async () => {
    const a = new MemoryStore(TENANT_A)
    const b = new MemoryStore(TENANT_B)
    const { node: nodeA } = await a.upsertNodeBySourceHash({
      type: 'fact',
      content: 'A secret',
      sourceType: 'interview',
      sourceRef: 'iv:1',
      sourceHash: 'ha',
    })
    expect(await b.getNode(nodeA.id)).toBeNull()
    expect(await a.getNode(nodeA.id)).not.toBeNull()
  })

  it('entity upsert resolves by alias and merges names', async () => {
    const store = new MemoryStore(TENANT_A)
    const r1 = await store.upsertEntity({
      type: 'Company',
      name: 'Acme Corp',
      aliases: ['Acme Corporation'],
    })
    const r2 = await store.upsertEntity({
      type: 'Company',
      name: 'Acme Corporation', // should match via alias
    })
    expect(r1.inserted).toBe(true)
    expect(r2.inserted).toBe(false)
    expect(r2.id).toBe(r1.id)
  })

  it('edges are scoped to tenant and filterable by relation', async () => {
    const store = new MemoryStore(TENANT_A)
    const { node } = await store.upsertNodeBySourceHash({
      type: 'learning',
      content: 'French SaaS converts better',
      sourceType: 'campaign',
      sourceRef: 'c:1',
      sourceHash: 'hlearn',
    })
    const { id: entId } = await store.upsertEntity({
      type: 'Segment',
      name: 'French SaaS',
    })
    await store.addEdge({
      fromType: 'node',
      fromId: node.id,
      toType: 'entity',
      toId: entId,
      relation: 'applies_to_segment',
    })
    const outs = await store.edgesFrom('node', node.id, ['applies_to_segment'])
    expect(outs).toHaveLength(1)
    const other = await store.edgesFrom('node', node.id, ['supports'])
    expect(other).toHaveLength(0)
  })

  it('replaceIndex writes and reads back', async () => {
    const store = new MemoryStore(TENANT_A)
    await store.replaceIndex([
      {
        name: 'Voice: LinkedIn',
        description: 'Blunt voice for LinkedIn outbound.',
        nodeIds: ['fake-1'],
        category: 'voice',
        priority: 90,
      },
      {
        name: 'ICP: Founders',
        description: 'Primary ICP is early-stage founders.',
        nodeIds: ['fake-2'],
        category: 'icp',
        priority: 80,
      },
    ])
    const idx = await store.getIndex()
    expect(idx).toHaveLength(2)
    expect(idx[0].priority).toBe(90)
  })

  it('throws on missing tenantId', () => {
    expect(() => new MemoryStore('' as string)).toThrow(/tenantId/)
  })
})
