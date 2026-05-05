/**
 * Tenant ICP gate, used by every CLI command that operates on leads or
 * campaigns. Resolves the tenant's ICP and exits the process loud-and-early
 * when none is configured — qualification cannot run without per-tenant ICP
 * context, so neither can the upstream commands that produce or consume
 * qualified leads.
 *
 * Policy: all CLI surfaces that touch a tenant's leads or campaigns MUST call
 * `requireClientICP()` before doing anything else. There is no opt-out.
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
