/**
 * Notion review-surface layer (v3 — per-batch child databases).
 *
 * Human-in-the-loop verification of YALC outputs. Each output type gets ONE
 * Notion Batches database (the kanban). Each batch card's page contains its
 * OWN inline child database, scoped to that batch's items. There is NO
 * global Items DB — opening a batch card shows exactly its items in place.
 *
 * Config lives at `~/.gtm-os/notion-reviews.yaml`:
 *
 *   qualified_lead:
 *     parent_page_id: <page-id>
 *     category_name: "Qualified Leads"
 *     gate_mode: hard
 *     batch_db_id: <db-id>
 *     batch_columns: [{name, type}, ...]   # user-configurable
 *     item_columns:  [{name, type}, ...]   # template applied to each new per-batch child DB
 *
 * Load-bearing contract:
 *   Batches DB: Title (title), Status (select: To Review|Approved|Rejected),
 *               Batch ID (rich_text), Items DB ID (rich_text)
 *   Per-batch items DB (created at push time): Title (title),
 *               Item ID (rich_text), Status (select: To Review|Approved|Rejected)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import yaml from 'js-yaml'

import { notionService } from './notion'

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type GateMode = 'hard' | 'autonomous'
/** Batch-level statuses — the kanban lanes. */
export type BatchStatus = 'To Review' | 'Approved' | 'Rejected'
export const BATCH_STATUSES: readonly BatchStatus[] = ['To Review', 'Approved', 'Rejected']
/** Item-level statuses — every new item is Qualified by default; user marks bad ones as Removed (kill list). */
export type ItemStatus = 'Qualified' | 'Removed'
export const ITEM_STATUSES: readonly ItemStatus[] = ['Qualified', 'Removed']

export type PropertyType = 'title' | 'rich_text' | 'url' | 'date' | 'select' | 'number'

export interface ColumnDef {
  name: string
  type: PropertyType
  options?: readonly string[]
}

export interface ReviewSurface {
  parent_page_id: string
  category_name: string
  gate_mode: GateMode
  batch_db_id: string
  /** Card-level metadata columns on the Batches DB. */
  batch_columns: ColumnDef[]
  /** Column template applied to each per-batch child items DB at push time. */
  item_columns: ColumnDef[]
}

export interface OutputTypeDefaults {
  outputType: string
  displayName: string
  batchDefaults: ColumnDef[]
  itemDefaults: ColumnDef[]
  /** `{Column Name}` tokens; replaced from batchMeta at push time. */
  batchTitleTemplate: string
}

// ────────────────────────────────────────────────────────────────────────────
// Built-in output type defaults
// ────────────────────────────────────────────────────────────────────────────

