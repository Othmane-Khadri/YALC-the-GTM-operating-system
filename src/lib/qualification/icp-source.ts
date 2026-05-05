import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { loadFramework } from '../framework/context'
import type { ClientICP } from './types'
import type { GTMFramework } from '../framework/types'

/**
 * Required fields for a valid ClientICP. The loader fails loud at plan time
 * when any of these are empty/missing — operators should never silently run a
 * campaign with broken filtering.
 */
const REQUIRED_FIELDS = ['target_industries', 'target_roles', 'disqualifiers'] as const

export class ICPSchemaError extends Error {
  constructor(
    public slug: string,
    public missingFields: string[],
    public source: 'tenant_framework' | 'repo_yaml',
  ) {
    super(
      `ICP for tenant '${slug}' (source: ${source}) is missing required fields: ${missingFields.join(
        ', ',
      )}. Required: ${REQUIRED_FIELDS.join(', ')}.`,
    )
    this.name = 'ICPSchemaError'
  }
}

/**
 * Resolve a tenant's ICP. Tries the tenant framework first (yalc's per-tenant config),
 * falls back to a simple repo yaml at `<icpYamlDir>/<slug>.yml` (default `./clients/`).
 *
 * Returns `null` when neither source resolves. The caller decides whether that's fatal —
 * `--verify-experience` makes it fatal; otherwise the pipeline continues unchanged.
 *
 * Throws `ICPSchemaError` when a source resolves but is missing required fields —
 * fail loud at plan time so operators don't run a campaign with broken filtering.
 *
 * @param tenantSlug — the tenant/client slug (lowercase, hyphenated)
 * @param opts.icpYamlDir — override the default `./clients/` directory; also reads `YALC_CLIENT_ICP_DIR` env
 */
export async function resolveClientICP(
  tenantSlug: string,
  opts: { icpYamlDir?: string } = {},
): Promise<ClientICP | null> {
  // 1. Try tenant framework
  const framework = await loadFramework(tenantSlug)
  if (framework) {
    const fromFramework = clientICPFromFramework(tenantSlug, framework)
    if (fromFramework) return fromFramework
    // Framework existed but had no usable primary segment — fall through to yaml
  }

  // 2. Try repo yaml
  const yamlDir = opts.icpYamlDir ?? process.env.YALC_CLIENT_ICP_DIR ?? 'clients'
  const yamlPath = join(yamlDir, `${tenantSlug}.yml`)
  if (existsSync(yamlPath)) {
    const raw = yaml.load(readFileSync(yamlPath, 'utf8'))
    return clientICPFromYaml(tenantSlug, raw)
  }

  // 3. Neither resolved
  return null
}

/** Build ClientICP from a loaded GTMFramework, or null if framework lacks a usable primary segment. */
function clientICPFromFramework(slug: string, framework: GTMFramework): ClientICP | null {
  const primary = framework.segments?.find((s) => s.priority === 'primary')
  if (!primary) return null

  // The framework segment may legitimately have empty arrays. We treat "no usable primary"
  // as: both disqualifiers AND targetIndustries are empty/missing — meaning there's nothing
  // for the new gates to act on, so fall through to the yaml fallback.
  const disqualifiers = primary.disqualifiers ?? []
  const targetIndustries = primary.targetIndustries ?? []
  if (disqualifiers.length === 0 && targetIndustries.length === 0) return null

  // Validate required fields are non-empty
  const targetRoles = primary.targetRoles ?? []
  const missing: string[] = []
  if (targetIndustries.length === 0) missing.push('target_industries')
  if (targetRoles.length === 0) missing.push('target_roles')
  if (disqualifiers.length === 0) missing.push('disqualifiers')
  if (missing.length > 0) throw new ICPSchemaError(slug, missing, 'tenant_framework')

  return {
    client_slug: slug,
    source: 'tenant_framework',
    primary_segment: {
      name: primary.name,
      target_roles: targetRoles,
      target_industries: targetIndustries,
      // not currently a field on ICPSegment; reserved for future
      target_company_sizes: arrayOrEmpty((primary as unknown as { targetCompanySizes?: unknown }).targetCompanySizes),
      target_geographies: primary.targetGeographies ?? [],
      disqualifiers,
      pain_points: primary.painPoints ?? [],
      voice: primary.voice?.tone,
      messaging: primary.messaging?.elevatorPitch,
    },
  }
}

/** Build ClientICP from a parsed yaml. Validates required fields. */
function clientICPFromYaml(slug: string, raw: unknown): ClientICP {
  if (!raw || typeof raw !== 'object') {
    throw new ICPSchemaError(slug, ['<root must be an object>'], 'repo_yaml')
  }
  const obj = raw as Record<string, unknown>
  const seg = (obj.primary_segment ?? {}) as Record<string, unknown>

  const target_industries = arrayOrEmpty(seg.target_industries)
  const target_roles = arrayOrEmpty(seg.target_roles)
  const disqualifiers = arrayOrEmpty(seg.disqualifiers)

  const missing: string[] = []
  if (target_industries.length === 0) missing.push('target_industries')
  if (target_roles.length === 0) missing.push('target_roles')
  if (disqualifiers.length === 0) missing.push('disqualifiers')
  if (missing.length > 0) throw new ICPSchemaError(slug, missing, 'repo_yaml')

  return {
    client_slug: typeof obj.client_slug === 'string' ? obj.client_slug : slug,
    source: 'repo_yaml',
    primary_segment: {
      name: typeof seg.name === 'string' ? seg.name : slug,
      target_roles,
      target_industries,
      target_company_sizes: arrayOrEmpty(seg.target_company_sizes),
      target_geographies: arrayOrEmpty(seg.target_geographies),
      disqualifiers,
      pain_points: arrayOrEmpty(seg.pain_points),
      voice: typeof seg.voice === 'string' ? seg.voice : undefined,
      messaging: typeof seg.messaging === 'string' ? seg.messaging : undefined,
    },
  }
}

function arrayOrEmpty(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}
