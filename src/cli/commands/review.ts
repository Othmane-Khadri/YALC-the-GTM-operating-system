/**
 * `review:*` CLI commands — Notion verification surface (v2: batches + items).
 *
 *   review:setup       — create a paired Batches+Items DB for an output type.
 *   review:reconfigure — change category name, columns, modes; keeps existing DBs.
 *   review:gate        — flip gate mode (hard | autonomous).
 *   review:status      — list registered surfaces.
 *   review:doctor      — verify load-bearing properties; report user-added columns.
 *
 * Notion REST API only creates the default Table view. Kanban + Gallery views
 * on the batches DB are added via the Notion MCP, which the conversational
 * `notion-review` skill calls separately. If `review:setup` is run via CLI
 * directly, the user is prompted to either re-run via the skill or add the
 * views manually in Notion.
 */

import { input, select, confirm } from '@inquirer/prompts'

import {
  getOutputTypeDefaults,
  getReviewSurface,
  listOutputTypes,
  listReviewSurfaces,
  setGateMode,
  setReviewSurface,
  setupReviewSurface,
  verifyReviewSurface,
  type ColumnDef,
  type GateMode,
} from '../../lib/services/notion-reviews'
import { notionService } from '../../lib/services/notion'

interface SetupOpts {
  outputType?: string
  parentPageId?: string
  parentPage?: string
  categoryName?: string
  mode?: GateMode
  rebuild?: boolean
}

interface ReconfigureOpts {
  outputType?: string
  categoryName?: string
  mode?: GateMode
}

interface GateOpts {
  outputType?: string
  mode?: GateMode
}

interface DoctorOpts {
  outputType?: string
}

const KNOWN_TYPES = listOutputTypes()

function ensureNotionApiKey(): void {
  if (!notionService.isAvailable()) {
    console.error('NOTION_API_KEY is not set. Add it to ~/.gtm-os/.env (or .env.local) and retry.')
    process.exit(1)
  }
}

