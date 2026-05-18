import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

/**
 * Tests for the v3 per-batch child-DB review-surface helper.
 *
 * Sandboxes HOME so YAML I/O lands in a temp tree, and mocks the Notion
 * service so we never touch the real API.
 */

let TMP: string

interface MockDb {
  id: string
  parentPageId: string
  archived: boolean
  properties: Record<string, { type: string }>
}

interface MockPage {
  id: string
  databaseId?: string
  parentPageId?: string
  properties: Record<string, unknown>
}

const mockState: {
  createdDatabases: Array<{ parentPageId: string; title: string; properties: Record<string, unknown> }>
  dbStore: Map<string, MockDb>
  createdPages: MockPage[]
  pageById: Map<string, MockPage>
  pageCreateFailsAt?: number
  retrieveThrowsFor?: { databaseId: string; error: Error }
} = {
  createdDatabases: [],
  dbStore: new Map(),
  createdPages: [],
  pageById: new Map(),
}

let dbCounter = 0
let pageCounter = 0

vi.mock('../lib/services/notion', () => ({
  notionService: {
    isAvailable: () => true,
    async createDatabase(args: { parentPageId: string; title: string; properties: Record<string, unknown> }) {
      mockState.createdDatabases.push(args)
      dbCounter++
      const id = `db-${dbCounter}-${Math.random().toString(36).slice(2, 8)}`
      const properties: MockDb['properties'] = {}
      for (const [name, def] of Object.entries(args.properties)) {
        const d = def as Record<string, unknown>
        const type = Object.keys(d)[0]
        properties[name] = { type }
      }
      mockState.dbStore.set(id, {
        id,
        parentPageId: args.parentPageId,
        archived: false,
        properties,
      })
      return { id, url: `https://www.notion.so/${id.replace(/-/g, '')}` }
    },
    async createPage(databaseId: string, properties: Record<string, unknown>) {
      pageCounter++
      const id = `page-${pageCounter}`
      if (mockState.pageCreateFailsAt && mockState.createdPages.length + 1 === mockState.pageCreateFailsAt) {
        mockState.createdPages.push({ id, databaseId, properties })
        mockState.pageById.set(id, { id, databaseId, properties })
        throw new Error('Notion 429: rate limit')
      }
      const page: MockPage = { id, databaseId, properties }
      mockState.createdPages.push(page)
      mockState.pageById.set(id, page)
      return { id }
    },
    async updatePage(pageId: string, properties: Record<string, unknown>) {
      const existing = mockState.pageById.get(pageId)
      if (!existing) throw new Error(`page not found: ${pageId}`)
      existing.properties = { ...existing.properties, ...properties }
      return { id: pageId }
    },
    async retrieveDatabase(databaseId: string) {
      if (mockState.retrieveThrowsFor?.databaseId === databaseId) {
        throw mockState.retrieveThrowsFor.error
      }
      const db = mockState.dbStore.get(databaseId)
      if (!db) throw new Error(`object_not_found: ${databaseId}`)
      return db
    },
    async queryDatabase(databaseId: string, _filter?: Record<string, unknown>) {
      return mockState.createdPages.filter(p => p.databaseId === databaseId)
    },
    async search(_query: string) {
      return { results: [] }
    },
  },
  envVarSchema: {},
  NotionService: class {},
}))

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-notion-reviews-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
  mkdirSync(join(TMP, '.gtm-os'), { recursive: true })

  mockState.createdDatabases = []
  mockState.dbStore = new Map()
  mockState.createdPages = []
  mockState.pageById = new Map()
  mockState.retrieveThrowsFor = undefined
  mockState.pageCreateFailsAt = undefined
  dbCounter = 0
  pageCounter = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

// ────────────────────────────────────────────────────────────────────────────
// Defaults registry
// ────────────────────────────────────────────────────────────────────────────

