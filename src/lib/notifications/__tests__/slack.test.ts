/**
 * Unit tests for the Slack channel sender (D2).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AwaitingGateRecord } from '../../frameworks/runner'
import { sendSlackNotification } from '../slack'

const baseRecord: AwaitingGateRecord = {
  _v: 2,
  run_id: 'rid-1',
  framework: 'demo-framework',
  step_index: 1,
  gate_id: 'review',
  prompt: 'Approve the proposed sequence?',
  payload: { foo: 'bar' },
  payload_step_index: 0,
  prior_step_outputs: [],
  inputs: {},
  created_at: '2026-04-30T12:00:00.000Z',
}

describe('notifications slack sender', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts JSON with prompt, kind, and dashboard link', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))
    await sendSlackNotification({
      webhookUrl: 'https://hooks.slack.com/services/T/B/X',
      baseUrl: 'http://localhost:3847',
      kind: 'awaiting',
      gate: baseRecord,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://hooks.slack.com/services/T/B/X')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body as string)
    expect(body.text).toContain('Approve the proposed sequence?')
    expect(body.text).toContain('http://localhost:3847/today')
  })

  it('returns void on 200', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))
    await expect(
      sendSlackNotification({
        webhookUrl: 'https://x',
        baseUrl: 'http://localhost:3847',
        kind: 'awaiting',
        gate: baseRecord,
      }),
    ).resolves.toBeUndefined()
  })

  it('logs and re-throws on 4xx', async () => {
    fetchMock.mockResolvedValue(new Response('bad', { status: 404 }))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      sendSlackNotification({
        webhookUrl: 'https://x',
        baseUrl: 'http://localhost:3847',
        kind: 'awaiting',
        gate: baseRecord,
      }),
    ).rejects.toThrow(/slack.*404/i)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('logs and re-throws on 5xx', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 503 }))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      sendSlackNotification({
        webhookUrl: 'https://x',
        baseUrl: 'http://localhost:3847',
        kind: 'awaiting',
        gate: baseRecord,
      }),
    ).rejects.toThrow(/slack.*503/i)
    errSpy.mockRestore()
  })

  it('uses a stale prefix when kind=stale', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))
    await sendSlackNotification({
      webhookUrl: 'https://x',
      baseUrl: 'http://localhost:3847',
      kind: 'stale',
      gate: baseRecord,
    })
    const init = fetchMock.mock.calls[0][1]
    const body = JSON.parse(init.body as string)
    expect(body.text.toLowerCase()).toContain('stale')
  })
})