function extractPageIdFromUrl(urlOrId: string): string {
  const trimmed = urlOrId.trim()
  const match = trimmed.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i)
  if (!match) {
    throw new Error(`Could not extract a Notion page ID from "${urlOrId}". Paste the page URL or its ID.`)
  }
  const raw = match[1].replace(/-/g, '')
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`
}

async function resolveParentPageId(opts: { parentPageId?: string; parentPage?: string }): Promise<string> {
  if (opts.parentPageId) return extractPageIdFromUrl(opts.parentPageId)
  if (opts.parentPage) {
    const matches = await notionService.search(opts.parentPage, { property: 'object', value: 'page' })
    const results = (matches as { results?: Array<{ id: string }> }).results ?? []
    if (results.length === 0) {
      throw new Error(`No Notion page found matching "${opts.parentPage}".`)
    }
    if (results.length > 1) {
      console.warn(`Multiple pages matched "${opts.parentPage}" — using the first.`)
    }
    return results[0].id
  }
  const answer = await input({
    message: 'Parent Notion page (URL or title to search)',
    validate: v => v.trim().length > 0 || 'required',
  })
  if (/^https?:\/\//i.test(answer) || /[a-f0-9]{32}/i.test(answer)) {
    return extractPageIdFromUrl(answer)
  }
  return await resolveParentPageId({ parentPage: answer })
}

async function chooseOutputType(provided?: string): Promise<string> {
  if (provided) {
    if (!getOutputTypeDefaults(provided)) {
      console.error(`Unknown output type "${provided}". Known: ${KNOWN_TYPES.join(', ')}`)
      process.exit(1)
    }
    return provided
  }
  return await select({
    message: 'Output type to register',
    choices: KNOWN_TYPES.map(t => ({ name: t, value: t })),
  })
}

function printColumns(label: string, cols: ColumnDef[]): void {
  console.log(`  ${label}:`)
  for (const c of cols) {
    const opts = c.options ? ` (${c.options.join(' | ')})` : ''
    console.log(`    - ${c.name} :: ${c.type}${opts}`)
  }
}

function printPostSetupReminder(): void {
  console.log('')
  console.log('Only the default Table view was created. The Notion REST API cannot create Kanban')
  console.log('or Gallery views — those are added via the Notion MCP, which is only available when')
  console.log('this is run through the `notion-review` skill.')
  console.log('')
  console.log('If you ran this CLI directly, either:')
  console.log('  • Re-run via the `notion-review` skill — Claude will add the views for you, or')
  console.log('  • Open the Batches DB in Notion and add a Kanban view (grouped by Status) and a Gallery view.')
}

// ───────────────────────────── review:setup ─────────────────────────────────

export async function runReviewSetup(opts: SetupOpts): Promise<{ exitCode: number }> {
  ensureNotionApiKey()
  const outputType = await chooseOutputType(opts.outputType)
  const defaults = getOutputTypeDefaults(outputType)!

  const existing = await getReviewSurface(outputType)
  if (existing && !opts.rebuild) {
    console.log(`Review surface for "${outputType}" already registered.`)
    console.log(`  Batches DB: ${existing.batch_db_id}`)
    console.log(`  Gate mode:  ${existing.gate_mode}`)
    const rebuild = await confirm({
      message: 'Rebuild (create a new Batches DB) or keep existing?',
      default: false,
    })
    if (!rebuild) {
      console.log('Keeping existing surface. Use `review:reconfigure` to change columns or modes.')
      return { exitCode: 0 }
    }
  }

  const parentPageId = await resolveParentPageId(opts)
  const categoryName = opts.categoryName ?? defaults.displayName
  const gateMode = opts.mode ?? 'hard'

  console.log('')
  console.log(`Setting up review surface for "${outputType}":`)
  console.log(`  Parent page:  ${parentPageId}`)
  console.log(`  Category:     ${categoryName}`)
  console.log(`  Gate mode:    ${gateMode}`)
  printColumns('Batch card columns', defaults.batchDefaults as ColumnDef[])
  printColumns('Item columns (template applied to each per-batch inline table)', defaults.itemDefaults as ColumnDef[])
  console.log('')
  console.log('Item statuses: Qualified (default for every new row) / Removed (kill list).')
  console.log('')

  const result = await setupReviewSurface({
    outputType,
    parentPageId,
    categoryName,
    gateMode,
  })

  console.log(`✓ Created Batches DB: ${result.batchUrl}`)
  console.log('')
  console.log(`Registered in ~/.gtm-os/notion-reviews.yaml under "${outputType}".`)
  console.log('')
  console.log('Each new batch push will create its own inline Items table INSIDE the batch card,')
  console.log('so clicking a batch shows exactly its leads in place — no global Items DB.')
  printPostSetupReminder()
  return { exitCode: 0 }
}

// ─────────────────────── review:reconfigure ─────────────────────────────────

export async function runReviewReconfigure(opts: ReconfigureOpts): Promise<{ exitCode: number }> {
  ensureNotionApiKey()
  const outputType = await chooseOutputType(opts.outputType)
  const existing = await getReviewSurface(outputType)
  if (!existing) {
    console.error(`No review surface registered for "${outputType}". Run review:setup first.`)
    return { exitCode: 1 }
  }

  console.log(`Reconfiguring "${outputType}". Current config:`)
  console.log(`  Category:     ${existing.category_name}`)
  console.log(`  Gate mode:    ${existing.gate_mode}`)
  printColumns('Batch card columns', existing.batch_columns)
  printColumns('Item columns (template applied to each per-batch inline table)', existing.item_columns)
  console.log('')

  const newCategory = opts.categoryName ?? await input({
    message: 'Category display name',
    default: existing.category_name,
  })
  const newGateMode: GateMode = opts.mode ?? await select({
    message: 'Gate mode',
    choices: [
      { name: 'hard       — halt downstream until Approved', value: 'hard' as GateMode },
      { name: 'autonomous — push to Notion AND continue', value: 'autonomous' as GateMode },
    ],
    default: existing.gate_mode,
  })

  console.log('')
  console.log('Column reconfiguration is YAML-only in v2 — if you add a column here, you must')
  console.log('also add it manually in the corresponding Notion DB before the next push.')
  console.log('For now, keeping existing columns. Run `review:doctor` after manual Notion edits.')
  console.log('')

  await setReviewSurface(outputType, {
    ...existing,
    category_name: newCategory,
    gate_mode: newGateMode,
  })

  console.log(`✓ Updated config for "${outputType}".`)
  return { exitCode: 0 }
}

// ─────────────────────────── review:gate ────────────────────────────────────

export async function runReviewGate(opts: GateOpts): Promise<{ exitCode: number }> {
  const outputType = await chooseOutputType(opts.outputType)
  const mode: GateMode = opts.mode ?? (await select({
    message: 'Gate mode',
    choices: [
      { name: 'hard — push to Notion and halt downstream until Approved', value: 'hard' as GateMode },
      { name: 'autonomous — push to Notion AND continue downstream immediately', value: 'autonomous' as GateMode },
    ],
  }))

  if (mode !== 'hard' && mode !== 'autonomous') {
    console.error(`Invalid mode "${mode}". Use hard or autonomous.`)
    return { exitCode: 1 }
  }

  await setGateMode(outputType, mode)
  console.log(`✓ ${outputType} gate mode set to "${mode}".`)
  return { exitCode: 0 }
}

// ────────────────────────── review:status ───────────────────────────────────

export async function runReviewStatus(): Promise<{ exitCode: number }> {
  const surfaces = await listReviewSurfaces()
  const entries = Object.entries(surfaces)
  if (entries.length === 0) {
    console.log('No review surfaces registered. Run review:setup to add one.')
    return { exitCode: 0 }
  }
  console.log('Registered review surfaces:')
  console.log('')
  for (const [outputType, surface] of entries) {
    console.log(`  ${outputType}  (${surface.category_name})`)
    console.log(`    parent_page:  ${surface.parent_page_id}`)
    console.log(`    batches_db:   ${surface.batch_db_id}`)
    console.log(`    gate_mode:    ${surface.gate_mode}`)
    console.log('')
  }
  return { exitCode: 0 }
}

// ────────────────────────── review:doctor ───────────────────────────────────

export async function runReviewDoctor(opts: DoctorOpts): Promise<{ exitCode: number }> {
  ensureNotionApiKey()
  const outputType = await chooseOutputType(opts.outputType)
  const result = await verifyReviewSurface(outputType)

  console.log(`Doctor report for "${outputType}":`)
  console.log('')
  if (result.surface) {
    console.log(`  Category:    ${result.surface.category_name}`)
    console.log(`  Batches DB:  ${result.surface.batch_db_id}`)
    console.log('')
  }

  if (result.ok) {
    console.log('  ✓ All load-bearing contract properties present.')
  } else {
    console.log('  ✗ Contract issues found:')
    for (const e of result.errors) console.log(`    - ${e}`)
  }

  for (const w of result.warnings) console.log(`  ⚠ ${w}`)

  if (result.extras.length > 0) {
    console.log('')
    console.log('  ℹ User-added columns (informational, not flagged):')
    for (const x of result.extras) console.log(`    - [${x.db}] ${x.name}`)
  }

  return { exitCode: result.ok ? 0 : 1 }
}
