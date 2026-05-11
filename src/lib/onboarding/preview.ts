/**
 * Preview folder helpers — onboarding 0.6.0.
 *
 * Synthesis writes into a tenant-scoped `_preview/` folder that mirrors the
 * canonical live layout 1:1. The user reviews, optionally regenerates
 * sections, then commits — at which point the preview moves to live.
 *
 * Layout:
 *   ~/.gtm-os/_preview/                          (default tenant)
 *   ~/.gtm-os/tenants/<slug>/_preview/           (named tenant)
 *
 * Both layouts mirror the live structure under their respective root:
 *   <root>/company_context.yaml
 *   <root>/framework.yaml
 *   <root>/voice/{tone-of-voice.md,examples.md}
 *   <root>/icp/segments.yaml
 *   <root>/positioning/{one-pager.md,battlecards/<slug>.md}
 *   <root>/qualification_rules.md
 *   <root>/campaign_templates.yaml
 *   <root>/search_queries.txt
 *   <root>/_index.md
 *   <root>/_meta.json                            (preview only — captured_at, sources)
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import yaml from 'js-yaml'
import { DEFAULT_TENANT, tenantConfigDir } from '../tenant/index.js'

/** Logical context describing which tenant the preview belongs to. */
export interface TenantContext {
  tenantId: string
}

/** Resolve the live root directory for a tenant. */
export function liveRoot(tenant?: TenantContext): string {
  const id = tenant?.tenantId ?? DEFAULT_TENANT
  if (id === DEFAULT_TENANT) {
    return resolve(homedir(), '.gtm-os')
  }
  return tenantConfigDir(id, homedir())
}

/** Resolve the preview root directory for a tenant. */
export function previewRoot(tenant?: TenantContext): string {
  return join(liveRoot(tenant), '_preview')
}

/**
 * Map a canonical relative path (e.g. `framework.yaml`,
 * `voice/tone-of-voice.md`) onto its preview location.
 */
export function previewPath(canonical: string, tenant?: TenantContext): string {
  return join(previewRoot(tenant), canonical)
}

/** Map a canonical relative path onto its live location. */
export function livePath(canonical: string, tenant?: TenantContext): string {
  return join(liveRoot(tenant), canonical)
}

/** True iff the preview folder for the tenant exists on disk. */
export function previewExists(tenant?: TenantContext): boolean {
  return existsSync(previewRoot(tenant))
}

/** Path to the preview's _meta.json file. */
function previewMetaPath(tenant?: TenantContext): string {
  return join(previewRoot(tenant), '_meta.json')
}

/**
 * Per-section confidence record stored under `_meta.json#sections.<id>`.
 *
 * `confidence` is recomputed from `confidence_signals` via the shared
 * `computeConfidence()` helper so the file stays a self-contained record —
 * downstream tools can re-derive the score without rerunning synthesis.
 */
export interface PreviewSectionMeta {
  confidence: number
  confidence_signals: {
    input_chars: number
    llm_self_rating: number
    has_metadata_anchors: boolean
  }
}

export interface PreviewMeta {
  captured_at: string
  sources?: {
    website?: string | null
    linkedin?: string | null
    docs?: string[] | null
    voice?: string | null
  }
  version?: string
  /** Per-section synthesis metadata (0.8.F). Keyed by SectionId. */
  sections?: Record<string, PreviewSectionMeta>
}

/** Read the preview's _meta.json. Returns null when missing or unparsable. */
export function readPreviewMeta(tenant?: TenantContext): PreviewMeta | null {
  const path = previewMetaPath(tenant)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PreviewMeta
  } catch {
    return null
  }
}

/** Write `_meta.json` for the preview, creating the directory if needed. */
export function writePreviewMeta(meta: PreviewMeta, tenant?: TenantContext): void {
  const root = previewRoot(tenant)
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  writeFileSync(previewMetaPath(tenant), JSON.stringify(meta, null, 2))
}

