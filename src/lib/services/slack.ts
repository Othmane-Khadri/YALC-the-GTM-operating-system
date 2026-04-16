import type { SlackConfig } from '../config/types'

let slackConfig: SlackConfig | undefined

export function setSlackConfig(config: SlackConfig | undefined) {
  slackConfig = config
}

export async function sendSlackNotification(
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!slackConfig?.webhook_url) return
  if (!slackConfig.notify_on.includes(event)) return

  const blocks = buildSlackBlocks(event, data)

  try {
    await fetch(slackConfig.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    })
  } catch (err) {
    console.error(`[slack] Failed to send notification for ${event}:`, err)
  }
}

function buildSlackBlocks(event: string, data: Record<string, unknown>) {
  const campaignName = (data.campaignTitle as string) || (data.campaignId as string) || 'Unknown'
  const leadName = (data.leadName as string) || ''
  const dashboardUrl = `http://localhost:3847/campaigns/${data.campaignId || ''}`

  const titles: Record<string, string> = {
    reply: '💬 Lead Replied',
    demo_booked: '📅 Demo Booked',
    deal_created: '🤝 Deal Created',
    closed_won: '🎉 Closed Won!',
    closed_lost: '❌ Closed Lost',
    campaign_completed: '✅ Campaign Completed',
    winner_declared: '🏆 Variant Winner Declared',
  }

  const title = titles[event] || `Campaign Event: ${event}`

  const fields = []
  if (campaignName) fields.push({ type: 'mrkdwn' as const, text: `*Campaign:*\n${campaignName}` })
  if (leadName) fields.push({ type: 'mrkdwn' as const, text: `*Lead:*\n${leadName}` })
  if (data.newStatus) fields.push({ type: 'mrkdwn' as const, text: `*New Status:*\n${data.newStatus}` })
  if (data.oldStatus) fields.push({ type: 'mrkdwn' as const, text: `*Previous:*\n${data.oldStatus}` })
  if (data.replyPreview) fields.push({ type: 'mrkdwn' as const, text: `*Reply:*\n${(data.replyPreview as string).substring(0, 200)}` })

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: title },
    },
    ...(fields.length > 0
      ? [{ type: 'section', fields }]
      : []),
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View in Dashboard' },
          url: dashboardUrl,
        },
      ],
    },
  ]
}
