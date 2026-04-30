/**
 * Confidence-banded auto-commit (0.9.F).
 *
 * After capture + synthesis writes draft sections into `_preview/`, we
 * auto-commit any section whose confidence is at or above a threshold
 * (default 0.85). Sections below the threshold stay in `_preview/` for
 * the user to review explicitly via `/setup/review`.
 *
 * Threshold resolution order (first hit wins):
 *   1. `--confidence-threshold N` CLI flag (passed in via opts).
 *   2. `--no-auto-commit` flag → effective threshold of 1.01 so every
 *      section stays in the review queue.
 *   3. `~/.gtm-os/config.yaml`'s `onboarding.auto_commit_threshold` key
 *      (per-user persistent opt-out).
 *   4. Bundled default `DEFAULT_AUTO_COMMIT_THRESHOLD = 0.85`.
 *
 * Confidence is read from `_preview/_meta.json#sections.<id>.confidence`
 * (already populated by 0.8.F synthesis). Sections without a meta entry
 * are conservatively kept in the review queue so we never silently
 * commit an un-scored section.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { TenantContext } from './preview.js'

export const DEFAULT_AUTO_COMMIT_THRESHOLD = 0.85

/** Sentinel used by `--no-auto-commit` so even `confidence: 1` stays in queue. */
export const NO_AUTO_COMMIT_THRESHOLD = 1.01

/** Resolved auto-commit decision for a single section. */
export interface AutoCommitDecision {
  section: string
  confidence: number | null
  /** True when synthesis confidence ≥ effective threshold (auto-committed). */
  auto_committed: boolean
}

export interface AutoCommitOptions {
  /** Explicit numeric threshold from `--confidence-threshold`. */
  threshold?: number
  /** True when `--no-auto-commit` was passed. */
  noAutoCommit?: boolean
}

/** Read `onboarding.auto_commit_threshold` from `~/.gtm-os/config.yaml`. */
export function readConfigAutoCommitThreshold(): number | null {
  const configPath = join(homedir(), '.gtm-os', 'config.yaml')
  if (!existsSync(configPath)) return null
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const cfg = yaml.load(raw) as Record<string, unknown> | null
    if (!cfg || typeof cfg !== 'object') return null
    const onboarding = (cfg as Record<string, unknown>).onboarding as
      | Record<string, unknown>
      | undefined
    const v = onboarding?.auto_commit_threshold
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    if (v < 0 || v > 1.01) return null
    return v
  } catch {
    return null
  }
}

/**
 * Resolve the effective threshold from the four sources above. Pure
 * function — caller is expected to compose with the per-section decision
 * map.
 */
export function resolveEffectiveThreshold(opts: AutoCommitOptions = {}): number {
  if (opts.noAutoCommit) return NO_AUTO_COMMIT_THRESHOLD
  if (typeof opts.threshold === 'number' && Number.isFinite(opts.threshold)) {
    return opts.threshold
  }
  const fromConfig = readConfigAutoCommitThreshold()
  if (fromConfig !== null) return fromConfig
  return DEFAULT_AUTO_COMMIT_THRESHOLD
}

/**
 * Walk the preview meta and return one decision per scored section.
 * Sections without confidence stay in the review queue.
 */
export function classifyPreviewSections(
  sectionsMeta: Record<string, { confidence: number }>,
  opts: AutoCommitOptions = {},
): AutoCommitDecision[] {
  const threshold = resolveEffectiveThreshold(opts)
  const decisions: AutoCommitDecision[] = []
  for (const [section, meta] of Object.entries(sectionsMeta)) {
    const confidence = typeof meta?.confidence === 'number' ? meta.confidence : null
    const auto_committed =
      confidence !== null && confidence >= threshold && threshold <= 1
    decisions.push({ section, confidence, auto_committed })
  }
  decisions.sort((a, b) => a.section.localeCompare(b.section))
  return decisions
}

/**
 * Run the auto-commit pass: discards (commits) every high-confidence
 * section, leaves low-confidence sections in `_preview/`. Returns the
 * decision array so the caller can render a summary.
 */
export async function applyAutoCommit(
  tenant: TenantContext,
  opts: AutoCommitOptions = {},
): Promise<{ decisions: AutoCommitDecision[]; committed: string[]; queued: string[] }> {
  const { previewExists, readPreviewMeta, commitPreview, refreshLiveIndex, SECTION_NAMES } =
    await import('./preview.js')
  if (!previewExists(tenant)) {
    throw new Error('No preview to apply auto-commit to. Run capture first.')
  }
  const meta = readPreviewMeta(tenant)
  const sectionsMeta = (meta?.sections ?? {}) as Record<string, { confidence: number }>
  const decisions = classifyPreviewSections(sectionsMeta, opts)
  const committed: string[] = []
  const queued: string[] = []
  for (const d of decisions) {
    if (d.auto_committed) committed.push(d.section)
    else queued.push(d.section)
  }
  // Sections with no meta entry but a real preview file still need to land in
  // queued so `/setup/review` shows them — defensively cover that gap.
  for (const section of SECTION_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(sectionsMeta, section)) {
      if (!queued.includes(section) && !committed.includes(section)) {
        queued.push(section)
      }
    }
  }
  if (committed.length === 0) {
    return { decisions, committed, queued }
  }
  // Discarding the queued sections from the commit means commitPreview
  // moves only the high-confidence files. The discarded ones stay in
  // _preview/ for `/setup/review` to load.
  type SectionName = (typeof SECTION_NAMES)[number]
  const discardSections = SECTION_NAMES.filter(
    (s): s is SectionName => !committed.includes(s),
  )
  commitPreview({ tenant, discardSections })
  await refreshLiveIndex(tenant)
  return { decisions, committed, queued }
}