/** Returns the captured-at timestamp from `_meta.json`, or null. */
export function previewCapturedAt(tenant?: TenantContext): Date | null {
  const meta = readPreviewMeta(tenant)
  if (!meta?.captured_at) return null
  const d = new Date(meta.captured_at)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Ensure the parent directory for a preview path exists. Returns the
 * directory created (or already present). Useful from synthesis writers.
 */
export function ensurePreviewDir(canonical: string, tenant?: TenantContext): string {
  const target = previewPath(canonical, tenant)
  const dir = dirname(target)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Section names map 1:1 to top-level paths under `_preview/`.
 *
 * Used by `--commit-preview --discard <section>`, `--regenerate <section>`,
 * and the doctor's audit. Keep this list in sync with what synthesis
 * actually writes.
 */
export const SECTION_NAMES = [
  'company_context',
  'framework',
  'voice',
  'icp',
  'positioning',
  'qualification_rules',
  'campaign_templates',
  'search_queries',
  'config',
] as const

export type SectionName = typeof SECTION_NAMES[number]

/**
 * Canonical paths owned by each section. Ordering does not matter — we move
 * each entry independently when committing.
 */
export const SECTION_PATHS: Record<SectionName, string[]> = {
  company_context: ['company_context.yaml'],
  framework: ['framework.yaml'],
  voice: ['voice'],
  icp: ['icp'],
  positioning: ['positioning'],
  qualification_rules: ['qualification_rules.md'],
  campaign_templates: ['campaign_templates.yaml'],
  search_queries: ['search_queries.txt'],
  config: ['config.yaml'],
}

export interface CommitPreviewOptions {
  /** Section names to leave behind in `_preview/`. */
  discardSections?: SectionName[]
  tenant?: TenantContext
}

export interface CommitPreviewResult {
  /** Canonical paths that moved to live. */
  committed: string[]
  /** Canonical paths left behind in `_preview/`. */
  discarded: string[]
}

/**
 * Move preview files into their live counterparts.
 *
 * Sections listed in `discardSections` are skipped (preview file stays in
 * place for the user to manually finish or rerun `--regenerate`). All
 * non-section housekeeping (e.g. `_index.md`, `_meta.json`) is dropped from
 * the preview after a successful commit so a stale preview doesn't linger.
 *
 * Meta-confidence persistence (A6, Part 2):
 *   The preview's `_meta.json#sections` carries per-section confidence
 *   scores seeded by `writeCapturedPreview` and finalized by synthesis.
 *   Pre-A6 we dropped this data with the preview folder, forcing /brain to
 *   recompute confidence on every page load. We now copy the per-section
 *   meta entries for *committed* sections into `<liveRoot>/_meta.json`
 *   (merging into any pre-existing entry).
 *
 *   Why a sidecar at the live root (Option B, not in-band inside
 *   `company_context.yaml`):
 *     - Keeps the human-readable yaml clean of metadata noise.
 *     - Matches the lookup site `brain.ts` already uses
 *       (`<liveRoot>/_meta.json` was already a fallback path).
 *     - One file per tenant — no per-section sidecar proliferation.
 */
export function commitPreview(opts: CommitPreviewOptions = {}): CommitPreviewResult {
  const { tenant, discardSections = [] } = opts
  if (!previewExists(tenant)) {
    throw new Error(`No preview at ${previewRoot(tenant)} to commit.`)
  }

  // Snapshot preview meta upfront — we tear down `_preview/` further below.
  const previewMetaSnapshot = readPreviewMeta(tenant)

  const discardSet = new Set<SectionName>(discardSections)
  const committed: string[] = []
  const discarded: string[] = []

  for (const section of SECTION_NAMES) {
    const paths = SECTION_PATHS[section]
    for (const canonical of paths) {
      const preview = previewPath(canonical, tenant)
      if (!existsSync(preview)) continue

      if (discardSet.has(section)) {
        discarded.push(canonical)
        continue
      }

      const live = livePath(canonical, tenant)
      // Ensure parent of live target exists (matters for nested paths like
      // voice/, icp/, positioning/).
      const parent = dirname(live)
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true })

      // config.yaml is special — Step 1 already wrote provider keys + email
      // / linkedin choices to live root before synthesis ran. Commit MERGES
      // the preview's synthesis-time additions (provider_preferences, goals
      // block) over the live config so the user's Step 1 picks survive.
      if (canonical === 'config.yaml' && existsSync(live)) {
        try {
          const liveYaml = (yaml.load(readFileSync(live, 'utf-8')) as Record<string, unknown>) ?? {}
          const previewYaml = (yaml.load(readFileSync(preview, 'utf-8')) as Record<string, unknown>) ?? {}
          // Preview wins for any key it sets, but live keeps everything else.
          const merged = { ...liveYaml, ...previewYaml }
          writeFileSync(live, yaml.dump(merged))
          rmSync(preview, { recursive: true, force: true })
          committed.push(canonical)
          continue
        } catch {
          // Fall through to wholesale replace if either side is unparsable.
        }
      }

      // Replace any existing live counterpart wholesale — preview is the
      // source of truth at commit time.
      if (existsSync(live)) {
        rmSync(live, { recursive: true, force: true })
      }
      cpSync(preview, live, { recursive: true })

      // Remove the now-committed preview entry so the preview folder
      // converges to "only discarded sections + housekeeping" post-commit.
      rmSync(preview, { recursive: true, force: true })
      committed.push(canonical)
    }
  }

  // ── A6: persist per-section confidence to <liveRoot>/_meta.json ──────────
  // Only carry forward meta entries for sections that actually committed
  // (discarded sections still live in `_preview/`, so their meta stays in the
  // preview's `_meta.json` until that section eventually commits).
  const previewSections = previewMetaSnapshot?.sections ?? {}
  const committedSectionIds = new Set<string>()
  for (const section of SECTION_NAMES) {
    if (discardSet.has(section)) continue
    // A section "committed" here when at least one of its canonical paths
    // landed in the committed list above.
    if (SECTION_PATHS[section].some((p) => committed.includes(p))) {
      committedSectionIds.add(section)
    }
  }
  const newMetaEntries: Record<string, PreviewSectionMeta> = {}
  for (const id of committedSectionIds) {
    const entry = previewSections[id]
    if (entry) newMetaEntries[id] = entry
  }
  if (Object.keys(newMetaEntries).length > 0) {
    const liveMetaPath = join(liveRoot(tenant), '_meta.json')
    let existing: { sections?: Record<string, PreviewSectionMeta> } = {}
    if (existsSync(liveMetaPath)) {
      try {
        existing = JSON.parse(readFileSync(liveMetaPath, 'utf-8'))
      } catch {
        existing = {}
      }
    }
    const merged = {
      ...existing,
      sections: { ...(existing.sections ?? {}), ...newMetaEntries },
    }
    if (!existsSync(liveRoot(tenant))) mkdirSync(liveRoot(tenant), { recursive: true })
    writeFileSync(liveMetaPath, JSON.stringify(merged, null, 2))
  }

  // Drop preview housekeeping if nothing meaningful is left.
  const remaining = SECTION_NAMES.flatMap((s) => SECTION_PATHS[s]).filter((p) =>
    existsSync(previewPath(p, tenant)),
  )
  if (remaining.length === 0) {
    rmSync(previewRoot(tenant), { recursive: true, force: true })
  } else {
    // Refresh meta to reflect the partial state — drop the entries we just
    // persisted to live so the preview's meta only describes leftover
    // discarded/uncommitted sections.
    const meta = previewMetaSnapshot
    if (meta) {
      const remainingSections: Record<string, PreviewSectionMeta> = {}
      for (const [k, v] of Object.entries(meta.sections ?? {})) {
        if (!committedSectionIds.has(k)) remainingSections[k] = v
      }
      writePreviewMeta(
        {
          ...meta,
          sections: remainingSections,
          version: meta.version ?? '0.6.0',
        },
        tenant,
      )
    }
  }

  return { committed, discarded }
}

/**
 * Refresh the live `_index.md` for a tenant. Called after `commitPreview()`
 * resolves so we keep the helper synchronous and side-effect-only.
 */
export async function refreshLiveIndex(tenant?: TenantContext): Promise<void> {
  try {
    const { buildIndex } = await import('./index-builder.js')
    buildIndex(liveRoot(tenant), false)
  } catch {
    // Best-effort — never fail callers on index regeneration.
  }
}

/** Delete the preview folder entirely. No-op if it does not exist. */
export function discardPreview(tenant?: TenantContext): void {
  const root = previewRoot(tenant)
  if (!existsSync(root)) return
  rmSync(root, { recursive: true, force: true })
}

/** Get the mtime of a path under preview, or null if absent. */
export function previewMtime(canonical: string, tenant?: TenantContext): Date | null {
  const p = previewPath(canonical, tenant)
  if (!existsSync(p)) return null
  try {
    return statSync(p).mtime
  } catch {
    return null
  }
}
