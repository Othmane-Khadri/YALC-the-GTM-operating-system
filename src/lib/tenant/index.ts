/**
 * Tenant resolver — Phase 1 / A2.
 *
 * Precedence (highest first):
 *   1. Explicit `cliFlag` argument (from Commander `--tenant <slug>`)
 *   2. `GTM_OS_TENANT` env var
 *   3. `.gtm-os-tenant` file in cwd (single-line slug, trimmed)
 *   4. Default `'default'` (so single-tenant invocations keep working)
 *
 * Slugs are validated: lowercase letters, digits, hyphens only.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_TENANT = 'default'
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

export interface ResolveOpts {
  cliFlag?: string | null | undefined
  env?: NodeJS.ProcessEnv
  cwd?: string
}

export function resolveTenant(opts: ResolveOpts = {}): string {
  const env = opts.env ?? process.env
  const cwd = opts.cwd ?? process.cwd()

  const candidates: Array<{ source: string; value: string | undefined }> = [
    { source: 'cli',  value: opts.cliFlag ?? undefined },
    { source: 'env',  value: env.GTM_OS_TENANT },
    { source: 'file', value: readTenantFile(cwd) },
  ]

  for (const { source, value } of candidates) {
    if (!value) continue
    const slug = value.trim()
    if (!slug) continue
    if (!SLUG_RE.test(slug)) {
      throw new Error(
        `Invalid tenant slug from ${source}: "${slug}". ` +
          `Slugs must be lowercase letters, digits, or hyphens.`,
      )
    }
    return slug
  }

  return DEFAULT_TENANT
}

function readTenantFile(cwd: string): string | undefined {
  const path = join(cwd, '.gtm-os-tenant')
  if (!existsSync(path)) return undefined
  try {
    return readFileSync(path, 'utf8').split('\n')[0]
  } catch {
    return undefined
  }
}

/** Where per-tenant config (framework.yaml, adapters.yaml, notion.yaml) lives. */
export function tenantConfigDir(tenantId: string, home = process.env.HOME ?? ''): string {
  return join(home, '.gtm-os', 'tenants', tenantId)
}
