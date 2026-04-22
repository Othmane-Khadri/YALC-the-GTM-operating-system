/**
 * Slack Confirmation for Ambiguous Dedup Matches
 *
 * When a fuzzy match has confidence in the configurable range (default 60-80%):
 *   - Posts to Slack with match details
 *   - Waits for reaction (configurable timeout, default 1h)
 *   - If no response, defaults to "keep both" (safe default)
 *   - Lead gets dedup_status: 'pending_review' while waiting
 */

import type { LeadRecord, DedupMatch, SlackConfirmAction, SlackConfirmResult } from './types'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SlackConfirmOptions {
  webhookUrl: string
  channel?: string
  timeoutMs?: number
  defaultAction?: SlackConfirmAction
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatLeadName(lead: LeadRecord): string {
  const first = lead.first_name ?? lead.firstName ?? ''
  const last = lead.last_name ?? lead.lastName ?? ''
  return `${first} ${last}`.trim() || 'Unknown'
}

function formatLeadEmail(lead: LeadRecord): string {
  return lead.email ?? ''
}

function formatMatchSource(match: DedupMatch): string {
  const sourceLabels: Record<string, string> = {
    campaign_active: 'Active Campaign',
    campaign_replied: 'Replied Lead',
    crm: 'CRM',
    blocklist: 'Blocklist',
    notion: 'Notion',
    csv: 'Imported CSV',
  }
  return sourceLabels[match.matchedSource] || match.matchedSource
}

// ─── Build Slack Message ────────────────────────────────────────────────────

export function buildConfirmationBlocks(
  lead: LeadRecord,
  match: DedupMatch,
): Record<string, unknown>[] {
  const leadName = formatLeadName(lead)
  const leadEmail = formatLeadEmail(lead)
  const matchSource = formatMatchSource(match)

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Potential Duplicate Found (${match.confidence}% confidence)`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*New Lead:*\n${leadName}${leadEmail ? ` (${leadEmail})` : ''}`,
        },
        {
          type: 'mrkdwn',
          text: `*Matched With:*\n${match.matchedField}`,
        },
        {
          type: 'mrkdwn',
          text: `*Match Type:*\n${match.matcher.replace(/_/g, ' ')}`,
        },
        {
          type: 'mrkdwn',
          text: `*Source:*\n${matchSource}`,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'React: :white_check_mark: Merge | :x: Keep Both | :track_next: Skip',
        },
      ],
    },
  ]
}

// ─── Send Confirmation ──────────────────────────────────────────────────────

export async function sendConfirmation(
  lead: LeadRecord,
  match: DedupMatch,
  options: SlackConfirmOptions,
): Promise<void> {
  const blocks = buildConfirmationBlocks(lead, match)

  try {
    await fetch(options.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    })
    console.log(`[dedup] Slack confirmation sent for ${formatLeadName(lead)}`)
  } catch (err) {
    console.error(`[dedup] Failed to send Slack confirmation: ${err instanceof Error ? err.message : err}`)
  }
}

// ─── Resolve Pending (batch) ────────────────────────────────────────────────

/**
 * For leads pending Slack review, apply the default action.
 * In a real implementation this would poll Slack reactions.
 * For now, after timeout, defaults to "keep_both" (safe default).
 */
export function resolveTimeout(
  pendingLeadIds: string[],
  defaultAction: SlackConfirmAction = 'keep_both',
): SlackConfirmResult[] {
  return pendingLeadIds.map(id => ({
    leadId: id,
    action: defaultAction,
    respondedAt: new Date().toISOString(),
  }))
}
