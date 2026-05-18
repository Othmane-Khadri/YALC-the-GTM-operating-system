// Backfill the hypothesis + outbound copy on a campaign row that was created
// without them (typically: a campaign imported from an external tool like
// HeyReach where the public API doesn't expose the sequence/copy).
//
// Strategy / retro skills read copy from `campaign_variants` and the
// hypothesis from `campaigns.hypothesis`. When either is a placeholder,
// downstream skills lose the qualitative half of "what's been working."
// This command lets the operator paste the real values back in.

import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { campaignVariants, campaigns } from '../db/schema'

export interface AnnotateOptions {
  tenantId: string
  campaignId: string
  hypothesis?: string
  variantName?: string
  connectNote?: string
  dm1Template?: string
  dm2Template?: string
}

export interface AnnotateResult {
  campaignFound: boolean
  hypothesisUpdated: boolean
  variantUpdated: boolean
  variantCreated: boolean
  variantId: string | null
}

export async function annotateCampaign(opts: AnnotateOptions): Promise<AnnotateResult> {
  const result: AnnotateResult = {
    campaignFound: false,
    hypothesisUpdated: false,
    variantUpdated: false,
    variantCreated: false,
    variantId: null,
  }

  const existing = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.tenantId, opts.tenantId), eq(campaigns.id, opts.campaignId)))
    .limit(1)

  if (existing.length === 0) return result
  result.campaignFound = true

  if (opts.hypothesis) {
    await db
      .update(campaigns)
      .set({ hypothesis: opts.hypothesis, updatedAt: new Date().toISOString() })
      .where(and(eq(campaigns.tenantId, opts.tenantId), eq(campaigns.id, opts.campaignId)))
    result.hypothesisUpdated = true
  }

  const copyFields: Partial<{ connectNote: string; dm1Template: string; dm2Template: string; name: string }> = {}
  if (opts.connectNote !== undefined) copyFields.connectNote = opts.connectNote
  if (opts.dm1Template !== undefined) copyFields.dm1Template = opts.dm1Template
  if (opts.dm2Template !== undefined) copyFields.dm2Template = opts.dm2Template
  if (opts.variantName !== undefined) copyFields.name = opts.variantName

  if (Object.keys(copyFields).length > 0) {
    const variants = await db
      .select()
      .from(campaignVariants)
      .where(and(eq(campaignVariants.tenantId, opts.tenantId), eq(campaignVariants.campaignId, opts.campaignId)))
      .limit(1)
    if (variants.length > 0) {
      await db.update(campaignVariants).set(copyFields).where(eq(campaignVariants.id, variants[0].id))
      result.variantUpdated = true
      result.variantId = variants[0].id
    }
  }

  return result
}
