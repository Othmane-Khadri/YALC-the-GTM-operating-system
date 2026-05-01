/**
 * Visualize runner — orchestrates the visualize skill call + persistence.
 *
 * Flow:
 *   1. Expand `data_paths` globs (only `*` inside a single segment is supported,
 *      `**` is not — keeps the implementation footprint small).
 *   2. Read the first row of each resolved file to build a `data_shape` preview.
 *   3. Auto-inject `brand_tokens` from `web/brand/tokens.json` (the user never
 *      supplies these — the skill body's brand-fidelity rules depend on them).
 *   4. Auto-inject `ui_ux_directives` derived from the chosen intent + brand
 *      tokens. These are the design oracle the visualize skill consumes; they
 *      are how the skill body delegates to the user-installed
 *      `ui-ux-pro-max` Claude Code skill (the actual call is the LLM
 *      internalising the design directives via the prompt).
 *   5. Resolve the bundled visualize skill, run it.
 *   6. Parse the structured JSON `result` event, persist via `writeVisualization`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename, isAbsolute, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'
import { PKG_ROOT } from '../paths.js'
import { writeVisualization, type WriteVisualizationResult } from './storage.js'
import { publishVisualizeEvent } from '../server/event-bus.js'

export interface VisualizeRunInput {
  view_id: string
  data_paths: string[]
  intent: string
}

export interface VisualizeRunResult extends WriteVisualizationResult {
  view_id: string
  page_path: string
  summary?: string
  idiom: string
}

/** Expand `~` and `*` in a path. `**` is intentionally unsupported. */
export function expandPathGlob(input: string): string[] {
  let p = input
  if (p.startsWith('~')) p = p.replace(/^~/, homedir())
  if (!isAbsolute(p)) p = resolvePath(process.cwd(), p)

  // Fast path: no glob chars.
  if (!p.includes('*')) {
    return existsSync(p) ? [p] : []
  }

  // Split into segments. Only the LAST segment may contain `*` — anything
  // earlier we treat as literal so we do one readdir.
  const dir = dirname(p)
  const filePattern = basename(p)
  if (!existsSync(dir)) return []
  const re = patternToRegex(filePattern)
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (!re.test(entry)) continue
    const abs = join(dir, entry)
    try {
      const st = statSync(abs)
      if (st.isFile()) out.push(abs)
    } catch {
      /* skip */
    }
  }
  return out.sort()
}

function patternToRegex(pattern: string): RegExp {
  // Escape regex special chars except `*`, then turn `*` into `[^/]*`.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`)
}

/** Read the first row (or top-level object) of a JSON file. */
function readFirstRow(filePath: string): unknown {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    if (Array.isArray(data)) return data[0] ?? null
    if (data && typeof data === 'object') {
      // Common shape: dashboard run JSON has a `rows: []` key.
      const rows = (data as Record<string, unknown>).rows
      if (Array.isArray(rows) && rows.length > 0) return rows[0]
      return data
    }
    return data
  } catch {
    return null
  }
}

/** Brand tokens loader — reads from the canonical `web/brand/tokens.json`. */
export function loadBrandTokens(): Record<string, unknown> {
  const path = join(PKG_ROOT, 'web', 'brand', 'tokens.json')
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
}

/**
 * Build the design directives that the LLM treats as authoritative.
 * The string mirrors what `ui-ux-pro-max` would emit for the resolved
 * brand palette + intent. We hard-code yalc rose + Outfit/Inter pairing
 * because those are the brand non-negotiables.
 */
export function buildUiUxDirectives(
  brandTokens: Record<string, unknown>,
  intent: string,
): string {
  const colors = (brandTokens.colors ?? {}) as Record<string, string>
  const fonts = (brandTokens.fonts ?? {}) as Record<string, string>
  const primary = colors.primary ?? '#C9506E'
  const accent = colors.accent ?? '#E07A95'
  const paper = colors.background ?? '#F8EDE8'
  const heading = fonts.heading ?? "'Outfit', system-ui, sans-serif"
  const body = fonts.body ?? "'Inter', system-ui, sans-serif"
  const intentLower = intent.toLowerCase()
  let lift = '4px lift on hover with soft shadow (rgba(201,80,110,0.08)).'
  if (intentLower.includes('table')) lift = 'row hover background tint (rgba(201,80,110,0.04)).'
  if (intentLower.includes('chart')) lift = 'data-point dot expansion + tooltip on hover.'
  return [
    `palette: yalc rose — primary ${primary}, accent ${accent}, paper ${paper}.`,
    `pairing: ${heading} for headings, ${body} for body, JetBrains Mono for code.`,
    `spacing: 24px between columns, 16px between cards, 100px section padding.`,
    `radius: 14px md, 16px lg, 9999px pill.`,
    `motion: 150ms ease-out transitions; ${lift}`,
    `focus: 2px solid var(--ring) ring on every interactive element.`,
    `forbidden: bg-blue-*, bg-gray-*, bg-slate-*, text-blue-*, text-gray-*, text-slate-* — ALL Tailwind blue/gray/slate utilities are off-limits.`,
  ].join('\n')
}

/** Build the `data_shape` preview the skill prompt consumes. */
export function buildDataShape(resolvedFiles: string[]): string {
  const previews = resolvedFiles.map((f) => ({
    path: f,
    first_row: readFirstRow(f),
  }))
  return JSON.stringify(previews, null, 2)
}

