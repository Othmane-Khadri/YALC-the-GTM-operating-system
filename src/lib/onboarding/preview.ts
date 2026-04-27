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

export interface PreviewMeta {
  captured_at: string
  sources?: {
    website?: string | null
    linkedin?: string | null
    docs?: string[] | null
    voice?: string | null
  }
  version?: string
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
 */
export function commitPreview(opts: CommitPreviewOptions = {}): CommitPreviewResult {
  const { tenant, discardSections = [] } = opts
  if (!previewExists(tenant)) {
    throw new Error(`No preview at ${previewRoot(tenant)} to commit.`)
  }

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

  // Drop preview housekeeping if nothing meaningful is left.
  const remaining = SECTION_NAMES.flatMap((s) => SECTION_PATHS[s]).filter((p) =>
    existsSync(previewPath(p, tenant)),
  )
  if (remaining.length === 0) {
    rmSync(previewRoot(tenant), { recursive: true, force: true })
  } else {
    // Refresh meta to reflect the partial state.
    const meta = readPreviewMeta(tenant)
    if (meta) {
      writePreviewMeta({ ...meta, version: meta.version ?? '0.6.0' }, tenant)
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
