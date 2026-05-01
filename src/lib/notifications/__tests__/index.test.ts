/**
 * Unit tests for the notifications dispatcher (D2).
 *
 * Verifies:
 *   - reads the config and dispatches only to enabled channels
 *   - idempotency — second call with the same gate-id is a no-op
 *   - stale notifications fire only once per gate even on repeated ticks
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import {
  notifyAwaitingGate,
  notifyStaleGate,
  __resetIdempotencyForTests,
} from '../index'
import type { AwaitingGateRecord } from '../../frameworks/runner'

const baseRecord: AwaitingGateRecord = {
  _v: 2,
  run_id: 'rid-1',
  framework: 'demo-framework',
  step_index: 1,
  gate_id: 'review',
  prompt: 'Approve the sequence?',
  payload: { foo: 'bar' },
  payload_step_index: 0,
  prior_step_outputs: [],
  inputs: {},
  created_at: '2026-04-30T12:00:00.000Z',
}

function gateKey(r: AwaitingGateRecord): string {
  return `${r.framework}__${r.run_id}__${r.gate_id}`
}

describe('notifications dispatcher', () => {
  let prevHome: string | undefined
  let tempHome: string
  let prevWebhook: string | undefined
  let prevBase: string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let slackSender: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let desktopSender: any

  beforeEach(() => {
    prevHome = process.env.HOME
    prevWebhook = process.env.YALC_SLACK_WEBHOOK_URL
    prevBase = process.env.YALC_BASE_URL
    tempHome = join(
      tmpdir(),
      `yalc-notify-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(tempHome, { recursive: true })
    mkdirSync(join(tempHome, '.gtm-os'), { recursive: true })
    process.env.HOME = tempHome
    delete process.env.YALC_SLACK_WEBHOOK_URL
    delete process.env.YALC_BASE_URL
    slackSender = vi.fn().mockResolvedValue(undefined)
    desktopSender = vi.fn().mockResolvedValue(undefined)
    __resetIdempotencyForTests()
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (prevWebhook === undefined) delete process.env.YALC_SLACK_WEBHOOK_URL
    else process.env.YALC_SLACK_WEBHOOK_URL = prevWebhook
    if (prevBase === undefined) delete process.env.YALC_BASE_URL
    else process.env.YALC_BASE_URL = prevBase
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  function writeConfig(notifications: Record<string, unknown>) {
    writeFileSync(
      join(tempHome, '.gtm-os', 'config.yaml'),
      yaml.dump({ notifications }),
      'utf-8',
    )
  }

  it('dispatches only to enabled channels', async () => {
    writeConfig({ slack: true, desktop: false })
    process.env.YALC_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/x'
    await notifyAwaitingGate(baseRecord, {
      slackSender,
      desktopSender,
      platform: 'darwin',
    })
    expect(slackSender).toHaveBeenCalledOnce()
    expect(desktopSender).not.toHaveBeenCalled()
  })

  it('skips slack when no webhook URL configured (env missing)', async () => {
    writeConfig({ slack: true, desktop: false })
    delete process.env.YALC_SLACK_WEBHOOK_URL
    await notifyAwaitingGate(baseRecord, {
      slackSender,
      desktopSender,
      platform: 'darwin',
    })
    expect(slackSender).not.toHaveBeenCalled()
  })

  it('default config: slack off, desktop on for darwin', async () => {
    // No config file at all — defaults apply.
    await notifyAwaitingGate(baseRecord, {
      slackSender,
      desktopSender,
      platform: 'darwin',
    })
    expect(slackSender).not.toHaveBeenCalled()
    expect(desktopSender).toHaveBeenCalledOnce()
  })

  it('default config on non-darwin: desktop also off', async () => {
    await notifyAwaitingGate(baseRecord, {
      slackSender,
      desktopSender,
      platform: 'linux',
    })
    expect(slackSender).not.toHaveBeenCalled()
    expect(desktopSender).not.toHaveBeenCalled()
  })

  it('idempotency: second call with same gate-id is a no-op', async () => {
    writeConfig({ slack: false, desktop: true })
    await notifyAwaitingGate(baseRecord, {
      slackSender,
      desktopSender,
      platform: 'darwin',
    })
    expect(desktopSender).toHaveBeenCalledTimes(1)
    await notifyAwaitingGate(baseRecord, {
      slackSender,
      desktopSender,
      platform: 'darwin',
    })
    expect(desktopSender).toHaveBeenCalledTimes(1)
    // Flag file should exist
    const flagDir = join(tempHome, '.gtm-os', 'notifications')
    expect(existsSync(flagDir)).toBe(true)
    expect(readdirSync(flagDir).some((f) => f.includes(gateKey(baseRecord)))).toBe(true)
  })

  it('stale notification fires only once per gate', async () => {
    writeConfig({ slack: false, desktop: true })
    await notifyStaleGate(baseRecord, {
      slackSender,
      desktopSender,
      platform: 'darwin',
    })
    await notifyStaleGate(baseRecord, {
      slackSender,
      desktopSender,
      platform: 'darwin',
    })
    expect(desktopSender).toHaveBeenCalledTimes(1)
  })

  it('awaiting and stale flags are independent per gate', async () => {
    writeConfig({ slack: false, desktop: true })
    await notifyAwaitingGate(baseRecord, {
      slackSender,
      desktopSender,
      platform: 'darwin',
    })
    await notifyStaleGate(baseRecord, {
      slackSender,
      desktopSender,
      platform: 'darwin',
    })
    expect(desktopSender).toHaveBeenCalledTimes(2)
  })

  it('continues to fire other channels if one throws', async () => {
    writeConfig({ slack: true, desktop: true })
    process.env.YALC_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/x'
    slackSender.mockRejectedValue(new Error('slack failed'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await notifyAwaitingGate(baseRecord, {
      slackSender,
      desktopSender,
      platform: 'darwin',
    })
    expect(desktopSender).toHaveBeenCalledOnce()
    errSpy.mockRestore()
  })
})
