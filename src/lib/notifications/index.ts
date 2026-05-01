/**
 * Gate notifications dispatcher (D2).
 *
 * Two entry points:
 *   - `notifyAwaitingGate(gate)` — called by the runner immediately after
 *     it persists an awaiting-gate sentinel.
 *   - `notifyStaleGate(gate)` — called when a gate first crosses the
 *     `STALE_BADGE_THRESHOLD` (80%) of its timeout window.
 *
 * Both are best-effort and idempotent. A flag file under
 * `~/.gtm-os/notifications/` records that we have already notified for the
 * (gate, kind) pair, so subsequent ticks do nothing.
 *
 * Channels (Slack / desktop) are independently enabled via the
 * `notifications:` block in `~/.gtm-os/config.yaml`. Slack additionally
 * requires `YALC_SLACK_WEBHOOK_URL`; the dashboard URL falls back to
 * `http://localhost:3847` when `YALC_BASE_URL` is unset.
 */

import type { AwaitingGateRecord } from '../frameworks/runner.js'
import { loadNotificationsConfig } from './config.js'
import { hasNotified, markNotified } from './idempotency.js'
import { sendSlackNotification } from './slack.js'
import { sendDesktopNotification } from './desktop.js'
import type {
  NotificationKind,
  NotifyOptions,
  SlackSendArgs,
  DesktopSendArgs,
} from './types.js'

export {
  __resetIdempotencyForTests,
  hasNotified,
  markNotified,
  flagPath,
  notificationsDir,
} from './idempotency.js'
export { loadNotificationsConfig, defaultNotificationsConfig } from './config.js'
export { sendSlackNotification } from './slack.js'
export { sendDesktopNotification, __resetDesktopWarnedForTests } from './desktop.js'
export type { NotificationsConfig, NotificationKind, NotifyOptions } from './types.js'

const DEFAULT_BASE_URL = 'http://localhost:3847'

function resolveBaseUrl(): string {
  const env = process.env.YALC_BASE_URL
  if (typeof env === 'string' && env.trim()) return env.trim()
  return DEFAULT_BASE_URL
}

function buildDesktopBody(gate: AwaitingGateRecord, kind: NotificationKind): {
  title: string
  body: string
} {
  const title =
    kind === 'stale'
      ? `YALC — Stale gate (${gate.framework})`
      : `YALC — Gate awaiting (${gate.framework})`
  // Keep the body concise; macOS truncates long notifications anyway.
  const body = gate.prompt.length > 240 ? `${gate.prompt.slice(0, 237)}...` : gate.prompt
  return { title, body }
}

async function dispatch(
  gate: AwaitingGateRecord,
  kind: NotificationKind,
  opts: NotifyOptions = {},
): Promise<void> {
  if (hasNotified(gate, kind)) return

  const platform = opts.platform ?? process.platform
  const config = loadNotificationsConfig(platform)
  const slackSender = opts.slackSender ?? sendSlackNotification
  const desktopSender = opts.desktopSender ?? sendDesktopNotification

  const tasks: Promise<void>[] = []

  if (config.slack) {
    const webhookUrl = process.env.YALC_SLACK_WEBHOOK_URL
    if (webhookUrl && webhookUrl.trim()) {
      const args: SlackSendArgs = {
        webhookUrl: webhookUrl.trim(),
        baseUrl: resolveBaseUrl(),
        kind,
        gate,
      }
      tasks.push(
        slackSender(args).catch((err) => {
          // eslint-disable-next-line no-console
          console.error(
            `[notifications] slack channel failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        }),
      )
    }
  }

  if (config.desktop) {
    const { title, body } = buildDesktopBody(gate, kind)
    const args: DesktopSendArgs = { title, body, platform }
    tasks.push(
      desktopSender(args).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(
          `[notifications] desktop channel failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }),
    )
  }

  // Mark as notified before awaiting — the goal is "don't double-fire on
  // overlapping ticks", not "guarantee delivery". We do it after we have
  // attempted to dispatch (queued promises) so a sender failure doesn't
  // silently drop the next tick's chance to retry. Safe because the dispatch
  // is best-effort by design.
  markNotified(gate, kind)
  await Promise.all(tasks)
}

export function notifyAwaitingGate(
  gate: AwaitingGateRecord,
  opts: NotifyOptions = {},
): Promise<void> {
  return dispatch(gate, 'awaiting', opts)
}

export function notifyStaleGate(
  gate: AwaitingGateRecord,
  opts: NotifyOptions = {},
): Promise<void> {
  return dispatch(gate, 'stale', opts)
}