/**
 * Resolve & invoke the visualize skill.
 *
 * Importing through `loadMarkdownSkill` and the framework runner's bundled
 * skill resolver keeps the test surface identical to every other markdown
 * skill — `vi.spyOn(capabilities, 'getCapabilityRegistryReady')` works.
 */
export async function runVisualize(input: VisualizeRunInput): Promise<VisualizeRunResult> {
  if (!Array.isArray(input.data_paths) || input.data_paths.length === 0) {
    throw new Error('data_paths is required (one or more JSON file paths or globs)')
  }

  // Best-effort SSE fan-out — surface that a visualization run started.
  try {
    publishVisualizeEvent({
      type: 'visualization_started',
      item: { view_id: input.view_id, intent: input.intent },
    })
  } catch {
    // best-effort
  }

  const resolvedFiles: string[] = []
  for (const pat of input.data_paths) {
    for (const f of expandPathGlob(pat)) resolvedFiles.push(f)
  }
  if (resolvedFiles.length === 0) {
    throw new Error(
      `data_paths matched no files. Patterns tried: ${input.data_paths.join(', ')}`,
    )
  }

  const brandTokens = loadBrandTokens()
  const uiUxDirectives = buildUiUxDirectives(brandTokens, input.intent)
  const dataShape = buildDataShape(resolvedFiles)

  const skillInputs: Record<string, unknown> = {
    view_id: input.view_id,
    intent: input.intent,
    data_paths: resolvedFiles.join('\n'),
    data_shape: dataShape,
    brand_tokens: JSON.stringify(brandTokens, null, 2),
    ui_ux_directives: uiUxDirectives,
  }

  const skill = await resolveVisualizeSkill()
  const { getRegistryReady } = await import('../providers/registry.js')
  const providers = await getRegistryReady()
  const ctx = {
    framework: null as never,
    intelligence: [],
    providers,
    userId: 'visualize',
  }

  const collected: unknown[] = []
  for await (const event of skill.execute(skillInputs, ctx as never)) {
    if (event.type === 'result') collected.push(event.data)
    else if (event.type === 'error') {
      throw new Error(`visualize skill failed: ${event.message}`)
    }
  }

  let parsed: ParsedVisualizeResult
  try {
    parsed = parseVisualizeResult(collected)
  } catch (err) {
    try {
      publishVisualizeEvent({
        type: 'visualization_failed',
        item: {
          view_id: input.view_id,
          intent: input.intent,
          error: err instanceof Error ? err.message : String(err),
        },
      })
    } catch {
      // best-effort
    }
    throw err
  }
  const writeResult = writeVisualization({
    view_id: input.view_id,
    intent: input.intent,
    idiom: parsed.idiom,
    html: parsed.html,
    data_paths: resolvedFiles,
    summary: parsed.summary,
  })

  // Best-effort SSE fan-out — visualization written to disk.
  try {
    publishVisualizeEvent({
      type: 'visualization_completed',
      item: {
        view_id: input.view_id,
        intent: input.intent,
        idiom: parsed.idiom,
        data_paths: resolvedFiles,
        last_generated_at: writeResult.metadata.last_generated_at,
        summary: parsed.summary,
      },
    })
  } catch {
    // best-effort
  }

  return {
    ...writeResult,
    view_id: input.view_id,
    page_path: writeResult.page_path,
    summary: parsed.summary,
    idiom: parsed.idiom,
  }
}

interface ParsedVisualizeResult {
  html: string
  idiom: string
  summary?: string
}

function parseVisualizeResult(events: unknown[]): ParsedVisualizeResult {
  // The LLM may return either a parsed object (when the reasoning adapter
  // unmarshals JSON for us) or { text: "<json>" } from the raw reasoning
  // capability. Handle both.
  for (const ev of events) {
    if (ev && typeof ev === 'object') {
      const o = ev as Record<string, unknown>
      if (typeof o.html === 'string' && typeof o.idiom === 'string') {
        return {
          html: o.html,
          idiom: o.idiom,
          summary: typeof o.summary === 'string' ? o.summary : undefined,
        }
      }
      if (typeof o.text === 'string') {
        const fromText = parseJsonFromText(o.text)
        if (fromText) return fromText
      }
    }
  }
  throw new Error('visualize skill returned no parsable result')
}

function parseJsonFromText(text: string): ParsedVisualizeResult | null {
  // Strip ```json fences if present.
  const cleaned = text.replace(/```json\s*|```/g, '').trim()
  // Find the first object boundary.
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    if (typeof parsed.html === 'string' && typeof parsed.idiom === 'string') {
      return {
        html: parsed.html,
        idiom: parsed.idiom,
        summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      }
    }
  } catch {
    return null
  }
  return null
}

async function resolveVisualizeSkill() {
  const { loadMarkdownSkill } = await import('../skills/markdown-loader.js')
  const path = join(PKG_ROOT, 'configs', 'skills', 'visualize.md')
  const result = await loadMarkdownSkill(path)
  if (!result.skill) {
    throw new Error(
      `Failed to load visualize skill: ${result.errors.join('; ')}`,
    )
  }
  return result.skill
}
