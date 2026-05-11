/**
 * Tests for `yalc-gtm notify:test` (D2).
 *
 * Verifies:
 *   - `--channel desktop` shells out to the injected exec with osascript.
 *   - exit code 0 on success.
 *   - exit code 1 on unknown channel.
 *   - `--channel slack` posts to the configured webhook (test seam).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runNotifyTest } from '../notify-test'

describe('notify:test command', () => {
  let prevWebhook: string | undefined

  beforeEach(() => {
    prevWebhook = process.env.YALC_SLACK_WEBHOOK_URL
    delete process.env.YALC_SLACK_WEBHOOK_URL
  })

  afterEach(() => {
    if (prevWebhook === undefined) delete process.env.YALC_SLACK_WEBHOOK_URL
    else process.env.YALC_SLACK_WEBHOOK_URL = prevWebhook
    vi.restoreAllMocks()
  })

  it('desktop channel: shells out via osascript and exits 0', async () => {
    const exec = vi.fn().mockResolvedValue(undefined)
    const result = await runNotifyTest('desktop', {
      exec,
      platform: 'darwin',
    })
    expect(result.exitCode).toBe(0)
    expect(exec).toHaveBeenCalledOnce()
    expect(exec.mock.calls[0][0]).toBe('osascript')
  })

  it('desktop channel on non-darwin: exits 0 with skip message', async () => {
    const exec = vi.fn().mockResolvedValue(undefined)
    const result = await runNotifyTest('desktop', {
      exec,
      platform: 'linux',
    })
    expect(result.exitCode).toBe(0)
    expect(exec).not.toHaveBeenCalled()
    expect(result.output.toLowerCase()).toContain('skip')
  })

  it('slack channel: returns 1 when no webhook configured', async () => {
    const result = await runNotifyTest('slack', {})
    expect(result.exitCode).toBe(1)
    expect(result.output.toLowerCase()).toContain('webhook')
  })

  it('slack channel: posts via injected fetch when webhook set', async () => {
    process.env.YALC_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/x'
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }))
    const result = await runNotifyTest('slack', { fetchImpl: fetchMock })
    expect(result.exitCode).toBe(0)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('unknown channel: exits 1', async () => {
    const result = await runNotifyTest('email' as 'slack', {})
    expect(result.exitCode).toBe(1)
    expect(result.output.toLowerCase()).toContain('unknown channel')
  })
})
