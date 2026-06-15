/**
 * Tests for `slack:listen` after the Claude Code dispatch rewire.
 *
 * The Claude-spawning handler and the approval / intent modules are mocked so
 * the test exercises only the listener wiring: env validation, handler
 * construction, inbound dispatch, and the boot log line.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlackInboundEvent, SlackInputApp } from '../../../lib/server/slack-input'

// Mock the Claude-spawning handler so no subprocess is ever launched.
const innerHandler = vi.fn(async (_event: SlackInboundEvent) => {})
const makeClaudeSpawningHandler = vi.fn((_opts: unknown) => innerHandler)
vi.mock('../../../lib/server/spawn-claude-handler.js', () => ({
  makeClaudeSpawningHandler: (opts: unknown) => makeClaudeSpawningHandler(opts),
}))

// Mock the approval store + intent modules to avoid sqlite / global side effects.
vi.mock('../../../lib/server/slack-approval.js', () => ({
  __setApprovalStore: vi.fn(),
  __setIntentClassifier: vi.fn(),
  __setSlackPoster: vi.fn(),
  createSqliteApprovalStore: vi.fn(async () => ({})),
}))
vi.mock('../../../lib/server/approval-intent.js', () => ({
  makeChainedClassifier: vi.fn(() => ({})),
  makeLlmClassifier: vi.fn(() => ({})),
  makeRuleBasedClassifier: vi.fn(() => ({})),
}))

import { runSlackListen } from '../slack-listen'

const FULL_ENV = {
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_SIGNING_SECRET: 'secret',
  SLACK_APP_TOKEN: 'xapp-test',
}

interface Captured {
  handler?: (event: SlackInboundEvent) => Promise<void>
}

function makeBuildApp(captured: Captured) {
  return (deps: { handler: (event: SlackInboundEvent) => Promise<void> }): SlackInputApp => {
    captured.handler = deps.handler
    return {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      // Left undefined so the bolt poster wiring takes the no-op branch.
      app: undefined as never,
    }
  }
}

beforeEach(() => {
  makeClaudeSpawningHandler.mockClear()
  innerHandler.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('runSlackListen', () => {
  it('errors when required env vars are missing', async () => {
    const result = await runSlackListen({
      fetchEnv: () => ({ SLACK_BOT_TOKEN: 'xoxb-test' }),
      log: () => {},
    })
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Missing required env vars')
    expect(result.output).toContain('SLACK_SIGNING_SECRET')
    expect(result.output).toContain('SLACK_APP_TOKEN')
  })

  it('errors when an env var is present but blank', async () => {
    const result = await runSlackListen({
      fetchEnv: () => ({ ...FULL_ENV, SLACK_APP_TOKEN: '   ' }),
      log: () => {},
    })
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('SLACK_APP_TOKEN')
  })

  it('builds the Claude-spawning handler with project root and bot token', async () => {
    const captured: Captured = {}
    const result = await runSlackListen({
      fetchEnv: () => ({ ...FULL_ENV, GTM_OS_PROJECT_ROOT: '/repo/root' }),
      buildApp: makeBuildApp(captured),
      log: () => {},
    })

    expect(result.exitCode).toBe(0)
    expect(makeClaudeSpawningHandler).toHaveBeenCalledTimes(1)
    const opts = makeClaudeSpawningHandler.mock.calls[0][0] as {
      projectRoot: string
      slackToken: string
    }
    expect(opts.projectRoot).toBe('/repo/root')
    expect(opts.slackToken).toBe('xoxb-test')
  })

  it('emits the Claude dispatch boot log line', async () => {
    const lines: string[] = []
    await runSlackListen({
      fetchEnv: () => FULL_ENV,
      buildApp: makeBuildApp({}),
      log: (l) => lines.push(l),
    })
    expect(lines).toContain('[slack:listen] dispatching inbound to Claude Code subprocess')
  })

  it('routes an inbound message to the Claude-spawning handler', async () => {
    const captured: Captured = {}
    await runSlackListen({
      fetchEnv: () => FULL_ENV,
      buildApp: makeBuildApp(captured),
      log: () => {},
    })

    expect(captured.handler).toBeDefined()
    const event: SlackInboundEvent = {
      text: 'run lookalikes watcher',
      channel: 'C1',
      threadTs: '1700000000.0001',
      userId: 'U1',
    }
    await captured.handler!(event)
    expect(innerHandler).toHaveBeenCalledWith(event)
  })

  it('skips Claude wiring when a custom handler is injected (tests)', async () => {
    const custom = vi.fn(async () => {})
    await runSlackListen({
      fetchEnv: () => FULL_ENV,
      buildApp: makeBuildApp({}),
      handler: custom,
      log: () => {},
    })
    expect(makeClaudeSpawningHandler).not.toHaveBeenCalled()
  })
})
