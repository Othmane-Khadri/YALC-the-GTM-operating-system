/**
 * Pre-0.6.0 → 0.6.0 migration helper.
 *
 * Extracts captured-answer fields from a pre-0.6.0 `framework.yaml` and
 * writes them to a canonical `~/.gtm-os/company_context.yaml`. Idempotent:
 * if both files already exist, the call is a no-op.
 *
 * Migration source: `framework.yaml` is the file that 0.5.x onboarding
 * wrote. We extract `company.*`, `positioning.competitors[].name`, and the
 * primary segment's pain_points into the `CompanyContext` shape. Any
 * field we can't determine stays empty.
 *
 * The migration writes to the LIVE folder — not preview — because the
 * source is already-committed live state. Migration is opt-in (the user
 * runs `yalc-gtm migrate`); it is never auto-triggered.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import yaml from 'js-yaml'
import { emptyCompanyContext, type CompanyContext } from '../framework/context-types.js'

const GTM_OS_DIR = join(homedir(), '.gtm-os')
const LEGACY_FRAMEWORK_PATH = join(GTM_OS_DIR, 'framework.yaml')
const COMPANY_CONTEXT_PATH = join(GTM_OS_DIR, 'company_context.yaml')

export interface MigrationResult {
  /** True when this run wrote a new company_context.yaml. */
  migrated: boolean
  /** Path written, or null when no-op. */
  path: string | null
  /** Reason printed to the user. */
  reason: string
}

/** Path detection: pre-0.6.0 install has framework.yaml but no company_context.yaml. */
export function isPre060State(): boolean {
  return existsSync(LEGACY_FRAMEWORK_PATH) && !existsSync(COMPANY_CONTEXT_PATH)
}

/** Read framework.yaml as a loose record — schema may vary across 0.5.x. */
function loadLegacyFramework(): Record<string, unknown> | null {
  if (!existsSync(LEGACY_FRAMEWORK_PATH)) return null
  try {
    return (yaml.load(readFileSync(LEGACY_FRAMEWORK_PATH, 'utf-8')) as Record<string, unknown>) ?? null
  } catch {
    return null
  }
}

/** Build a CompanyContext from a loaded legacy framework record. */
export function buildContextFromLegacy(legacy: Record<string, unknown>): CompanyContext {
  const ctx = emptyCompanyContext()
  const company = (legacy.company as Record<string, unknown> | undefined) ?? {}
  ctx.company.name = String(company.name ?? '') || ''
  ctx.company.website = String(company.website ?? '') || ''
  ctx.company.description = String(company.description ?? '') || ''
  if (typeof company.industry === 'string') ctx.company.industry = company.industry
  if (typeof company.stage === 'string') ctx.company.stage = company.stage
  if (typeof company.teamSize === 'string') ctx.company.team_size = company.teamSize

  const positioning = (legacy.positioning as Record<string, unknown> | undefined) ?? {}
  const competitorsRaw = positioning.competitors as Array<Record<string, unknown>> | undefined
  if (Array.isArray(competitorsRaw)) {
    ctx.icp.competitors = competitorsRaw
      .map((c) => String(c.name ?? '').trim())
      .filter(Boolean)
  }

  const segments = (legacy.segments as Array<Record<string, unknown>> | undefined) ?? []
  const primary =
    segments.find((s) => s.priority === 'primary') ?? segments[0]
  if (primary) {
    if (typeof primary.description === 'string') {
      ctx.icp.segments_freeform = primary.description
    } else if (typeof primary.name === 'string') {
      ctx.icp.segments_freeform = primary.name
    }
    const pains = primary.painPoints as string[] | undefined
    if (Array.isArray(pains)) ctx.icp.pain_points = pains.filter(Boolean)
    const voice = primary.voice as Record<string, unknown> | undefined
    if (voice) {
      const tone = typeof voice.tone === 'string' ? voice.tone : ''
      const style = typeof voice.style === 'string' ? voice.style : ''
      ctx.voice.description = [tone, style].filter(Boolean).join(' — ')
    }
  }

  ctx.meta.captured_at = new Date().toISOString()
  ctx.meta.last_updated_at = ctx.meta.captured_at
  ctx.meta.migrated_from = String(legacy.version ?? '0.5.x')
  ctx.meta.version = '0.6.0'

  return ctx
}

/**
 * Run the migration. Writes `~/.gtm-os/company_context.yaml` from the
 * existing framework.yaml. No-op when the target already exists or when
 * there is no framework.yaml to migrate from.
 */
export function runMigrate(): MigrationResult {
  if (existsSync(COMPANY_CONTEXT_PATH)) {
    return {
      migrated: false,
      path: COMPANY_CONTEXT_PATH,
      reason: `${COMPANY_CONTEXT_PATH} already exists. Nothing to migrate.`,
    }
  }
  const legacy = loadLegacyFramework()
  if (!legacy) {
    return {
      migrated: false,
      path: null,
      reason: `No legacy framework.yaml found at ${LEGACY_FRAMEWORK_PATH}.`,
    }
  }
  const ctx = buildContextFromLegacy(legacy)
  writeFileSync(COMPANY_CONTEXT_PATH, yaml.dump(ctx))
  return {
    migrated: true,
    path: COMPANY_CONTEXT_PATH,
    reason: `Wrote ${COMPANY_CONTEXT_PATH} from ${LEGACY_FRAMEWORK_PATH}.`,
  }
}

/** Exposed for tests / doctor — the canonical paths used by migration. */
export const _paths = {
  framework: LEGACY_FRAMEWORK_PATH,
  companyContext: COMPANY_CONTEXT_PATH,
}
