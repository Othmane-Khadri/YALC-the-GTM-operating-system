/**
 * Framework recommendation engine.
 *
 * Given a snapshot of the user's environment (registered providers,
 * env vars, captured company context, currently-installed frameworks),
 * decide which frameworks are eligible, then which of those should be
 * actively recommended.
 *
 * Eligibility = `requires` block passes (providers + keys + context fields).
 * Recommendation = eligibility + `recommended_when` clauses pass.
 *
 * Output is a ranked list — frameworks that lean on providers the user
 * already has configured rank highest, on the principle that they're
 * the cheapest to install successfully.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import yaml from 'js-yaml'
import type { CompanyContext } from '../framework/context-types.js'
import type { FrameworkDefinition } from './types.js'
import { loadAllFrameworks } from './loader.js'
import { listInstalledFrameworks } from './registry.js'

/** Snapshot of the user's environment used to evaluate framework rules. */
export interface RecommendationEnvironment {
  /** Provider IDs that are registered (from the provider registry). */
  providers: string[]
  /** Names of env vars the user has set. */
  envKeys: string[]
  /** Loaded `~/.gtm-os/company_context.yaml`, or null if absent. */
  context: CompanyContext | null
  /** Names of frameworks currently installed (from registry). */
  installed: string[]
}

/** Reason a framework was excluded — surfaced for "why didn't X recommend?" UX. */
export interface IneligibilityReason {
  framework: string
  rule: 'providers' | 'any_of_keys' | 'context_fields' | 'recommended_when'
  detail: string
}

/** A single recommendation, ranked. */
export interface FrameworkRecommendation {
  framework: FrameworkDefinition
  /** How many of the framework's required providers the user already has. */
  providerMatchCount: number
  /** Detected output destination (notion if NOTION_API_KEY else dashboard). */
  preferredDestination: 'notion' | 'dashboard'
}

/** Evaluate the `requires` block. Returns null if eligible, else a reason. */
export function checkRequires(
  framework: FrameworkDefinition,
  env: RecommendationEnvironment,
): IneligibilityReason | null {
  const r = framework.requires ?? {}

  if (r.providers && r.providers.length > 0) {
    const missing = r.providers.filter((p) => !env.providers.includes(p))
    if (missing.length > 0) {
      return {
        framework: framework.name,
        rule: 'providers',
        detail: `Missing required provider(s): ${missing.join(', ')}`,
      }
    }
  }

  if (r.any_of_keys && r.any_of_keys.length > 0) {
    const found = r.any_of_keys.some((k) => env.envKeys.includes(k))
    if (!found) {
      return {
        framework: framework.name,
        rule: 'any_of_keys',
        detail: `Need at least one of: ${r.any_of_keys.join(', ')}`,
      }
    }
  }

  if (r.context_fields && r.context_fields.length > 0) {
    if (!env.context) {
      return {
        framework: framework.name,
        rule: 'context_fields',
        detail: 'company_context.yaml not found — run yalc-gtm start first',
      }
    }
    const missing = r.context_fields.filter((path) => !contextFieldHasValue(env.context!, path))
    if (missing.length > 0) {
      return {
        framework: framework.name,
        rule: 'context_fields',
        detail: `Empty required context fields: ${missing.join(', ')}`,
      }
    }
  }

  return null
}

/** Evaluate the `recommended_when` block. Null = recommend, else reason. */
export function checkRecommendedWhen(
  framework: FrameworkDefinition,
  env: RecommendationEnvironment,
): IneligibilityReason | null {
  const w = framework.recommended_when
  if (!w) return null

  if (w.has_competitors_in_context !== undefined) {
    const has = (env.context?.icp.competitors?.length ?? 0) > 0
    if (has !== w.has_competitors_in_context) {
      return {
        framework: framework.name,
        rule: 'recommended_when',
        detail: 'Clause "has_competitors_in_context" not satisfied',
      }
    }
  }

  if (w.has_provider) {
    if (!env.providers.includes(w.has_provider)) {
      return {
        framework: framework.name,
        rule: 'recommended_when',
        detail: `Clause "has_provider:${w.has_provider}" not satisfied`,
      }
    }
  }

  if (w.not_has_active_framework) {
    if (env.installed.includes(w.not_has_active_framework)) {
      return {
        framework: framework.name,
        rule: 'recommended_when',
        detail: `Already installed: ${w.not_has_active_framework}`,
      }
    }
  }

  if (w.has_icp_segments !== undefined) {
    const has =
      !!env.context?.icp.segments_freeform && env.context.icp.segments_freeform.length > 0
    if (has !== w.has_icp_segments) {
      return {
        framework: framework.name,
        rule: 'recommended_when',
        detail: 'Clause "has_icp_segments" not satisfied',
      }
    }
  }

  if (w.has_target_communities !== undefined) {
    // Communities live in a downstream config file; we treat presence of any
    // pain points or a non-empty ICP description as a proxy here. Real
    // checks would inspect `framework.yaml.signals.monitoringKeywords` once
    // that's split out.
    const has = (env.context?.icp.pain_points?.length ?? 0) > 0
    if (has !== w.has_target_communities) {
      return {
        framework: framework.name,
        rule: 'recommended_when',
        detail: 'Clause "has_target_communities" not satisfied',
      }
    }
  }

  if (w.has_recent_linkedin_posts !== undefined) {
    const has = !!env.context?.sources?.linkedin
    if (has !== w.has_recent_linkedin_posts) {
      return {
        framework: framework.name,
        rule: 'recommended_when',
        detail: 'Clause "has_recent_linkedin_posts" not satisfied',
      }
    }
  }

  return null
}