const BUILTIN_DEFAULTS: OutputTypeDefaults[] = [
  {
    outputType: 'qualified_lead',
    displayName: 'Qualified Leads',
    batchTitleTemplate: '{Campaign} — {Lead Count} leads',
    batchDefaults: [
      { name: 'Campaign', type: 'rich_text' },
      { name: 'Lead Count', type: 'number' },
      { name: 'Created Date', type: 'date' },
      { name: 'ICP Segment', type: 'rich_text' },
    ],
    itemDefaults: [
      { name: 'Company', type: 'rich_text' },
      { name: 'Title', type: 'rich_text' },
      { name: 'LinkedIn URL', type: 'url' },
      { name: 'Qualification Score', type: 'number' },
      { name: 'Reasoning', type: 'rich_text' },
    ],
  },
  {
    outputType: 'qualified_visitor',
    displayName: 'Qualified Visitors',
    batchTitleTemplate: '{Source} — {Visit Count} visitors',
    batchDefaults: [
      { name: 'Source', type: 'rich_text' },
      { name: 'Visit Count', type: 'number' },
      { name: 'Created Date', type: 'date' },
    ],
    itemDefaults: [
      { name: 'Company', type: 'rich_text' },
      { name: 'Title', type: 'rich_text' },
      { name: 'Source URL', type: 'url' },
      { name: 'Visit Date', type: 'date' },
      { name: 'Qualification Score', type: 'number' },
      { name: 'Reasoning', type: 'rich_text' },
    ],
  },
  {
    outputType: 'qualified_engager',
    displayName: 'Qualified Engagers',
    batchTitleTemplate: '{Post Topic} — {Engager Count} engagers',
    batchDefaults: [
      { name: 'Post Topic', type: 'rich_text' },
      { name: 'Post URL', type: 'url' },
      { name: 'Engager Count', type: 'number' },
      { name: 'Created Date', type: 'date' },
    ],
    itemDefaults: [
      { name: 'Company', type: 'rich_text' },
      {
        name: 'Engagement Type',
        type: 'select',
        options: ['like', 'comment', 'share', 'reaction'],
      },
      { name: 'Engagement Date', type: 'date' },
      { name: 'ICP Match Score', type: 'number' },
      { name: 'Reasoning', type: 'rich_text' },
    ],
  },
  {
    outputType: 'lead_magnet_reply',
    displayName: 'Lead Magnet Replies',
    batchTitleTemplate: '{Magnet Topic} — {Reply Count} replies',
    batchDefaults: [
      { name: 'Magnet Topic', type: 'rich_text' },
      { name: 'Reply Count', type: 'number' },
      { name: 'Created Date', type: 'date' },
    ],
    itemDefaults: [
      { name: 'Company', type: 'rich_text' },
      { name: 'Reply Text', type: 'rich_text' },
      { name: 'Reply Date', type: 'date' },
    ],
  },
  {
    outputType: 'content_draft',
    displayName: 'Content Drafts',
    batchTitleTemplate: '{Theme} — {Draft Count} drafts',
    batchDefaults: [
      { name: 'Theme', type: 'rich_text' },
      { name: 'Draft Count', type: 'number' },
      { name: 'Created Date', type: 'date' },
    ],
    itemDefaults: [
      {
        name: 'Channel',
        type: 'select',
        options: ['linkedin', 'email', 'blog', 'twitter', 'other'],
      },
      { name: 'Hook', type: 'rich_text' },
      { name: 'Body Excerpt', type: 'rich_text' },
    ],
  },
]

const defaultsRegistry = new Map<string, OutputTypeDefaults>()
for (const d of BUILTIN_DEFAULTS) defaultsRegistry.set(d.outputType, d)

export function getOutputTypeDefaults(outputType: string): OutputTypeDefaults | undefined {
  return defaultsRegistry.get(outputType)
}

export function listOutputTypes(): string[] {
  return Array.from(defaultsRegistry.keys())
}

export function registerOutputTypeDefaults(defaults: OutputTypeDefaults): void {
  if (!defaults.outputType) throw new Error('OutputTypeDefaults requires outputType')
  defaultsRegistry.set(defaults.outputType, defaults)
}

// ────────────────────────────────────────────────────────────────────────────
// Load-bearing contract properties
// ────────────────────────────────────────────────────────────────────────────

export const BATCH_CONTRACT_PROPS = {
  TITLE: 'Title',
  STATUS: 'Status',
  BATCH_ID: 'Batch ID',
  ITEMS_DB_ID: 'Items DB ID',
} as const

export const ITEM_CONTRACT_PROPS = {
  TITLE: 'Title',
  ITEM_ID: 'Item ID',
  STATUS: 'Status',
} as const

// ────────────────────────────────────────────────────────────────────────────
// YAML config I/O
// ────────────────────────────────────────────────────────────────────────────

function configPath(): string {
  return join(homedir(), '.gtm-os', 'notion-reviews.yaml')
}

function readConfig(): Record<string, ReviewSurface> {
  const p = configPath()
  if (!existsSync(p)) return {}
  const raw = readFileSync(p, 'utf-8')
  const parsed = yaml.load(raw)
  if (!parsed || typeof parsed !== 'object') return {}
  return parsed as Record<string, ReviewSurface>
}

function writeConfig(cfg: Record<string, ReviewSurface>): void {
  const p = configPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, yaml.dump(cfg, { lineWidth: -1, sortKeys: true }))
}

export async function getReviewSurface(outputType: string): Promise<ReviewSurface | null> {
  return readConfig()[outputType] ?? null
}

export async function setReviewSurface(outputType: string, surface: ReviewSurface): Promise<void> {
  const cfg = readConfig()
  cfg[outputType] = surface
  writeConfig(cfg)
}

