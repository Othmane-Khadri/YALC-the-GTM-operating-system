import { instantlyService, type InstantlyEmail } from '../../services/instantly'
import type {
  MessageDirection,
  MessageKind,
  NormalizedMessage,
  OutreachReadAdapter,
  ProviderCampaign,
  ReadMessagePageInput,
  ReadMessagePageResult,
} from '../contracts'
import { toSafeProviderError, type SafeProviderError } from '../errors'
import { normalizeEmail } from '../identity'

export interface InstantlyCampaignEmailReader {
  listCampaignEmails(input: {
    campaignId: string
    startingAfter?: string | null
    limit?: number
    minTimestampCreated?: string | null
  }): Promise<{ items: InstantlyEmail[]; nextStartingAfter: string | null }>
}

type MessageClassification = {
  direction: MessageDirection
  kind: MessageKind
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function optionalString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  return nonEmptyString(value) ?? undefined
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

function classify(email: InstantlyEmail): MessageClassification | null {
  switch (email.ue_type) {
    case 1:
    case 4:
      return { direction: 'outbound', kind: 'campaign_automated' }
    case 2:
      return {
        direction: 'inbound',
        kind: email.is_auto_reply === 1 || email.is_auto_reply === true ? 'auto_reply' : 'human',
      }
    case 3:
      return { direction: 'outbound', kind: 'human' }
    default:
      return email.email_type === 'sent' || email.email_type === 'manual'
        ? { direction: 'outbound', kind: 'unknown' }
        : null
  }
}

function normalizeCampaignEmail(
  email: InstantlyEmail,
): NormalizedMessage | null {
  const externalThreadId = nonEmptyString(email.thread_id)
  const providerTimestamp = isTimestamp(email.timestamp_created) ? email.timestamp_created : null
  const classification = classify(email)
  const externalMessageId = optionalString(email.id)
  const externalIdentityId = optionalString(email.lead_id)
  const subject = optionalString(email.subject)
  const bodyText = email.body?.text
  const rawEmail = email.lead ?? email.from_address_email
  const normalizedEmail = rawEmail === null || rawEmail === undefined ? null : normalizeEmail(rawEmail)

  if (
    !externalThreadId ||
    !providerTimestamp ||
    !classification ||
    externalMessageId === undefined ||
    externalIdentityId === undefined ||
    subject === undefined ||
    typeof bodyText !== 'string' ||
    normalizedEmail === null && rawEmail !== null && rawEmail !== undefined
  ) {
    return null
  }

  return {
    channel: 'email',
    externalMessageId,
    externalThreadId,
    externalIdentityId,
    email: normalizedEmail,
    linkedinUrl: null,
    direction: classification.direction,
    kind: classification.kind,
    subject,
    bodyText,
    providerTimestamp,
  }
}

/**
 * Deliberately retains only the shared safe provider projection. The source
 * error is neither stored nor attached as a cause because it can contain a
 * provider body, URL, or credentials.
 */
export class InstantlyOutreachReadError extends Error {
  readonly safeError: SafeProviderError

  constructor(safeError: SafeProviderError) {
    super(`Instantly outreach read failed: ${safeError.category}`)
    this.name = 'InstantlyOutreachReadError'
    this.safeError = safeError
  }
}

/** Read-only, campaign-scoped adapter for Instantly email timelines. */
export class InstantlyOutreachReadAdapter implements OutreachReadAdapter {
  readonly provider = 'instantly' as const

  constructor(private readonly reader: InstantlyCampaignEmailReader = instantlyService) {}

  async discoverCampaigns(): Promise<ProviderCampaign[]> {
    const campaigns = await instantlyService.listCampaigns()
    return campaigns.map((campaign) => ({
      externalCampaignId: campaign.id,
      externalName: campaign.name,
      externalStatus: campaign.status ?? null,
    }))
  }

  async readMessagePage(input: ReadMessagePageInput): Promise<ReadMessagePageResult> {
    let page: Awaited<ReturnType<InstantlyCampaignEmailReader['listCampaignEmails']>>
    try {
      page = await this.reader.listCampaignEmails({
        campaignId: input.externalCampaignId,
        startingAfter: input.cursor,
        limit: Math.min(Math.max(input.pageSize ?? 100, 1), 100),
        minTimestampCreated: input.watermark ?? null,
      })
    } catch (error) {
      throw new InstantlyOutreachReadError(toSafeProviderError(error))
    }

    const messages: NormalizedMessage[] = []
    let malformed = 0
    let mismatched = 0
    for (const email of page.items) {
      if (email.campaign_id !== input.externalCampaignId) {
        mismatched += 1
        continue
      }
      const normalized = normalizeCampaignEmail(email)
      if (normalized) messages.push(normalized)
      else malformed += 1
    }

    return {
      messages,
      nextCursor: page.nextStartingAfter,
      normalization: { imported: messages.length, malformed, mismatched },
    }
  }
}
