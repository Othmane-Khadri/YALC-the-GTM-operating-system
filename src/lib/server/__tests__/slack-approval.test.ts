/**
 * S3. Slack input + approval coverage.
 *
 * Covers the seven acceptance cases:
 *   1. `slack:listen` boots without error against fixture env vars (mock Bolt).
 *   2. `app_mention` payload routes to the registered handler with correct args.
 *   3. Reaction `+1` from `requested_by` resolves the approval as `approved`.
 *   4. Reaction from a different user does NOT resolve the approval.
 *   5. Thread reply `/yalc approve <runId>` from `requested_by` resolves as `approved`.
 *   6. Thread reply from a different user does NOT resolve.
 *   7. Timeout returns `{state: 'timeout'}` after the configured ms.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  __setApprovalStore,
  __setIntentClassifier,
  __setPollIntervalMs,
  __setSlackPoster,
  awaitApproval,
  createMemoryApprovalStore,
  PENDING_NUDGE_TEXT,
  recordPending,
  resolveByReaction,
  resolveByReply,
  type SlackPoster,
} from '../slack-approval.js'
import {
  makeChainedClassifier,
  makeRuleBasedClassifier,
  type ApprovalIntent,
  type IntentClassifier,
} from '../approval-intent.js'
import {
  createSlackInputApp,
  type SlackInboundHandler,
  type SlackInboundEvent,
} from '../slack-input.js'
import { runSlackListen } from '../../../cli/commands/slack-listen.js'

// ── Mock Bolt App ────────────────────────────────────────────────────────────

type EventHandler = (args: { event: unknown }) => Promise<void> | void

class MockBoltApp {
  handlers = new Map<string, EventHandler>()
  startCalls = 0
  stopCalls = 0
  event(name: string, handler: EventHandler): void {
    this.handlers.set(name, handler)
  }
  async start(): Promise<void> {
    this.startCalls += 1
  }
  async stop(): Promise<void> {
    this.stopCalls += 1
  }
  async fire(name: string, payload: unknown): Promise<void> {
    const fn = this.handlers.get(name)
    if (!fn) throw new Error(`No handler for ${name}`)
    await fn({ event: payload })
  }
}

function makeAppFactory(mock: MockBoltApp) {
  return () => mock as unknown as Parameters<typeof createSlackInputApp>[0]['appFactory'] extends
    | undefined
    | ((opts: unknown) => infer R)
    ? R
    : never
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  __setApprovalStore(createMemoryApprovalStore())
  __setPollIntervalMs(5)
  __setIntentClassifier(makeRuleBasedClassifier())
  __setSlackPoster(null)
})

function makeStaticClassifier(verdict: ApprovalIntent): IntentClassifier {
  return {
    async classify() {
      return verdict
    },
  }
}

// ── 1. slack:listen boots cleanly with mock env + mock Bolt ─────────────────

describe('runSlackListen', () => {
  it('boots without error when env vars are present', async () => {
    const mock = new MockBoltApp()
    const result = await runSlackListen({
      fetchEnv: () => ({
        SLACK_BOT_TOKEN: 'xoxb-test',
        SLACK_SIGNING_SECRET: 'secret',
        SLACK_APP_TOKEN: 'xapp-test',
      }),
      buildApp: (deps) =>
        createSlackInputApp({
          ...deps,
          appFactory: makeAppFactory(mock),
        }),
      log: () => {},
    })
    expect(result.exitCode).toBe(0)
    expect(mock.startCalls).toBe(1)
    expect(result.app).toBeDefined()
  })

  it('errors clearly when env vars missing', async () => {
    const result = await runSlackListen({
      fetchEnv: () => ({}),
      log: () => {},
    })
    expect(result.exitCode).toBe(1)
    expect(result.output).toMatch(/SLACK_BOT_TOKEN/)
  })
})

// ── 2. app_mention dispatches to handler with cleaned args ──────────────────

describe('createSlackInputApp dispatch', () => {
  it('routes app_mention payloads to the handler', async () => {
    const mock = new MockBoltApp()
    const received: SlackInboundEvent[] = []
    const handler: SlackInboundHandler = async (input) => {
      received.push(input)
    }
    createSlackInputApp({
      botToken: 'xoxb',
      signingSecret: 's',
      appToken: 'xapp',
      handler,
      appFactory: makeAppFactory(mock),
    })

    await mock.fire('app_mention', {
      type: 'app_mention',
      text: '<@U999BOT> run gate now',
      user: 'U_REQUESTER',
      channel: 'C_GENERAL',
      ts: '1700000000.000100',
    })

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({
      text: 'run gate now',
      channel: 'C_GENERAL',
      threadTs: '1700000000.000100',
      userId: 'U_REQUESTER',
    })
  })

  it('ignores non-IM messages', async () => {
    const mock = new MockBoltApp()
    const received: SlackInboundEvent[] = []
    createSlackInputApp({
      botToken: 'xoxb',
      signingSecret: 's',
      appToken: 'xapp',
      handler: async (i) => {
        received.push(i)
      },
      appFactory: makeAppFactory(mock),
    })
    await mock.fire('message', {
      type: 'message',
      channel_type: 'channel',
      text: 'hi',
      user: 'U1',
      channel: 'C1',
      ts: '1.0',
    })
    expect(received).toHaveLength(0)
  })
})

// ── 3. Reaction by requester approves ───────────────────────────────────────

describe('approval resolution', () => {
  it('approves on thumbsup from requested_by', async () => {
    const threadTs = '1700000001.000200'
    await recordPending(threadTs, 'run_42', 'U_REQUESTER', 'C_GENERAL')

    const result = await resolveByReaction(threadTs, '+1', 'U_REQUESTER')
    expect(result).toBe('approved')

    const finalState = await awaitApproval(threadTs, 'U_REQUESTER', 100)
    expect(finalState.state).toBe('approved')
    expect(finalState.resolvedBy).toBe('U_REQUESTER')
  })

  // ── 4. Reaction from other user is a no-op ─────────────────────────────────
  it('ignores thumbsup from a different user', async () => {
    const threadTs = '1700000002.000300'
    await recordPending(threadTs, 'run_43', 'U_REQUESTER', 'C_GENERAL')

    const result = await resolveByReaction(threadTs, '+1', 'U_INTRUDER')
    expect(result).toBeNull()

    // Approval remains pending. confirm via a tiny timeout window.
    const finalState = await awaitApproval(threadTs, 'U_REQUESTER', 60)
    expect(finalState.state).toBe('timeout')
  })

  // ── 5. Thread reply by requester approves ──────────────────────────────────
  it('approves on /yalc approve reply from requested_by', async () => {
    const threadTs = '1700000003.000400'
    await recordPending(threadTs, 'run_44', 'U_REQUESTER', 'C_GENERAL')

    const result = await resolveByReply(threadTs, '/yalc approve run_44', 'U_REQUESTER')
    expect(result).toBe('approved')

    const finalState = await awaitApproval(threadTs, 'U_REQUESTER', 100)
    expect(finalState.state).toBe('approved')
  })

  // ── 6. Thread reply from other user is a no-op ─────────────────────────────
  it('ignores /yalc approve reply from a different user', async () => {
    const threadTs = '1700000004.000500'
    await recordPending(threadTs, 'run_45', 'U_REQUESTER', 'C_GENERAL')

    const result = await resolveByReply(threadTs, '/yalc approve run_45', 'U_INTRUDER')
    expect(result).toBeNull()

    const finalState = await awaitApproval(threadTs, 'U_REQUESTER', 60)
    expect(finalState.state).toBe('timeout')
  })

  // ── 7. Timeout path ────────────────────────────────────────────────────────
  it('returns timeout state when no resolution arrives', async () => {
    const threadTs = '1700000005.000600'
    await recordPending(threadTs, 'run_46', 'U_REQUESTER', 'C_GENERAL')

    const finalState = await awaitApproval(threadTs, 'U_REQUESTER', 40)
    expect(finalState.state).toBe('timeout')
    expect(finalState.resolvedAt).toBeInstanceOf(Date)
  })

  it('rejects on /yalc cancel reply from requested_by', async () => {
    const threadTs = '1700000006.000700'
    await recordPending(threadTs, 'run_47', 'U_REQUESTER', 'C_GENERAL')

    const result = await resolveByReply(threadTs, '/yalc cancel run_47', 'U_REQUESTER')
    expect(result).toBe('rejected')

    const finalState = await awaitApproval(threadTs, 'U_REQUESTER', 100)
    expect(finalState.state).toBe('rejected')
  })
})

// ── Natural-language approval intent ────────────────────────────────────────

describe('natural-language approval resolution', () => {
  it('approves on a casual "Hey, this is good. Go." from requested_by', async () => {
    const threadTs = '1700000010.001000'
    await recordPending(threadTs, 'run_100', 'U_REQUESTER', 'C_GENERAL')

    const result = await resolveByReply(threadTs, 'Hey, this is good. Go.', 'U_REQUESTER')
    expect(result).toBe('approved')

    const finalState = await awaitApproval(threadTs, 'U_REQUESTER', 60)
    expect(finalState.state).toBe('approved')
    expect(finalState.resolvedBy).toBe('U_REQUESTER')
  })

  it('approves on "looks good ship it"', async () => {
    const threadTs = '1700000011.001100'
    await recordPending(threadTs, 'run_101', 'U_REQUESTER', 'C_GENERAL')

    const result = await resolveByReply(threadTs, 'looks good ship it', 'U_REQUESTER')
    expect(result).toBe('approved')
  })

  it('approves on a one-word "yes"', async () => {
    const threadTs = '1700000012.001200'
    await recordPending(threadTs, 'run_102', 'U_REQUESTER', 'C_GENERAL')

    const result = await resolveByReply(threadTs, 'yes', 'U_REQUESTER')
    expect(result).toBe('approved')
  })

  it('rejects on "no thanks"', async () => {
    const threadTs = '1700000013.001300'
    await recordPending(threadTs, 'run_103', 'U_REQUESTER', 'C_GENERAL')

    const result = await resolveByReply(threadTs, 'no thanks', 'U_REQUESTER')
    expect(result).toBe('rejected')

    const finalState = await awaitApproval(threadTs, 'U_REQUESTER', 60)
    expect(finalState.state).toBe('rejected')
  })

  it('leaves the row pending when the reply is conversational', async () => {
    const threadTs = '1700000014.001400'
    await recordPending(threadTs, 'run_104', 'U_REQUESTER', 'C_GENERAL')

    const result = await resolveByReply(
      threadTs,
      "let's chat about pricing first",
      'U_REQUESTER',
    )
    expect(result).toBeNull()

    // Row should still be pending. A tiny timeout window confirms the state.
    const finalState = await awaitApproval(threadTs, 'U_REQUESTER', 40)
    expect(finalState.state).toBe('timeout')
  })

  it('ignores a natural-language approval from a different user', async () => {
    const threadTs = '1700000015.001500'
    await recordPending(threadTs, 'run_105', 'U_REQUESTER', 'C_GENERAL')

    const result = await resolveByReply(threadTs, 'Hey, this is good. Go.', 'U_INTRUDER')
    expect(result).toBeNull()

    const finalState = await awaitApproval(threadTs, 'U_REQUESTER', 40)
    expect(finalState.state).toBe('timeout')
  })

  it('falls back to the LLM when rules return unknown', async () => {
    const threadTs = '1700000016.001600'
    await recordPending(threadTs, 'run_106', 'U_REQUESTER', 'C_GENERAL')

    let llmCalls = 0
    const llm: IntentClassifier = {
      async classify() {
        llmCalls += 1
        return 'approve'
      },
    }
    __setIntentClassifier(makeChainedClassifier(makeRuleBasedClassifier(), llm))

    const result = await resolveByReply(
      threadTs,
      'oui pourquoi pas, on lance',
      'U_REQUESTER',
    )
    expect(result).toBe('approved')
    expect(llmCalls).toBe(1)
  })

  it('leaves the row pending when both rules and LLM return unknown', async () => {
    const threadTs = '1700000017.001700'
    await recordPending(threadTs, 'run_107', 'U_REQUESTER', 'C_GENERAL')

    __setIntentClassifier(
      makeChainedClassifier(makeRuleBasedClassifier(), makeStaticClassifier('unknown')),
    )

    const result = await resolveByReply(threadTs, 'hmm interesting', 'U_REQUESTER')
    expect(result).toBeNull()

    const finalState = await awaitApproval(threadTs, 'U_REQUESTER', 40)
    expect(finalState.state).toBe('timeout')
  })
})

// ── Pending nudge on ambiguous replies ──────────────────────────────────────

describe('pending nudge on unknown intent', () => {
  function makeSpyPoster(): {
    poster: SlackPoster
    calls: Array<{ threadTs: string; channel: string; text: string }>
  } {
    const calls: Array<{ threadTs: string; channel: string; text: string }> = []
    const poster: SlackPoster = {
      async postReply(threadTs, channel, text) {
        calls.push({ threadTs, channel, text })
      },
    }
    return { poster, calls }
  }

  it('nudges once when the original requester sends an unknown reply', async () => {
    const threadTs = '1700000020.002000'
    await recordPending(threadTs, 'run_200', 'U_REQUESTER', 'C_NUDGE')
    __setIntentClassifier(makeStaticClassifier('unknown'))
    const { poster, calls } = makeSpyPoster()
    __setSlackPoster(poster)

    const result = await resolveByReply(threadTs, 'maybe later, not sure', 'U_REQUESTER')
    expect(result).toBeNull()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      threadTs,
      channel: 'C_NUDGE',
      text: PENDING_NUDGE_TEXT,
    })
  })

  it('does not nudge a second time on a subsequent unknown reply', async () => {
    const threadTs = '1700000021.002100'
    await recordPending(threadTs, 'run_201', 'U_REQUESTER', 'C_NUDGE')
    __setIntentClassifier(makeStaticClassifier('unknown'))
    const { poster, calls } = makeSpyPoster()
    __setSlackPoster(poster)

    await resolveByReply(threadTs, 'hmm', 'U_REQUESTER')
    await resolveByReply(threadTs, 'still thinking', 'U_REQUESTER')
    await resolveByReply(threadTs, 'one more sec', 'U_REQUESTER')

    expect(calls).toHaveLength(1)
  })

  it('nudge text contains no em dash, no en dash, no hyphen separator', () => {
    expect(PENDING_NUDGE_TEXT).not.toMatch(/—/) // em dash
    expect(PENDING_NUDGE_TEXT).not.toMatch(/–/) // en dash
    expect(PENDING_NUDGE_TEXT).not.toMatch(/ - /) // hyphen-as-separator
  })

  it('does not nudge when an unknown reply comes from a non-original user', async () => {
    const threadTs = '1700000022.002200'
    await recordPending(threadTs, 'run_202', 'U_REQUESTER', 'C_NUDGE')
    __setIntentClassifier(makeStaticClassifier('unknown'))
    const { poster, calls } = makeSpyPoster()
    __setSlackPoster(poster)

    const result = await resolveByReply(threadTs, 'whatever', 'U_INTRUDER')
    expect(result).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('does not nudge on approve or reject paths', async () => {
    const threadTs = '1700000023.002300'
    await recordPending(threadTs, 'run_203', 'U_REQUESTER', 'C_NUDGE')
    const { poster, calls } = makeSpyPoster()
    __setSlackPoster(poster)

    const approved = await resolveByReply(threadTs, 'yes ship it', 'U_REQUESTER')
    expect(approved).toBe('approved')
    expect(calls).toHaveLength(0)

    // Fresh row for the reject case so the state machine accepts it.
    const threadTs2 = '1700000024.002400'
    await recordPending(threadTs2, 'run_204', 'U_REQUESTER', 'C_NUDGE')
    const rejected = await resolveByReply(threadTs2, 'no thanks', 'U_REQUESTER')
    expect(rejected).toBe('rejected')
    expect(calls).toHaveLength(0)
  })

  it('default no-op poster does not throw when an unknown reply arrives', async () => {
    const threadTs = '1700000025.002500'
    await recordPending(threadTs, 'run_205', 'U_REQUESTER', 'C_NUDGE')
    __setIntentClassifier(makeStaticClassifier('unknown'))
    // Explicit reset to the no-op poster.
    __setSlackPoster(null)

    await expect(resolveByReply(threadTs, 'hmm', 'U_REQUESTER')).resolves.toBeNull()
  })

  // Silence the unused-`vi` warning if any consumers care.
  void vi
})
