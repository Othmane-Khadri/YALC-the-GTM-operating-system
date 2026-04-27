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
      const text = await response.text()
      throw new Error(`Instantly API error (${response.status}): ${text}`)
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
