/**
 * Slack input listener (S3).
 *
 * Wraps `@slack/bolt` in Socket Mode and dispatches inbound events to a
 * caller-supplied handler. Three event channels are bridged:
 *   - `message` (filtered to direct messages, channel_type === 'im')
 *   - `app_mention`
 *   - `reaction_added`
 *
 * Reactions and thread replies feed the slack-approval store so pending
 * human-in-the-loop checks resolve naturally.
 *
 * The `appFactory` seam keeps tests off the real Bolt runtime.
 */

import { createRequire } from 'node:module'

import type { App as BoltApp } from '@slack/bolt'

export interface SlackInboundEvent {
  text: string
  channel: string
  threadTs: string | undefined
  userId: string
}

export type SlackInboundHandler = (input: SlackInboundEvent) => Promise<void>

export interface SlackInputDeps {
  botToken: string
  signingSecret: string
  appToken: string
  handler: SlackInboundHandler
  /** Approval-store reaction resolver. Defaults to the global module. */
  resolveByReaction?: (threadTs: string, reactionName: string, byUserId: string) => Promise<unknown>
  /** Approval-store reply resolver. Defaults to the global module. */
  resolveByReply?: (threadTs: string, text: string, byUserId: string) => Promise<unknown>
  /** Test seam to swap the Bolt App factory. */
  appFactory?: (opts: {
    token: string
    signingSecret: string
    appToken: string
    socketMode: true
  }) => BoltApp
}

export interface SlackInputApp {
  start: () => Promise<void>
  stop: () => Promise<void>
  app: BoltApp
}

/**
 * Strip a leading `<@BOTID>` prefix that `app_mention` events carry. We do not
 * know the bot ID up front, so the regex accepts any user mention at the start.
 */
function stripMentionPrefix(text: string): string {
  return text.replace(/^\s*<@[A-Z0-9]+>\s*/, '').trim()
}

/** Resolve the thread timestamp for a Slack event, defaulting to the message ts. */
function resolveThreadTs(event: { ts?: string; thread_ts?: string }): string | undefined {
  return event.thread_ts ?? event.ts
}

export function createSlackInputApp(deps: SlackInputDeps): SlackInputApp {
  const factory = deps.appFactory ?? defaultAppFactory
  const app = factory({
    token: deps.botToken,
    signingSecret: deps.signingSecret,
    appToken: deps.appToken,
    socketMode: true,
  })

  // Lazily load default resolvers so callers can stub them in tests without
  // forcing the SQLite-backed module to load.
  const resolveReaction =
    deps.resolveByReaction ??
    (async (threadTs: string, reactionName: string, byUserId: string) => {
      const { resolveByReaction } = await import('./slack-approval.js')
      await resolveByReaction(threadTs, reactionName, byUserId)
    })

  const resolveReply =
    deps.resolveByReply ??
    (async (threadTs: string, text: string, byUserId: string) => {
      const { resolveByReply } = await import('./slack-approval.js')
      await resolveByReply(threadTs, text, byUserId)
    })

  // ── message (DMs only) ──
  app.event('message', async ({ event }) => {
    // Type discrimination: only handle plain user messages in IMs.
    const e = event as unknown as {
      type: 'message'
      subtype?: string
      channel_type?: string
      text?: string
      user?: string
      bot_id?: string
      channel: string
      ts: string
      thread_ts?: string
    }
    if (e.channel_type !== 'im') return
    if (e.bot_id) return
    if (e.subtype && e.subtype !== 'thread_broadcast') return
    if (!e.text || !e.user) return

    const threadTs = resolveThreadTs(e)
    if (threadTs) {
      // If this looks like an approval reply, route through the approval store
      // first. Non-matching text is forwarded to the dispatcher below.
      await resolveReply(threadTs, e.text, e.user)
    }
    await deps.handler({
      text: e.text,
      channel: e.channel,
      // Reply target: only continue an existing thread. A fresh top-level DM
      // has no thread_ts, so the reply lands inline in the DM rather than
      // buried under a hidden "1 reply" thread.
      threadTs: e.thread_ts,
      userId: e.user,
    })
  })

  // ── app_mention ──
  app.event('app_mention', async ({ event }) => {
    const e = event as unknown as {
      type: 'app_mention'
      text?: string
      user?: string
      channel: string
      ts: string
      thread_ts?: string
    }
    if (!e.text || !e.user) return
    const cleaned = stripMentionPrefix(e.text)
    const threadTs = resolveThreadTs(e)
    await deps.handler({
      text: cleaned,
      channel: e.channel,
      threadTs,
      userId: e.user,
    })
  })

  // ── reaction_added ──
  app.event('reaction_added', async ({ event }) => {
    const e = event as unknown as {
      type: 'reaction_added'
      reaction: string
      user: string
      item: { type: string; channel?: string; ts?: string }
    }
    if (e.item.type !== 'message' || !e.item.ts) return
    await resolveReaction(e.item.ts, e.reaction, e.user)
  })

  return {
    app,
    async start() {
      await app.start()
    },
    async stop() {
      await app.stop()
    },
  }
}

function defaultAppFactory(opts: {
  token: string
  signingSecret: string
  appToken: string
  socketMode: true
}): BoltApp {
  // Imported here so test runs that swap `appFactory` never touch the real
  // module. `createRequire` reconstructs a CommonJS `require` under the ESM
  // runtime (tsx/node), where the bare `require` global is undefined. Cast keeps
  // `createSlackInputApp` callable from contexts where the Bolt types aren't
  // resolved (e.g. type-check skip).
  const require = createRequire(import.meta.url)
  const { App } = require('@slack/bolt') as { App: new (o: unknown) => BoltApp }
  return new App({
    token: opts.token,
    signingSecret: opts.signingSecret,
    appToken: opts.appToken,
    socketMode: opts.socketMode,
  })
}