export async function listReviewSurfaces(): Promise<Record<string, ReviewSurface>> {
  return readConfig()
}

export async function getGateMode(outputType: string): Promise<GateMode | null> {
  return (await getReviewSurface(outputType))?.gate_mode ?? null
}

export async function setGateMode(outputType: string, mode: GateMode): Promise<void> {
  const cfg = readConfig()
  const existing = cfg[outputType]
  if (!existing) {
    throw new Error(`No review surface registered for "${outputType}". Run review:setup first.`)
  }
  existing.gate_mode = mode
  writeConfig(cfg)
}

// ────────────────────────────────────────────────────────────────────────────
// Notion property builders
// ────────────────────────────────────────────────────────────────────────────

function buildPropertyDef(col: ColumnDef): Record<string, unknown> {
  switch (col.type) {
    case 'title': return { title: {} }
    case 'rich_text': return { rich_text: {} }
    case 'url': return { url: {} }
    case 'date': return { date: {} }
    case 'number': return { number: { format: 'number' } }
    case 'select':
      return { select: { options: (col.options ?? []).map(o => ({ name: o })) } }
  }
}

/** Schema for the Batches DB. Contract props always present. */
export function buildBatchDbProperties(batchColumns: ColumnDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    [BATCH_CONTRACT_PROPS.TITLE]: { title: {} },
    [BATCH_CONTRACT_PROPS.STATUS]: {
      select: { options: BATCH_STATUSES.map(s => ({ name: s })) },
    },
    [BATCH_CONTRACT_PROPS.BATCH_ID]: { rich_text: {} },
    [BATCH_CONTRACT_PROPS.ITEMS_DB_ID]: { rich_text: {} },
  }
  for (const col of batchColumns) {
    if (col.name in out) continue
    out[col.name] = buildPropertyDef(col)
  }
  return out
}

/** Schema for a per-batch items DB. Status options are Qualified (default) and Removed. */
export function buildItemsDbProperties(itemColumns: ColumnDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    [ITEM_CONTRACT_PROPS.TITLE]: { title: {} },
    [ITEM_CONTRACT_PROPS.ITEM_ID]: { rich_text: {} },
    [ITEM_CONTRACT_PROPS.STATUS]: {
      select: { options: ITEM_STATUSES.map(s => ({ name: s })) },
    },
  }
  for (const col of itemColumns) {
    if (col.name in out) continue
    out[col.name] = buildPropertyDef(col)
  }
  return out
}

function setCell(
  out: Record<string, unknown>,
  name: string,
  type: PropertyType,
  value: unknown,
): void {
  if (value === undefined || value === null || value === '') return
  switch (type) {
    case 'title':
      out[name] = { title: [{ text: { content: String(value).slice(0, 2000) } }] }
      break
    case 'rich_text':
      out[name] = { rich_text: [{ text: { content: String(value).slice(0, 2000) } }] }
      break
    case 'url':
      out[name] = { url: String(value) }
      break
    case 'date':
      out[name] = { date: { start: String(value) } }
      break
    case 'number':
      out[name] = { number: Number(value) }
      break
    case 'select':
      out[name] = { select: { name: String(value) } }
      break
  }
}

function renderBatchTitle(template: string, meta: Record<string, unknown>): string {
  return template
    .replace(/\{([^}]+)\}/g, (_m, key) => {
      const v = meta[key.trim()]
      return v === undefined || v === null ? '' : String(v)
    })
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildBatchPageProperties(
  surface: ReviewSurface,
  batchMeta: Record<string, unknown>,
  batchId: string,
  itemsDbId: string,
  template: string,
  status: BatchStatus = 'To Review',
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const title = renderBatchTitle(template, batchMeta) || `Batch ${batchId.slice(0, 8)}`
  setCell(out, BATCH_CONTRACT_PROPS.TITLE, 'title', title)
  setCell(out, BATCH_CONTRACT_PROPS.STATUS, 'select', status)
  setCell(out, BATCH_CONTRACT_PROPS.BATCH_ID, 'rich_text', batchId)
  setCell(out, BATCH_CONTRACT_PROPS.ITEMS_DB_ID, 'rich_text', itemsDbId)
  for (const col of surface.batch_columns) {
    if (col.name in out) continue
    setCell(out, col.name, col.type, batchMeta[col.name])
  }
  return out
}

