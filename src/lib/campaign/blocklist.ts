/**
 * Campaign blocklist — Phase 2 / P2.2.
 *
 * Hard pre-send gate that enforces the outbound blocklist rule:
 *   "Never DM prospects who already replied."
 *
 * `hasReplied(tenantId, ident, opts?)` returns true when ANY of the
 * following are true for the given tenant:
 *   1. A row in `campaign_leads` with a matching provider id / LinkedIn
 *      URL / email has `replied_at != null` or `email_replied_at != null`.
 *   2. A row in `lead_blocklist` with scope='permanent' matches the
 *      identifier (any field set).
 *   3. A row in `lead_blocklist` with scope='campaign' AND campaign_id
 *      matching the `campaignId` option matches the identifier.
 *
 * All reads are scoped by tenant. The function short-circuits on the
 * first hit to keep hot-path sends fast.
 */

import { eq, and, or, isNotNull } from 'drizzle-orm'
import { db } from '../db/index.js'
import { campaignLeads, leadBlocklist } from '../db/schema.js'

export interface BlocklistIdent {
  providerId?: string | null
  linkedinUrl?: string | null
  email?: string | null
}

export interface BlocklistOpts {
  /** When set, a `scope='campaign'` blocklist row matching this id also blocks. */
  campaignId?: string | null
}

function hasAnyIdent(ident: BlocklistIdent): boolean {
  return !!(ident.providerId || ident.linkedinUrl || ident.email)
}

/**
 * Returns true if a send to this prospect must be blocked. Never throws;
 * on DB failure it logs and returns `false` (fail-open) so a transient
 * outage can't freeze the whole tracker.
 */
export async function hasReplied(
  tenantId: string,
  ident: BlocklistIdent,
  opts: BlocklistOpts = {},
): Promise<boolean> {
  if (!hasAnyIdent(ident)) return false

  try {
    // 1. Historic reply across any campaign for this tenant.
    const leadClauses = []
    if (ident.providerId) leadClauses.push(eq(campaignLeads.providerId, ident.providerId))
    if (ident.linkedinUrl) leadClauses.push(eq(campaignLeads.linkedinUrl, ident.linkedinUrl))
    if (ident.email) leadClauses.push(eq(campaignLeads.email, ident.email))
    if (leadClauses.length > 0) {
      const leadRepliedOr = or(
        isNotNull(campaignLeads.repliedAt),
        isNotNull(campaignLeads.emailRepliedAt),
      )
      const rows = await db
        .select({ id: campaignLeads.id })
        .from(campaignLeads)
        .where(
          and(
            eq(campaignLeads.tenantId, tenantId),
            or(...leadClauses),
            leadRepliedOr,
          ),
        )
        .limit(1)
      if (rows.length > 0) return true
    }

    // 2/3. Explicit blocklist rows (permanent OR campaign-scoped).
    const blockIdentClauses = []
    if (ident.providerId) blockIdentClauses.push(eq(leadBlocklist.providerId, ident.providerId))
    if (ident.linkedinUrl) blockIdentClauses.push(eq(leadBlocklist.linkedinUrl, ident.linkedinUrl))
    if (blockIdentClauses.length === 0) return false

    const scopeClause = opts.campaignId
      ? or(
          eq(leadBlocklist.scope, 'permanent'),
          and(
            eq(leadBlocklist.scope, 'campaign'),
            eq(leadBlocklist.campaignId, opts.campaignId),
          ),
        )
      : eq(leadBlocklist.scope, 'permanent')

    const blockRows = await db
      .select({ id: leadBlocklist.id })
      .from(leadBlocklist)
      .where(
        and(
          eq(leadBlocklist.tenantId, tenantId),
          or(...blockIdentClauses),
          scopeClause,
        ),
      )
      .limit(1)
    return blockRows.length > 0
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[blocklist] hasReplied(${tenantId}) lookup failed; allowing send (fail-open):`,
      err,
    )
    return false
  }
}
