/**
 * Tenant ICP gate, used by every CLI command that operates on leads or
 * campaigns.
 *
 * Two flavors:
 *   - `requireClientICP()` — hard gate. Exits the process loud-and-early when
 *     no ICP is configured. Use on any path that ends in qualification, since
 *     qualification cannot run without per-tenant ICP context.
 *   - `warnIfMissingClientICP()` — soft gate. Returns null and prints a
 *     warning. Use on standalone enrichment/scrape paths that are valid even
 *     without a tenant in mind (e.g. scraping a post just to study its
 *     engagers).
 *
 * Policy: every command that produces leads for a campaign uses the hard gate.
 * Standalone scrape/research commands use the soft gate.
 */

import { resolveClientICP, ICPSchemaError } from './icp-source'
import type { ClientICP } from './types'

/**
 * Resolve and validate the client ICP for a tenant. On any failure, prints
 * actionable instructions and exits the process.
 */
export async function requireClientICP(commandTag: string, tenantId: string): Promise<ClientICP> {
  let icp: ClientICP | null = null
  try {
    icp = await resolveClientICP(tenantId)
  } catch (err) {
    if (err instanceof ICPSchemaError) {
      console.error(`[${commandTag}] FATAL: ICP schema invalid for tenant '${tenantId}'.`)
      console.error(`  Source: ${err.source}`)
      console.error(`  Missing fields: ${err.missingFields.join(', ')}`)
      console.error(`  Required: target_industries, target_roles, disqualifiers`)
      process.exit(1)
    }
    throw err
  }
  if (!icp) {
    console.error(`[${commandTag}] FATAL: no ICP configured for tenant '${tenantId}'.`)
    console.error(`  Every command that touches leads or campaigns requires per-tenant ICP context — without it, qualification cannot run and lead lists will admit off-ICP prospects.`)
    console.error(`  Fix one of:`)
    console.error(`    1) Run 'yalc-gtm start' (or '/icp-import') to populate ~/.gtm-os/tenants/${tenantId}/framework.yaml`)
    console.error(`    2) Create clients/${tenantId}.yml in the repo with: target_industries, target_roles, disqualifiers`)
    process.exit(1)
  }
  console.log(`[${commandTag}] ICP loaded for '${tenantId}' (source: ${icp.source})`)
  return icp
}

/**
 * Soft variant: tries to resolve the ICP, returns null and warns if missing.
 * Schema errors (ICP exists but is malformed) still exit hard, since that's
 * a configuration bug the operator needs to see.
 */
export async function warnIfMissingClientICP(commandTag: string, tenantId: string): Promise<ClientICP | null> {
  let icp: ClientICP | null = null
  try {
    icp = await resolveClientICP(tenantId)
  } catch (err) {
    if (err instanceof ICPSchemaError) {
      console.error(`[${commandTag}] FATAL: ICP schema invalid for tenant '${tenantId}'.`)
      console.error(`  Source: ${err.source}`)
      console.error(`  Missing fields: ${err.missingFields.join(', ')}`)
      console.error(`  Required: target_industries, target_roles, disqualifiers`)
      process.exit(1)
    }
    throw err
  }
  if (!icp) {
    console.warn(`[${commandTag}] WARN: no ICP configured for tenant '${tenantId}'.`)
    console.warn(`  Continuing because this command can run standalone, but downstream qualify will fail until ICP is set up:`)
    console.warn(`    1) Run 'yalc-gtm start' (or '/icp-import') for ~/.gtm-os/tenants/${tenantId}/framework.yaml`)
    console.warn(`    2) Or create clients/${tenantId}.yml with: target_industries, target_roles, disqualifiers`)
    return null
  }
  console.log(`[${commandTag}] ICP loaded for '${tenantId}' (source: ${icp.source})`)
  return icp
}
