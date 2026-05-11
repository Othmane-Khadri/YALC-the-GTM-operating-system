/**
 * Slack channel sender for gate notifications (D2).
 *
 * Posts a minimal `{ text }` payload to a Slack incoming-webhook URL. The
 * message body is the awaiting gate's `prompt` field followed by a link to
 * `<base>/today` so the user can act immediately.
 *
 * Non-2xx responses log via `console.error` and re-throw so the dispatcher
 * can fall back to other channels and surface the error to the operator.
 */

import type { SlackSendArgs } from './types.js'

export async function sendSlackNotification(args: SlackSendArgs): Promise<void> {
  const { webhookUrl, baseUrl, kind, gate } = args
  const todayUrl = `${baseUrl.replace(/\/+$/, '')}/today`
  const prefix = kind === 'stale' ? ':hourglass_flowing_sand: Stale gate' : ':bell: Awaiting gate'
  const text = [
    `${prefix} — *${gate.framework}* / \`${gate.gate_id}\``,
    '',
    gate.prompt,
    '',
    `Open: ${todayUrl}`,
  ].join('\n')

  let response: Response
  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    // Network-layer failure (DNS, refused). Log and re-throw for the caller.
    // eslint-disable-next-line no-console
    console.error(
      `[notifications/slack] Network error posting to webhook: ${err instanceof Error ? err.message : String(err)}`,
    )
    throw err
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const message = `[notifications/slack] Webhook returned ${response.status}: ${body.slice(0, 200)}`
    // eslint-disable-next-line no-console
    console.error(message)
    throw new Error(`slack webhook ${response.status}`)
  }
}