export function buildItemPageProperties(
  surface: ReviewSurface,
  item: Record<string, unknown>,
  itemId: string,
  itemTitleField: string,
  status: ItemStatus = 'Qualified',
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const title = item[itemTitleField] ?? item.Title ?? item.Name ?? `Item ${itemId.slice(0, 8)}`
  setCell(out, ITEM_CONTRACT_PROPS.TITLE, 'title', title)
  setCell(out, ITEM_CONTRACT_PROPS.ITEM_ID, 'rich_text', itemId)
  setCell(out, ITEM_CONTRACT_PROPS.STATUS, 'select', status)
  for (const col of surface.item_columns) {
    if (col.name in out) continue
    setCell(out, col.name, col.type, item[col.name])
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// Setup
// ────────────────────────────────────────────────────────────────────────────

export interface SetupArgs {
  outputType: string
  parentPageId: string
  categoryName?: string
  batchColumns?: ColumnDef[]
  itemColumns?: ColumnDef[]
  gateMode?: GateMode
}

export interface SetupResult {
  batchDbId: string
  batchUrl: string
}

/**
 * Create ONE Batches DB and register it. Per-batch items DBs are created
 * lazily inside each batch page at push time.
 */
export async function setupReviewSurface(args: SetupArgs): Promise<SetupResult> {
  const defaults = getOutputTypeDefaults(args.outputType)
  if (!defaults) {
    throw new Error(`Unknown output type: ${args.outputType}. Known: ${listOutputTypes().join(', ')}`)
  }
  const categoryName = args.categoryName ?? defaults.displayName
  const batchColumns = args.batchColumns ?? defaults.batchDefaults
  const itemColumns = args.itemColumns ?? defaults.itemDefaults

  const batchesDb = await notionService.createDatabase({
    parentPageId: args.parentPageId,
    title: `${categoryName} — Review`,
    properties: buildBatchDbProperties(batchColumns),
  })

  const surface: ReviewSurface = {
    parent_page_id: args.parentPageId,
    category_name: categoryName,
    gate_mode: args.gateMode ?? 'hard',
    batch_db_id: batchesDb.id,
    batch_columns: batchColumns as ColumnDef[],
    item_columns: itemColumns as ColumnDef[],
  }
  await setReviewSurface(args.outputType, surface)

  return { batchDbId: batchesDb.id, batchUrl: batchesDb.url }
}

// ────────────────────────────────────────────────────────────────────────────
// Push: create one batch page with an inline per-batch items DB
// ────────────────────────────────────────────────────────────────────────────

export interface PushBatchResult {
  batchPageId: string
  batchId: string
  itemsDbId: string
  itemPageIds: string[]
  failed: number
}

/**
 * For each batch we:
 *   1. Create the batch row in the Batches DB (placeholder Items DB ID).
 *   2. Create a brand-new child DB under that batch page — this becomes the
 *      inline items table shown inside the card.
 *   3. Update the batch row to store the new items DB ID.
 *   4. Push each item as a row in the new child DB.
 */
export async function pushBatchToReviewSurface(
  outputType: string,
  batchMeta: Record<string, unknown>,
  items: Record<string, unknown>[],
): Promise<PushBatchResult | null> {
  const surface = await getReviewSurface(outputType)
  if (!surface) return null
  const defaults = getOutputTypeDefaults(outputType)
  if (!defaults) throw new Error(`No defaults registered for "${outputType}"`)

  const batchId = String(batchMeta['Batch ID'] ?? batchMeta.batchId ?? randomUUID())

  // Step 1: batch row with placeholder Items DB ID
  const batchPropsInitial = buildBatchPageProperties(
    surface,
    batchMeta,
    batchId,
    '', // Items DB ID — filled in step 3
    defaults.batchTitleTemplate,
    'To Review',
  )
  const batchPage = await notionService.createPage(surface.batch_db_id, batchPropsInitial)
  const batchPageId = (batchPage as { id: string }).id

  // Step 2: per-batch child items DB, INLINE inside the batch page so it renders
  // directly in the page body instead of as a sub-page that needs an extra click.
  const itemsDb = await notionService.createDatabase({
    parentPageId: batchPageId,
    title: 'Leads',
    properties: buildItemsDbProperties(surface.item_columns),
    isInline: true,
  })
  const itemsDbId = itemsDb.id

  // Step 3: stamp the items DB ID onto the batch row
  await notionService.updatePage(batchPageId, {
    [BATCH_CONTRACT_PROPS.ITEMS_DB_ID]: {
      rich_text: [{ text: { content: itemsDbId } }],
    },
  })

  // Step 4: push each item into the per-batch DB
  const itemPageIds: string[] = []
  let failed = 0
  const itemTitleField = String(batchMeta.itemTitleField ?? 'Name')

  for (const item of items) {
    const itemId = String(item['Item ID'] ?? item.itemId ?? randomUUID())
    const props = buildItemPageProperties(surface, item, itemId, itemTitleField, 'Qualified')
    try {
      const page = await notionService.createPage(itemsDbId, props)
      itemPageIds.push((page as { id: string }).id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/rate.?limit|429/i.test(msg)) {
        await new Promise(r => setTimeout(r, 2000))
        try {
          const page = await notionService.createPage(itemsDbId, props)
          itemPageIds.push((page as { id: string }).id)
          continue
        } catch {
          failed++
          continue
        }
      }
      failed++
    }
  }

  return { batchPageId, batchId, itemsDbId, itemPageIds, failed }
}

// ────────────────────────────────────────────────────────────────────────────
// Read approved
// ────────────────────────────────────────────────────────────────────────────

export interface ApprovedBatch {
  batchPageId: string
  batchId: string
  itemsDbId: string
  items: Array<{ itemPageId: string; itemId: string; status: ItemStatus }>
}

export async function getApprovedBatches(
  outputType: string,
  sinceTimestamp?: string,
): Promise<ApprovedBatch[]> {
  const surface = await getReviewSurface(outputType)
  if (!surface) return []

  const batchFilter: Record<string, unknown> = sinceTimestamp
    ? {
        and: [
          { property: BATCH_CONTRACT_PROPS.STATUS, select: { equals: 'Approved' } },
          { timestamp: 'last_edited_time', last_edited_time: { on_or_after: sinceTimestamp } },
        ],
      }
    : { property: BATCH_CONTRACT_PROPS.STATUS, select: { equals: 'Approved' } }

  const batchRows = (await notionService.queryDatabase(
    surface.batch_db_id,
    batchFilter,
  )) as Array<Record<string, unknown>>

  const out: ApprovedBatch[] = []
  for (const batchRow of batchRows) {
    const batchPageId = String((batchRow as { id: string }).id)
    const batchId = extractRichText(batchRow, BATCH_CONTRACT_PROPS.BATCH_ID)
    const itemsDbId = extractRichText(batchRow, BATCH_CONTRACT_PROPS.ITEMS_DB_ID)
    if (!batchId || !itemsDbId) continue

    const itemRows = (await notionService.queryDatabase(itemsDbId)) as Array<
      Record<string, unknown>
    >
    const items: ApprovedBatch['items'] = []
    for (const itemRow of itemRows) {
      const itemPageId = String((itemRow as { id: string }).id)
      const itemId = extractRichText(itemRow, ITEM_CONTRACT_PROPS.ITEM_ID)
      const status = (extractSelect(itemRow, ITEM_CONTRACT_PROPS.STATUS) as ItemStatus | null) ?? 'Qualified'
      // Default-Qualified, kill-list model: only "Removed" items are filtered out.
      if (status === 'Removed') continue
      items.push({ itemPageId, itemId: itemId ?? '', status })
    }
    out.push({ batchPageId, batchId, itemsDbId, items })
  }
  return out
}

function extractRichText(page: Record<string, unknown>, propName: string): string | null {
  const props = (page as { properties?: Record<string, unknown> }).properties
  const prop = props?.[propName] as { rich_text?: Array<{ plain_text?: string }> } | undefined
  if (!prop?.rich_text || !prop.rich_text.length) return null
  return prop.rich_text.map(r => r.plain_text ?? '').join('')
}

function extractSelect(page: Record<string, unknown>, propName: string): string | null {
  const props = (page as { properties?: Record<string, unknown> }).properties
  const prop = props?.[propName] as { select?: { name?: string } | null } | undefined
  return prop?.select?.name ?? null
}

// ────────────────────────────────────────────────────────────────────────────
// Gate
// ────────────────────────────────────────────────────────────────────────────

export type GateAction =
  | { action: 'no-surface' }
  | {
      action: 'pushed-halt'
      batchPageId: string
      itemsDbId: string
      itemsPushed: number
      failed: number
      url: string
    }
  | {
      action: 'pushed-continue'
      batchPageId: string
      itemsDbId: string
      itemsPushed: number
      failed: number
      url: string
    }

export async function applyReviewGate(
  outputType: string,
  batchMeta: Record<string, unknown>,
  items: Record<string, unknown>[],
): Promise<GateAction> {
  const surface = await getReviewSurface(outputType)
  if (!surface) return { action: 'no-surface' }

  const result = await pushBatchToReviewSurface(outputType, batchMeta, items)
  if (!result) return { action: 'no-surface' }

  const url = `https://www.notion.so/${surface.batch_db_id.replace(/-/g, '')}`
  return surface.gate_mode === 'hard'
    ? {
        action: 'pushed-halt',
        batchPageId: result.batchPageId,
        itemsDbId: result.itemsDbId,
        itemsPushed: result.itemPageIds.length,
        failed: result.failed,
        url,
      }
    : {
        action: 'pushed-continue',
        batchPageId: result.batchPageId,
        itemsDbId: result.itemsDbId,
        itemsPushed: result.itemPageIds.length,
        failed: result.failed,
        url,
      }
}

// ────────────────────────────────────────────────────────────────────────────
// Verify
// ────────────────────────────────────────────────────────────────────────────

export interface VerifyResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  extras: { db: 'batches'; name: string }[]
  surface: ReviewSurface | null
}

/**
 * Inspect the Batches DB and confirm the four load-bearing properties
 * are present. Per-batch items DBs are created lazily and not pre-verified.
 */
export async function verifyReviewSurface(outputType: string): Promise<VerifyResult> {
  const surface = await getReviewSurface(outputType)
  if (!surface) {
    return {
      ok: false,
      errors: [`No review surface registered for "${outputType}". Run review:setup.`],
      warnings: [],
      extras: [],
      surface: null,
    }
  }

  const errors: string[] = []
  const warnings: string[] = []
  const extras: VerifyResult['extras'] = []

  let db: Record<string, unknown>
  try {
    db = (await notionService.retrieveDatabase(surface.batch_db_id)) as Record<string, unknown>
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/object_not_found|not.?found/i.test(msg)) {
      errors.push('Batches DB no longer exists in Notion. Run review:setup to recreate.')
    } else {
      errors.push(`Batches DB retrieve failed: ${msg}`)
    }
    return { ok: false, errors, warnings, extras, surface }
  }
  if ((db as { archived?: boolean }).archived) {
    errors.push('Batches DB is archived in Notion. Run review:setup to recreate.')
    return { ok: false, errors, warnings, extras, surface }
  }

  const props = (db as { properties?: Record<string, { type?: string }> }).properties ?? {}
  const required = [
    { name: BATCH_CONTRACT_PROPS.TITLE, type: 'title' },
    { name: BATCH_CONTRACT_PROPS.STATUS, type: 'select' },
    { name: BATCH_CONTRACT_PROPS.BATCH_ID, type: 'rich_text' },
    { name: BATCH_CONTRACT_PROPS.ITEMS_DB_ID, type: 'rich_text' },
  ]
  for (const r of required) {
    const found = props[r.name]
    if (!found) {
      errors.push(`Batches DB is missing load-bearing property "${r.name}".`)
      continue
    }
    if (found.type !== r.type) {
      errors.push(`Batches DB property "${r.name}" must be of type ${r.type} (found ${found.type}).`)
    }
  }

  const knownCols = new Set<string>(surface.batch_columns.map(c => c.name))
  const contractNames = new Set<string>(Object.values(BATCH_CONTRACT_PROPS))
  for (const name of Object.keys(props)) {
    if (contractNames.has(name)) continue
    if (knownCols.has(name)) continue
    extras.push({ db: 'batches', name })
  }

  return { ok: errors.length === 0, errors, warnings, extras, surface }
}
