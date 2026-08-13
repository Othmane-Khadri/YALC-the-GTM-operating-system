import { randomUUID } from 'node:crypto'
import type { Client } from '@libsql/client'
import { instantlyService } from '../services/instantly'
import { listAllCampaigns } from '../services/heyreach'
import type { OutreachProvider } from './contracts'

export interface DiscoveredProviderCampaign {
  externalCampaignId: string
  externalName: string
  externalStatus: string | null
  /** Empty for providers that do not require sender-scoped reads. */
  senderAccountIds: string[]
}

export interface CampaignDiscovery {
  instantly(): Promise<DiscoveredProviderCampaign[]>
  heyreach(): Promise<DiscoveredProviderCampaign[]>
}

export interface CampaignLink {
  id: string
  campaignId: string
  senderAccountId: string | null
}

type MappingState = {
  link: CampaignLink
  firstMessageImportedAt: string | null
}

export interface CampaignLinkInput {
  tenantId: string
  provider: OutreachProvider
  externalCampaignId: string
  campaignId: string
  senderAccountId?: string | null
}

export type CampaignLinkResult =
  | { ok: true; created: boolean; link: CampaignLink }
  | { ok: false; error: 'campaign_not_found' | 'invalid_sender' | 'mapping_locked' | 'mapping_conflict' }

export const defaultCampaignDiscovery: CampaignDiscovery = {
  async instantly() {
    const campaigns = await instantlyService.listCampaigns()
    return campaigns.map((campaign) => ({
      externalCampaignId: campaign.id,
      externalName: campaign.name,
      externalStatus: campaign.status ?? null,
      senderAccountIds: [],
    }))
  },
  async heyreach() {
    const campaigns = await listAllCampaigns()
    return campaigns.map((campaign) => ({
      externalCampaignId: String(campaign.id),
      externalName: campaign.name,
      externalStatus: campaign.status ?? null,
      senderAccountIds: Array.isArray(campaign.campaignAccountIds)
        ? campaign.campaignAccountIds.map(String)
        : [],
    }))
  },
}

function exactString(value: string): boolean {
  return value.length > 0 && value === value.trim()
}

function parseLegacyHeyReachCampaignId(externalCampaignId: string): string | null {
  if (!/^[1-9]\d*$/.test(externalCampaignId)) return null
  return `heyreach:${externalCampaignId}`
}

function toLink(row: Record<string, unknown>): CampaignLink {
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    senderAccountId: typeof row.sender_account_id === 'string' ? row.sender_account_id : null,
  }
}

/**
 * Tenant-scoped exact provider-campaign mapping store. It deliberately has no
 * title lookup: presentation metadata can never create an association.
 */
export class CampaignLinkService {
  constructor(
    private readonly raw: Client,
    private readonly discovery: CampaignDiscovery = defaultCampaignDiscovery,
  ) {}

  async discover(tenantId: string, provider: OutreachProvider): Promise<Array<DiscoveredProviderCampaign & { link: CampaignLink | null }>> {
    const campaigns = await this.discovery[provider]()
    if (provider === 'heyreach') {
      for (const campaign of campaigns) {
        await this.adoptExactLegacyHeyReachCampaign(tenantId, campaign)
      }
    }

    const rows = await this.raw.execute({
      sql: `SELECT id, campaign_id, sender_account_id, external_campaign_id
        FROM campaign_provider_runs WHERE tenant_id = ? AND provider = ?`,
      args: [tenantId, provider],
    })
    const links = new Map<string, CampaignLink>()
    for (const row of rows.rows as Array<Record<string, unknown>>) {
      const externalCampaignId = typeof row.external_campaign_id === 'string' ? row.external_campaign_id : null
      if (externalCampaignId) links.set(externalCampaignId, toLink(row))
    }

    return campaigns.map((campaign) => ({ ...campaign, link: links.get(campaign.externalCampaignId) ?? null }))
  }

