/** Provider-neutral, read-only boundary for outreach inbox imports. */
export type OutreachProvider = 'heyreach' | 'instantly'
export type OutreachChannel = 'linkedin' | 'email'
export type MessageDirection = 'inbound' | 'outbound'
export type MessageKind = 'campaign_automated' | 'human' | 'auto_reply' | 'unknown'

export interface ProviderCampaign {
  externalCampaignId: string
  externalName: string
  externalStatus: string | null
}

export interface NormalizedMessage {
  channel: OutreachChannel
  externalMessageId: string | null
  externalThreadId: string
  externalIdentityId: string | null
  email: string | null
  linkedinUrl: string | null
  direction: MessageDirection
  kind: MessageKind
  subject: string | null
  bodyText: string
  providerTimestamp: string
}

export interface ReadMessagePageInput {
  externalCampaignId: string
  cursor: string | null
  pageSize?: number
}

/** Aggregate-only import accounting: never carries provider record content. */
export interface ReadMessagePageNormalization {
  imported: number
  malformed: number
  mismatched: number
}

export interface ReadMessagePageResult {
  messages: NormalizedMessage[]
  nextCursor: string | null
  normalization: ReadMessagePageNormalization
}

/**
 * This intentionally exposes no transport or mutation method. Providers can
 * discover campaigns and read pages only; write authorization is a separate
 * boundary that this contract cannot reach.
 */
export interface OutreachReadAdapter {
  readonly provider: OutreachProvider
  discoverCampaigns(): Promise<ProviderCampaign[]>
  readMessagePage(input: ReadMessagePageInput): Promise<ReadMessagePageResult>
}
