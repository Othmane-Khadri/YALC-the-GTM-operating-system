// ─── Instantly.ai Service ──────────────────────────────────────────────────
// Singleton wrapper for Instantly REST API v2.
// Pattern: mirrors src/lib/services/unipile.ts

const BASE_URL = 'https://api.instantly.ai'

/** Required env vars for the Instantly provider. */
export const envVarSchema = {
  INSTANTLY_API_KEY: { minLength: 20 },
} as const

// ─── Types ─────────────────────────────────────────────────────────────────

export interface InstantlyCampaign {
  id: string
  name: string
  status: string
  created_at?: string
  updated_at?: string
}

export interface InstantlyLead {
  email: string
  first_name?: string
  last_name?: string
  company_name?: string
  title?: string
  custom_variables?: Record<string, string>
}

export interface InstantlyEmailAccount {
  id: string
  email: string
  status: string
}

export interface CampaignAnalytics {
  campaign_id: string
  total_leads: number
  contacted: number
  emails_sent: number
  emails_read: number
  replies: number
  bounced: number
}

export interface CreateCampaignOpts {
  name: string
  account_ids?: string[]
  sequences?: SequenceStep[]
  schedule?: {
    timezone?: string
    days?: Record<string, { start: string; end: string }>
  }
}

export interface SequenceStep {
  subject?: string
  body: string
  delay_days?: number
  variant_label?: string
}

export interface LeadStatus {
  email: string
  status: string // 'active' | 'completed' | 'unsubscribed' | 'bounced' | 'interested'
  lead_id?: string
  opened_at?: string
  replied_at?: string
  bounced_at?: string
}

export interface InstantlyEmail {
  id?: string | null
  campaign_id?: string | null
  thread_id?: string | null
  timestamp_created?: string | null
  timestamp_email?: string | null
  message_id?: string | null
  subject?: string | null
  body?: {
    text?: string | null
    html?: string | null
  } | null
  lead?: string | null
  lead_id?: string | null
  from_address_email?: string | null
  ue_type?: number | null
  is_auto_reply?: number | boolean | null
  email_type?: 'received' | 'sent' | 'manual' | string | null
}

export interface InstantlyEmailList {
  items?: InstantlyEmail[]
  next_starting_after?: string | null
}

/** @deprecated Retained for the established inbox-replies capability only. */
export interface InboxReply {
  id?: string
  campaign_id?: string
  lead_email?: string
  from_email?: string
  to_email?: string
  subject?: string
  body?: string
  body_text?: string
  received_at?: string
  thread_id?: string
}

/** HTTP metadata only; provider response bodies must never cross this boundary. */
export class InstantlyProviderError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Instantly API request failed (${status})`)
    this.name = 'InstantlyProviderError'
    this.status = status
  }
}

// ─── Service ───────────────────────────────────────────────────────────────

export class InstantlyService {
  isAvailable(): boolean {
    return !!process.env.INSTANTLY_API_KEY
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const apiKey = process.env.INSTANTLY_API_KEY
    if (!apiKey) throw new Error('INSTANTLY_API_KEY environment variable must be set')

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      throw new InstantlyProviderError(response.status)
    }
    return response.json() as T
  }

  // ─── Campaigns ─────────────────────────────────────────────────────────

  async createCampaign(opts: CreateCampaignOpts): Promise<InstantlyCampaign> {
    return this.request<InstantlyCampaign>('POST', '/api/v2/campaigns', opts)
  }

  async getCampaign(campaignId: string): Promise<InstantlyCampaign> {
    return this.request<InstantlyCampaign>('GET', `/api/v2/campaigns/${campaignId}`)
  }

  async listCampaigns(): Promise<InstantlyCampaign[]> {
    const res = await this.request<{ items?: InstantlyCampaign[] }>('GET', '/api/v2/campaigns')
    return res.items ?? []
  }

  async pauseCampaign(campaignId: string): Promise<void> {
    await this.request('POST', `/api/v2/campaigns/${campaignId}/pause`)
  }

  async resumeCampaign(campaignId: string): Promise<void> {
    await this.request('POST', `/api/v2/campaigns/${campaignId}/resume`)
  }

  // ─── Leads ─────────────────────────────────────────────────────────────

  async addLeadsToCampaign(campaignId: string, leads: InstantlyLead[]): Promise<void> {
    // Instantly accepts up to 1000 leads per bulk call
    const BATCH_SIZE = 1000
    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
      const batch = leads.slice(i, i + BATCH_SIZE)
      await this.request('POST', '/api/v2/leads/bulk', {
        campaign_id: campaignId,
        leads: batch,
      })
    }
  }

  async listLeads(campaignId: string, limit = 100): Promise<LeadStatus[]> {
    // Note: Instantly uses POST for listing leads (non-standard)
    const res = await this.request<{ items?: LeadStatus[] }>('POST', '/api/v2/leads/list', {
      campaign_id: campaignId,
      limit,
    })
    return res.items ?? []
  }

  async getLeadStatus(leadId: string): Promise<LeadStatus> {
    return this.request<LeadStatus>('GET', `/api/v2/leads/${leadId}`)
  }

  // ─── Email Accounts ────────────────────────────────────────────────────

  async listEmailAccounts(): Promise<InstantlyEmailAccount[]> {
    const res = await this.request<{ items?: InstantlyEmailAccount[] }>('GET', '/api/v2/accounts')
    return res.items ?? []
  }

  // ─── Campaign emails ──────────────────────────────────────────────────

  /**
   * Read one campaign-scoped page of emails from Instantly's official v2
   * endpoint. Pagination is deliberately caller-owned.
   */
  async listCampaignEmails(input: {
    campaignId: string
    startingAfter?: string | null
    limit?: number
    minTimestampCreated?: string | null
  }): Promise<{ items: InstantlyEmail[]; nextStartingAfter: string | null }> {
    const params = new URLSearchParams({
      campaign_id: input.campaignId,
      limit: String(Math.min(Math.max(input.limit ?? 100, 1), 100)),
    })
    if (input.startingAfter) params.set('starting_after', input.startingAfter)
    if (input.minTimestampCreated) params.set('min_timestamp_created', input.minTimestampCreated)
    const page = await this.request<InstantlyEmailList>('GET', `/api/v2/emails?${params}`)
    return { items: page.items ?? [], nextStartingAfter: page.next_starting_after ?? null }
  }

  /**
   * @deprecated The established public inbox-replies capability still depends
   * on this legacy endpoint. New outreach imports must use listCampaignEmails.
   */
  async listInboxReplies(opts: { lookbackHours: number; limit?: number }): Promise<InboxReply[]> {
    const limit = opts.limit ?? 100
    const cutoffMs = Date.now() - opts.lookbackHours * 3_600_000
    const since = new Date(cutoffMs).toISOString()
    const res = await this.request<{ items?: InboxReply[] }>(
      'GET',
      `/api/v2/unibox/emails?direction=inbound&since=${encodeURIComponent(since)}&limit=${limit}`,
    )
    return res.items ?? []
  }

  // ─── Analytics ─────────────────────────────────────────────────────────

  async getCampaignAnalytics(campaignId: string): Promise<CampaignAnalytics> {
    const res = await this.request<{ items?: CampaignAnalytics[] }>(
      'GET',
      `/api/v2/campaigns/analytics?campaign_id=${campaignId}`
    )
    const items = res.items ?? []
    return items[0] ?? {
      campaign_id: campaignId,
      total_leads: 0,
      contacted: 0,
      emails_sent: 0,
      emails_read: 0,
      replies: 0,
      bounced: 0,
    }
  }
}

export const instantlyService = new InstantlyService()