  async link(input: CampaignLinkInput): Promise<CampaignLinkResult> {
    if (!exactString(input.tenantId) || !exactString(input.externalCampaignId) || !exactString(input.campaignId)) {
      return { ok: false, error: 'campaign_not_found' }
    }

    const campaign = await this.raw.execute({
      sql: 'SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?',
      args: [input.campaignId, input.tenantId],
    })
    if (campaign.rows.length === 0) return { ok: false, error: 'campaign_not_found' }

    const discovered = await this.discovery[input.provider]()
    const providerCampaign = discovered.find((item) => item.externalCampaignId === input.externalCampaignId)
    if (!providerCampaign) return { ok: false, error: 'campaign_not_found' }

    const senderAccountId = this.validateSender(input.provider, input.senderAccountId, providerCampaign.senderAccountIds)
    if (senderAccountId === undefined) return { ok: false, error: 'invalid_sender' }

    const existingResult = await this.raw.execute({
      sql: `SELECT id, campaign_id, sender_account_id, first_message_imported_at
        FROM campaign_provider_runs
        WHERE tenant_id = ? AND provider = ? AND external_campaign_id = ?`,
      args: [input.tenantId, input.provider, input.externalCampaignId],
    })
    const existing = existingResult.rows[0] as Record<string, unknown> | undefined
    if (existing) {
      const prior = toLink(existing)
      if (prior.campaignId === input.campaignId && prior.senderAccountId === senderAccountId) {
        return { ok: true, created: false, link: prior }
      }
      if (existing.first_message_imported_at !== null && existing.first_message_imported_at !== undefined) {
        return { ok: false, error: 'mapping_locked' }
      }
      const reassigned = await this.raw.execute({
        sql: `UPDATE campaign_provider_runs
          SET campaign_id = ?, external_name = ?, external_status = ?, sender_account_id = ?, updated_at = datetime('now')
          WHERE id = ? AND tenant_id = ? AND provider = ? AND external_campaign_id = ?
            AND campaign_id = ?
            AND ((sender_account_id IS NULL AND ? IS NULL) OR sender_account_id = ?)
            AND first_message_imported_at IS NULL
          RETURNING id, campaign_id, sender_account_id`,
        args: [
          input.campaignId,
          providerCampaign.externalName,
          providerCampaign.externalStatus,
          senderAccountId,
          prior.id,
          input.tenantId,
          input.provider,
          input.externalCampaignId,
          prior.campaignId,
          prior.senderAccountId,
          prior.senderAccountId,
        ],
      })
      const updated = reassigned.rows[0] as Record<string, unknown> | undefined
      if (updated) return { ok: true, created: false, link: toLink(updated) }

      const current = await this.findMapping(input.tenantId, input.provider, input.externalCampaignId)
      if (current?.link.campaignId === input.campaignId && current.link.senderAccountId === senderAccountId) {
        return { ok: true, created: false, link: current.link }
      }
      return { ok: false, error: current?.firstMessageImportedAt ? 'mapping_locked' : 'mapping_conflict' }
    }

    const id = randomUUID()
    const inserted = await this.raw.execute({
      sql: `INSERT OR IGNORE INTO campaign_provider_runs
        (id, tenant_id, campaign_id, provider, external_campaign_id, external_name, external_status, sender_account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.tenantId,
        input.campaignId,
        input.provider,
        input.externalCampaignId,
        providerCampaign.externalName,
        providerCampaign.externalStatus,
        senderAccountId,
      ],
    })
    const current = await this.findMapping(input.tenantId, input.provider, input.externalCampaignId)
    if (!current) return { ok: false, error: 'mapping_conflict' }
    if (current.link.campaignId === input.campaignId && current.link.senderAccountId === senderAccountId) {
      return { ok: true, created: inserted.rowsAffected > 0, link: current.link }
    }
    return { ok: false, error: 'mapping_conflict' }
  }

  private validateSender(
    provider: OutreachProvider,
    requestedSenderAccountId: string | null | undefined,
    senderAccountIds: string[],
  ): string | null | undefined {
    if (provider === 'instantly') return null
    if (typeof requestedSenderAccountId !== 'string' || !exactString(requestedSenderAccountId)) return undefined
    return senderAccountIds.includes(requestedSenderAccountId) ? requestedSenderAccountId : undefined
  }

  private async adoptExactLegacyHeyReachCampaign(tenantId: string, campaign: DiscoveredProviderCampaign): Promise<void> {
    const legacyId = parseLegacyHeyReachCampaignId(campaign.externalCampaignId)
    if (!legacyId) return

    const local = await this.raw.execute({
      sql: 'SELECT id, linkedin_account_id FROM campaigns WHERE id = ? AND tenant_id = ?',
      args: [legacyId, tenantId],
    })
    const row = local.rows[0] as Record<string, unknown> | undefined
    const senderAccountId = typeof row?.linkedin_account_id === 'string' ? row.linkedin_account_id : null
    if (!row || !senderAccountId || !campaign.senderAccountIds.includes(senderAccountId)) return

    await this.raw.execute({
      sql: `INSERT OR IGNORE INTO campaign_provider_runs
        (id, tenant_id, campaign_id, provider, external_campaign_id, external_name, external_status, sender_account_id)
        VALUES (?, ?, ?, 'heyreach', ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        tenantId,
        legacyId,
        campaign.externalCampaignId,
        campaign.externalName,
        campaign.externalStatus,
        senderAccountId,
      ],
    })
  }

  private async findMapping(tenantId: string, provider: OutreachProvider, externalCampaignId: string): Promise<MappingState | null> {
    const result = await this.raw.execute({
      sql: `SELECT id, campaign_id, sender_account_id, first_message_imported_at
        FROM campaign_provider_runs
        WHERE tenant_id = ? AND provider = ? AND external_campaign_id = ?`,
      args: [tenantId, provider, externalCampaignId],
    })
    const row = result.rows[0] as Record<string, unknown> | undefined
    return row
      ? {
          link: toLink(row),
          firstMessageImportedAt: typeof row.first_message_imported_at === 'string' ? row.first_message_imported_at : null,
        }
      : null
  }
}
