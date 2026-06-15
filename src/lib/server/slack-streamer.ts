/**
 * Concrete AgentStreamer that posts updates back into a Slack thread.
 *
 * Every method posts a NEW message via `chat.postMessage` with `thread_ts`
 * set. We never patch existing messages; multi-stage runs read more
 * cleanly when each step appears as its own line in the thread.
 *
 * `awaitApproval` bridges to the existing slack-approval store
 * (`recordPending` then `awaitApproval`). Original sender enforcement
 * lives in the store, so this streamer is a thin pass-through.
 *
 * `ask` posts the question, then blocks on a per-thread "reply waiter"
 * resolved by the dispatcher when the next free-text reply from the
 * original sender lands.
 */

import type {
  AgentStreamer,
  ApprovalResolution,
} from './agent-router-types.js'

/**
 * Minimal structural type for the Slack `chat.postMessage` surface. Declared
 * locally so tests pass plain mocks without pulling in `@slack/bolt`'s
 * `WebClient`.
 */
export interface SlackWebClient {
  chat: {
    postMessage: (args: {
      channel: string
      thread_ts: string
      text?: string
      blocks?: ReadonlyArray<Record<string, unknown>>
    }) => Promise<unknown>
  }
}

export interface ApprovalStoreLike {
  recordPending: (
    threadTs: string,
    runId: string,
    requestedBy: string,
    channel: string,
  ) => Promise<unknown>
  awaitApproval: (
    threadTs: string,
    fromUserId: string,
    timeoutMs?: number,
  ) => Promise<{
    state: 'pending' | 'approved' | 'rejected' | 'timeout'
    resolvedBy?: string
    resolvedAt?: Date
  }>
}

export interface ReplyWaiterRegistry {
  /**
   * Register a waiter for the next free-text reply in `threadTs` from
   * `fromUserId`. Returns a `cancel` function. The waiter resolver is
   * invoked by the dispatcher when it sees a matching message.
   */
  registerReplyWaiter: (
    threadTs: string,
    fromUserId: string,
    resolver: (text: string) => void,
  ) => () => void
}

export interface SlackStreamerDeps {
  webClient: SlackWebClient
  channel: string
  threadTs: string
  fromUserId: string
  approvalStore: ApprovalStoreLike
  registerReplyWaiter: ReplyWaiterRegistry['registerReplyWaiter']
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 600_000
const DEFAULT_ASK_TIMEOUT_MS = 300_000

function formatLinks(links?: Array<{ label: string; url: string }>): string {
  if (!links || links.length === 0) return ''
  const lines = links.map((l) => `<${l.url}|${l.label}>`)
  return '\n' + lines.join('\n')
}

export function makeAgentStreamer(deps: SlackStreamerDeps): AgentStreamer {
  const { webClient, channel, threadTs, fromUserId, approvalStore } = deps

  async function post(text: string): Promise<void> {
    await webClient.chat.postMessage({ channel, thread_ts: threadTs, text })
  }

  return {
    async start(text) {
      await post(text)
    },
    async progress(text) {
      await post(text)
    },
    async done(text, links) {
      await post(text + formatLinks(links))
    },
    async error(text) {
      await post(text)
    },
    async preview(blocks) {
      await webClient.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: 'preview',
        blocks,
      })
    },
    async awaitApproval(
      runId,
      timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS,
    ): Promise<ApprovalResolution> {
      await approvalStore.recordPending(threadTs, runId, fromUserId, channel)
      const result = await approvalStore.awaitApproval(
        threadTs,
        fromUserId,
        timeoutMs,
      )
      return {
        state: result.state === 'pending' ? 'timeout' : result.state,
        resolvedBy: result.resolvedBy,
        resolvedAt:
          result.resolvedAt instanceof Date
            ? result.resolvedAt.toISOString()
            : undefined,
      }
    },
    async ask(question, timeoutMs = DEFAULT_ASK_TIMEOUT_MS) {
      await post(question)
      return new Promise<string | null>((resolve) => {
        let settled = false
        const cancel = deps.registerReplyWaiter(
          threadTs,
          fromUserId,
          (text: string) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(text)
          },
        )
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          cancel()
          resolve(null)
        }, timeoutMs)
      })
    },
  }
}