/** Check whether a `path.like.this` resolves to a non-empty value in the context. */
export function contextFieldHasValue(ctx: CompanyContext, path: string): boolean {
  const segments = path.split('.')
  let cur: unknown = ctx
  for (const s of segments) {
    if (cur == null || typeof cur !== 'object') return false
    cur = (cur as Record<string, unknown>)[s]
  }
  if (cur == null) return false
  if (typeof cur === 'string') return cur.trim().length > 0
  if (Array.isArray(cur)) return cur.length > 0
  if (typeof cur === 'object') return Object.keys(cur).length > 0
  return true
}

/** Read company_context.yaml if it exists. Best-effort — returns null on parse error. */
export function loadCompanyContext(): CompanyContext | null {
  const p = join(homedir(), '.gtm-os', 'company_context.yaml')
  if (!existsSync(p)) return null
  try {
    const parsed = yaml.load(readFileSync(p, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as CompanyContext
  } catch {
    return null
  }
}

/**
 * Build a recommendation environment from process state. Pure on input —
 * tests pass everything explicitly.
 */
export function gatherEnvironment(opts?: Partial<RecommendationEnvironment>): RecommendationEnvironment {
  return {
    providers: opts?.providers ?? [],
    envKeys: opts?.envKeys ?? Object.keys(process.env).filter((k) => process.env[k]),
    context: opts?.context ?? loadCompanyContext(),
    installed: opts?.installed ?? listInstalledFrameworks(),
  }
}

/** Detect the preferred destination for a framework given env. */
function detectDestination(env: RecommendationEnvironment): 'notion' | 'dashboard' {
  return env.envKeys.includes('NOTION_API_KEY') ? 'notion' : 'dashboard'
}

/**
 * Run the full recommendation pipeline.
 *
 * Returns:
 * - `recommended` — passed eligibility + `recommended_when` (sorted).
 * - `eligible_only` — passed eligibility but failed `recommended_when`.
 * - `ineligible` — failed eligibility, with reason.
 *
 * Sort key: provider-match count desc, then alphabetic.
 */
export function recommendFrameworks(
  env?: RecommendationEnvironment,
  frameworks?: FrameworkDefinition[],
): {
  recommended: FrameworkRecommendation[]
  eligibleOnly: FrameworkRecommendation[]
  ineligible: IneligibilityReason[]
} {
  const e = env ?? gatherEnvironment()
  const all = frameworks ?? loadAllFrameworks()
  const recommended: FrameworkRecommendation[] = []
  const eligibleOnly: FrameworkRecommendation[] = []
  const ineligible: IneligibilityReason[] = []

  for (const f of all) {
    const reqFail = checkRequires(f, e)
    if (reqFail) {
      ineligible.push(reqFail)
      continue
    }
    const providerMatchCount = (f.requires.providers ?? []).filter((p) =>
      e.providers.includes(p),
    ).length
    const preferredDestination = detectDestination(e)
    const rec: FrameworkRecommendation = {
      framework: f,
      providerMatchCount,
      preferredDestination,
    }
    const recFail = checkRecommendedWhen(f, e)
    if (recFail) {
      eligibleOnly.push(rec)
      ineligible.push(recFail)
      continue
    }
    recommended.push(rec)
  }

  const cmp = (a: FrameworkRecommendation, b: FrameworkRecommendation) => {
    if (b.providerMatchCount !== a.providerMatchCount) {
      return b.providerMatchCount - a.providerMatchCount
    }
    return a.framework.name.localeCompare(b.framework.name)
  }
  recommended.sort(cmp)
  eligibleOnly.sort(cmp)

  return { recommended, eligibleOnly, ineligible }
}