describe('defaults registry', () => {
  it('ships with all five built-in output types', async () => {
    const mod = await import('../lib/services/notion-reviews')
    const types = mod.listOutputTypes()
    expect(types).toEqual(
      expect.arrayContaining([
        'qualified_lead',
        'qualified_visitor',
        'qualified_engager',
        'lead_magnet_reply',
        'content_draft',
      ]),
    )
  })

  it('every built-in default has a non-empty batchDefaults and itemDefaults', async () => {
    const mod = await import('../lib/services/notion-reviews')
    for (const t of mod.listOutputTypes()) {
      const d = mod.getOutputTypeDefaults(t)!
      expect(d.batchDefaults.length).toBeGreaterThan(0)
      expect(d.itemDefaults.length).toBeGreaterThan(0)
      expect(d.batchTitleTemplate).toMatch(/\{[^}]+\}/)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Property builders
// ────────────────────────────────────────────────────────────────────────────

describe('buildBatchDbProperties', () => {
  it('always injects the four contract properties (Title, Status, Batch ID, Items DB ID)', async () => {
    const mod = await import('../lib/services/notion-reviews')
    const props = mod.buildBatchDbProperties([{ name: 'Campaign', type: 'rich_text' }])
    expect(props.Title).toEqual({ title: {} })
    expect(props['Batch ID']).toEqual({ rich_text: {} })
    expect(props['Items DB ID']).toEqual({ rich_text: {} })
    expect((props.Status as { select: { options: { name: string }[] } }).select.options.map(o => o.name))
      .toEqual(['To Review', 'Approved', 'Rejected'])
  })

  it('user columns cannot overwrite contract properties', async () => {
    const mod = await import('../lib/services/notion-reviews')
    const props = mod.buildBatchDbProperties([{ name: 'Status', type: 'rich_text' }])
    expect((props.Status as { select?: unknown }).select).toBeDefined()
  })
})

describe('buildItemsDbProperties', () => {
  it('injects Title, Item ID, and a Status select with options Qualified/Removed', async () => {
    const mod = await import('../lib/services/notion-reviews')
    const props = mod.buildItemsDbProperties([{ name: 'Company', type: 'rich_text' }])
    expect(props.Title).toEqual({ title: {} })
    expect(props['Item ID']).toEqual({ rich_text: {} })
    const statusOpts = (props.Status as { select: { options: { name: string }[] } }).select.options.map(o => o.name)
    expect(statusOpts).toEqual(['Qualified', 'Removed'])
    // No relation property — items live inside their batch's own DB.
    expect(props.Batch).toBeUndefined()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Setup (creates ONE batches DB)
// ────────────────────────────────────────────────────────────────────────────

describe('setupReviewSurface', () => {
  it('creates exactly one Batches DB and writes notion-reviews.yaml', async () => {
    const mod = await import('../lib/services/notion-reviews')
    const result = await mod.setupReviewSurface({
      outputType: 'qualified_lead',
      parentPageId: 'parent-page-1',
    })
    expect(result.batchDbId).toBeTruthy()
    expect(mockState.createdDatabases).toHaveLength(1)
    expect(mockState.createdDatabases[0].title).toMatch(/Review/)
    expect(mockState.createdDatabases[0].parentPageId).toBe('parent-page-1')

    const yamlPath = join(TMP, '.gtm-os', 'notion-reviews.yaml')
    expect(existsSync(yamlPath)).toBe(true)
    const cfg = yaml.load(readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>
    const lead = cfg.qualified_lead as Record<string, unknown>
    expect(lead.batch_db_id).toBe(result.batchDbId)
    expect(lead.gate_mode).toBe('hard')
    expect(lead.category_name).toBe('Qualified Leads')
    expect((lead as { items_db_id?: unknown }).items_db_id).toBeUndefined()
    expect((lead as { approve_mode?: unknown }).approve_mode).toBeUndefined()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Push: creates batch page + child DB inside the page + N item rows in child DB
// ────────────────────────────────────────────────────────────────────────────

describe('pushBatchToReviewSurface', () => {
  it('creates a batch row, then a child items DB inside that row, then N items in the child DB', async () => {
    const mod = await import('../lib/services/notion-reviews')
    const setup = await mod.setupReviewSurface({
      outputType: 'qualified_lead',
      parentPageId: 'parent-page-1',
    })

    const result = await mod.pushBatchToReviewSurface(
      'qualified_lead',
      { Campaign: 'Test', 'Lead Count': 3 },
      [
        { Name: 'A', Company: 'Acme' },
        { Name: 'B', Company: 'Beta' },
        { Name: 'C', Company: 'Cygnus' },
      ],
    )

    expect(result).not.toBeNull()
    expect(result!.itemPageIds).toHaveLength(3)
    expect(result!.failed).toBe(0)

    // We created 2 databases total: 1 batches DB at setup time + 1 child items DB at push time.
    expect(mockState.createdDatabases).toHaveLength(2)
    const childDb = mockState.createdDatabases[1]
    // The child DB's parent is the batch page (NOT the original parent page).
    expect(childDb.parentPageId).toBe(result!.batchPageId)
    expect(childDb.title).toBe('Leads')

    // 4 pages total: 1 batch row + 3 item rows.
    expect(mockState.createdPages).toHaveLength(4)
    const batchPage = mockState.createdPages[0]
    expect(batchPage.databaseId).toBe(setup.batchDbId)

    // Item rows live in the per-batch child DB and default to Status="Qualified".
    const itemPages = mockState.createdPages.slice(1)
    for (const item of itemPages) {
      expect(item.databaseId).toBe(result!.itemsDbId)
      expect((item.properties.Status as { select: { name: string } }).select.name).toBe('Qualified')
    }

    // The batch row's Items DB ID property was updated to point at the child DB.
    const updatedBatch = mockState.pageById.get(result!.batchPageId)!
    const itemsDbIdProp = updatedBatch.properties['Items DB ID'] as {
      rich_text: Array<{ text: { content: string } }>
    }
    expect(itemsDbIdProp.rich_text[0].text.content).toBe(result!.itemsDbId)
  })

  it('returns null when no surface is registered', async () => {
    const mod = await import('../lib/services/notion-reviews')
    const result = await mod.pushBatchToReviewSurface('qualified_lead', { Campaign: 'X' }, [{ Name: 'A' }])
    expect(result).toBeNull()
    expect(mockState.createdPages).toHaveLength(0)
    expect(mockState.createdDatabases).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Gate
// ────────────────────────────────────────────────────────────────────────────

describe('applyReviewGate', () => {
  it('returns no-surface when nothing is registered', async () => {
    const mod = await import('../lib/services/notion-reviews')
    const result = await mod.applyReviewGate('qualified_lead', {}, [{ Name: 'A' }])
    expect(result.action).toBe('no-surface')
  })

  it('returns pushed-halt when gate is hard, with itemsDbId surfaced', async () => {
    const mod = await import('../lib/services/notion-reviews')
    await mod.setupReviewSurface({ outputType: 'qualified_lead', parentPageId: 'p' })

    const result = await mod.applyReviewGate(
      'qualified_lead',
      { Campaign: 'T', 'Lead Count': 2 },
      [{ Name: 'A' }, { Name: 'B' }],
    )
    expect(result.action).toBe('pushed-halt')
    if (result.action === 'pushed-halt') {
      expect(result.itemsPushed).toBe(2)
      expect(result.failed).toBe(0)
      expect(result.batchPageId).toBeTruthy()
      expect(result.itemsDbId).toBeTruthy()
      expect(result.url).toContain('notion.so')
    }
  })

  it('returns pushed-continue when gate is autonomous', async () => {
    const mod = await import('../lib/services/notion-reviews')
    await mod.setupReviewSurface({ outputType: 'qualified_lead', parentPageId: 'p' })
    await mod.setGateMode('qualified_lead', 'autonomous')

    const result = await mod.applyReviewGate('qualified_lead', { Campaign: 'T' }, [{ Name: 'A' }])
    expect(result.action).toBe('pushed-continue')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// verifyReviewSurface
// ────────────────────────────────────────────────────────────────────────────

describe('verifyReviewSurface', () => {
  it('returns ok=true when contract is intact', async () => {
    const mod = await import('../lib/services/notion-reviews')
    await mod.setupReviewSurface({ outputType: 'qualified_lead', parentPageId: 'p' })
    const result = await mod.verifyReviewSurface('qualified_lead')
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('flags a missing contract property on the Batches DB', async () => {
    const mod = await import('../lib/services/notion-reviews')
    const setup = await mod.setupReviewSurface({ outputType: 'qualified_lead', parentPageId: 'p' })
    const batchDb = mockState.dbStore.get(setup.batchDbId)!
    delete batchDb.properties['Items DB ID']
    const result = await mod.verifyReviewSurface('qualified_lead')
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.includes('Items DB ID'))).toBe(true)
  })

  it('reports user-added columns on the Batches DB as extras (not errors)', async () => {
    const mod = await import('../lib/services/notion-reviews')
    const setup = await mod.setupReviewSurface({ outputType: 'qualified_lead', parentPageId: 'p' })
    const batchDb = mockState.dbStore.get(setup.batchDbId)!
    batchDb.properties['Owner'] = { type: 'rich_text' }
    const result = await mod.verifyReviewSurface('qualified_lead')
    expect(result.ok).toBe(true)
    expect(result.extras.some(x => x.db === 'batches' && x.name === 'Owner')).toBe(true)
  })

  it('reports an error when the Batches DB no longer exists', async () => {
    const mod = await import('../lib/services/notion-reviews')
    const setup = await mod.setupReviewSurface({ outputType: 'qualified_lead', parentPageId: 'p' })
    mockState.retrieveThrowsFor = {
      databaseId: setup.batchDbId,
      error: new Error('object_not_found'),
    }
    const result = await mod.verifyReviewSurface('qualified_lead')
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /no longer exists/.test(e))).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// getApprovedBatches
// ────────────────────────────────────────────────────────────────────────────

describe('getApprovedBatches', () => {
  it('returns empty when no surface is registered', async () => {
    const mod = await import('../lib/services/notion-reviews')
    const result = await mod.getApprovedBatches('qualified_lead')
    expect(result).toEqual([])
  })

  it('returns approved batches and walks into their per-batch items DBs', async () => {
    const mod = await import('../lib/services/notion-reviews')
    await mod.setupReviewSurface({ outputType: 'qualified_lead', parentPageId: 'p' })

    const push = await mod.pushBatchToReviewSurface(
      'qualified_lead',
      { Campaign: 'T', 'Lead Count': 3 },
      [{ Name: 'A' }, { Name: 'B' }, { Name: 'C' }],
    )

    // Approve the batch (flip its Status to "Approved" in the mock store).
    const batchPage = mockState.pageById.get(push!.batchPageId)!
    batchPage.properties.Status = { select: { name: 'Approved' } }
    // Kill-list one item (default is Qualified; flip one to Removed).
    const firstItemId = push!.itemPageIds[0]
    const firstItem = mockState.pageById.get(firstItemId)!
    firstItem.properties.Status = { select: { name: 'Removed' } }

    // Stub property-extraction helpers (queryDatabase returns the mock pages directly).
    // The implementation reads `.properties.<name>.rich_text[*].plain_text` — patch our stored shape.
    batchPage.properties['Batch ID'] = {
      rich_text: [{ plain_text: push!.batchId }],
    }
    batchPage.properties['Items DB ID'] = {
      rich_text: [{ plain_text: push!.itemsDbId }],
    }

    const approved = await mod.getApprovedBatches('qualified_lead')
    expect(approved).toHaveLength(1)
    expect(approved[0].itemsDbId).toBe(push!.itemsDbId)
    // 3 items total minus 1 removed = 2 items returned.
    expect(approved[0].items).toHaveLength(2)
    for (const item of approved[0].items) {
      expect(item.status).not.toBe('Removed')
    }
  })
})
