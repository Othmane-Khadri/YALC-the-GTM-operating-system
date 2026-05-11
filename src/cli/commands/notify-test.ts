/**
 * `yalc-gtm notify:test --channel slack|desktop` (D2).
 *
 * Sends a single test notification to the requested channel so operators
 * can verify their config without waiting for a real awaiting-gate event.
 */

import type { AwaitingGateRecord } from '../../lib/frameworks/runner.js'
import { sendDesktopNotification } from '../../lib/notifications/desktop.js'
import { sendSlackNotification } from '../../lib/notifications/slack.js'

export type NotifyTestChannel = 'slack' | 'desktop'

export interface NotifyTestOptions {
  /** Override the platform check for the desktop channel (test hook). */
  platform?: NodeJS.Platform | string
  /** Inject the exec helper used by the desktop channel (test hook). */
  exec?: (bin: string, args: string[]) => Promise<void>
  /** Inject `fetch` for the slack channel (test hook). */
  fetchImpl?: typeof fetch
}

export interface NotifyTestResult {
  exitCode: number
  output: string
}

const TEST_GATE: AwaitingGateRecord = {
  _v: 2,
  run_id: 'notify-test',
  framework: 'notify-test',
  step_index: 0,
  gate_id: 'test',
  prompt: 'YALC test notification — if you see this, notifications are wired up.',
  payload: null,
  payload_step_index: null,
  prior_step_outputs: [],
  inputs: {},
  created_at: new Date().toISOString(),
}

export async function runNotifyTest(
  channel: NotifyTestChannel,
  opts: NotifyTestOptions = {},
): Promise<NotifyTestResult> {
  if (channel === 'desktop') {
    const platform = opts.platform ?? process.platform
    if (platform !== 'darwin') {
      return {
        exitCode: 0,
        output: `Skipping desktop notification: platform "${platform}" is not darwin.`,
      }
    }
    try {
      await sendDesktopNotification({
        title: 'YALC',
        body: TEST_GATE.prompt,
        platform,
        exec: opts.exec,
      })
      return { exitCode: 0, output: 'Desktop notification dispatched.' }
    } catch (err) {
      return {
        exitCode: 1,
        output: `Desktop notification failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  if (channel === 'slack') {
    const webhookUrl = process.env.YALC_SLACK_WEBHOOK_URL
    if (!webhookUrl || !webhookUrl.trim()) {
      return {
        exitCode: 1,
        output:
          'No Slack webhook configured. Set YALC_SLACK_WEBHOOK_URL in ~/.gtm-os/.env or your environment.',
      }
    }
    const baseUrl = process.env.YALC_BASE_URL?.trim() || 'http://localhost:3847'
    const prevFetch = globalThis.fetch
    if (opts.fetchImpl) {
      // Temporary stubbing for the test seam.
      globalThis.fetch = opts.fetchImpl as typeof fetch
    }
    try {
      await sendSlackNotification({
        webhookUrl: webhookUrl.trim(),
        baseUrl,
        kind: 'awaiting',
        gate: TEST_GATE,
      })
      return { exitCode: 0, output: 'Slack notification dispatched.' }
    } catch (err) {
      return {
        exitCode: 1,
        output: `Slack notification failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    } finally {
      if (opts.fetchImpl) {
        globalThis.fetch = prevFetch
      }
    }
  }

  return { exitCode: 1, output: `Unknown channel "${channel}". Use slack or desktop.` }
}
