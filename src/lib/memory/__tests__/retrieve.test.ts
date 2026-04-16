import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { MemoryStore } from '../store.js'
import { retrieve, _internal } from '../retrieve.js'
import { db } from '../../db/index.js'
import { memoryNodes, memoryEdges, entities as entitiesTable, memoryEmbeddings } from '../schema.js'

const TENANT = 'retrieve-test'

async function wipe() {
  await db.delete(memoryNodes).where(eq(memoryNodes.tenantId, TENANT))
  await db.delete(memoryEdges).where(eq(memoryEdges.tenantId, TENANT))
  await db.delete(entitiesTable).where(eq(entitiesTable.tenantId, TENANT))
  await db.delete(memoryEmbeddings).where(eq(memoryEmbeddings.tenantId, TENANT))
}

describe('retrieve — RRF math', () => {
  it('RRF_K is 60', () => {
    expect(_internal.RRF_K).toBe(60)
  })

  it('keywordScore favors docs with more query hits', () => {
    const q = new Set(['linkedin', 'voice', 'founder'])
    const a = _internal.keywordScore(q, 'LinkedIn voice guidelines for founders')
    const b = _internal.keywordScore(q, 'Totally unrelated marketing copy')
    expect(a).toBeGreaterThan(b)
  })

  it('confidenceBoost is monotonic', () => {
    expect(_internal.confidenceBoost('proven')).toBeGreaterThan(_internal.confidenceBoost('validated'))
    expect(_internal.confidenceBoost('validated')).toBeGreaterThan(_internal.confidenceBoost('hypothesis'))
  })

  it('recencyDecay is 0 for null and negative for old rows', () => {
    expect(_internal.recencyDecay(null)).toBe(0)
    const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    expect(_internal.recencyDecay(longAgo)).toBeLessThan(0)
  })

  it('accessBoost is bounded and monotonic', () => {
    expect(_internal.accessBoost(0)).toBe(0)
    expect(_internal.accessBoost(1)).toBeGreaterThan(0)
    expect(_internal.accessBoost(1000)).toBeLessThanOrEqual(0.15)
    expect(_internal.accessBoost(100)).toBeGreaterThan(_internal.accessBoost(5))
  })
})

describe('retrieve — integration (keyword-only)', () => {
  beforeEach(wipe)
  afterEach(wipe)

  it('returns relevant nodes and bumps access counters', async () => {
    const store = new MemoryStore(TENANT)
    await store.upsertNodeBySourceHash({
      type: 'document_chunk',
      content: 'LinkedIn voice for founders is blunt and specific, never pushy.',
      sourceType: 'markdown-folder',
      sourceRef: 'f:1',
      sourceHash: 'h1',
    })
    await store.upsertNodeBySourceHash({
      type: 'document_chunk',
      content: 'Recipe for tomato soup with basil and garlic.',
      sourceType: 'markdown-folder',
      sourceRef: 'f:2',
      sourceHash: 'h2',
    })
    const { node: thirdNode } = await store.upsertNodeBySourceHash({
      type: 'document_chunk',
      content:
        'Founders building GTM tools respond better to LinkedIn DMs that reference their own voice and positioning.',
      sourceType: 'markdown-folder',
      sourceRef: 'f:3',
      sourceHash: 'h3',
    })

    const results = await retrieve(store, {
      query: 'linkedin voice for founders',
      topK: 2,
      skipEntityExtraction: true,
      skipEmbeddings: true,
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(2)
    // Soup row should not be first
    expect(results[0].node.content).not.toContain('tomato')

    // Access counter was bumped on at least one returned node
    const bumped = await store.getNode(results[0].node.id)
    expect(bumped!.accessCount).toBeGreaterThanOrEqual(1)

    // Verify the third node (the one with most keyword hits) is included.
    const ids = results.map((r) => r.node.id)
    expect(ids).toContain(thirdNode.id)
  })

  it('returns empty when no candidates match the query at all', async () => {
    const store = new MemoryStore(TENANT)
    await store.upsertNodeBySourceHash({
      type: 'document_chunk',
      content: 'zzz qqq xxx',
      sourceType: 'test',
      sourceRef: 't:1',
      sourceHash: 'empty-test-hash',
    })
    const results = await retrieve(store, {
      query: 'completely unrelated topic about airplanes',
      skipEntityExtraction: true,
      skipEmbeddings: true,
    })
    // No token overlap → nonZero filter drops everything → empty.
    expect(results).toEqual([])
  })
})
