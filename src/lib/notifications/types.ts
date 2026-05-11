/**
 * Shared types for the gate-notifications module (D2).
 */

import type { AwaitingGateRecord } from '../frameworks/runner.js'

/** The kind of event being fanned out. */
export type NotificationKind = 'awaiting' | 'stale'

/**
 * Resolved configuration for the notifications dispatcher. Loaded from
 * `~/.gtm-os/config.yaml` under the `notifications:` block. Defaults applied
 * when the block (or individual key) is absent.
 */
export interface NotificationsConfig {
  slack: boolean
  desktop: boolean
}

/**
 * Optional overrides accepted by `notifyAwaitingGate` / `notifyStaleGate`,
 * primarily to make the dispatcher testable without touching real channels.
 */
export interface NotifyOptions {
  slackSender?: (args: SlackSendArgs) => Promise<void>
  desktopSender?: (args: DesktopSendArgs) => Promise<void>
  /** Override the platform check used by the desktop channel (test hook). */
  platform?: NodeJS.Platform | string
}

/** Arguments for the Slack channel sender. */
export interface SlackSendArgs {
  webhookUrl: string
  baseUrl: string
  kind: NotificationKind
  gate: AwaitingGateRecord
}

/** Arguments for the desktop channel sender. */
export interface DesktopSendArgs {
  title: string
  body: string
  platform?: NodeJS.Platform | string
  /**
   * Test seam — defaults to a real `child_process.execFile` wrapper. Tests
   * inject a mock so we don't shell out during unit runs.
   */
  exec?: (bin: string, args: string[]) => Promise<void>
}
