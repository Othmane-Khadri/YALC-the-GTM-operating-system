/**
 * `yalc-gtm slack:listen` (S3).
 *
 * Boots the Slack input listener (Bolt Socket Mode) and routes every inbound
 * message to a headless Claude Code subprocess. The spawned process reads the
 * matching skill in `.claude/skills/` and drives the chain end to end, posting
 * progress and the final result back to the same Slack thread via the Slack
 * MCP. The natural-language intent classifier, approval store, and the
 * original-sender-only approval invariant are preserved.
 */

import type { SlackInboundHandler, SlackInputApp } from '../../lib/server/slack-input.js'
import { createSlackInputApp } from '../../lib/server/slack-input.js'
import {
  __setApprovalStore,
  __setIntentClassifier,
  __setSlackPoster,
  createSqliteApprovalStore,
  type SlackPoster,
} from '../../lib/server/slack-approval.js'
import {
  makeChainedClassifier,
  makeLlmClassifier,
  makeRuleBasedClassifier,
} from '../../lib/server/approval-intent.js'
import { makeClaudeSpawningHandler } from '../../lib/server/spawn-claude-handler.js'

export interface SlackListenOptions {
  /** Override env source (tests). */
  fetchEnv?: () => Record<string, string | undefined>
  /** Override the input-app factory (tests). */
  buildApp?: (deps: {
    botToken: string
    signingSecret: string
    appToken: string
    handler: SlackInboundHandler
  }) => SlackInputApp
  /** Override the inbound handler (tests / real dispatcher integration). */
  handler?: SlackInboundHandler
  /** Optional logger seam. */
  log?: (line: string) => void
}

export interface SlackListenResult {
  exitCode: number
  output: string
  app?: SlackInputApp
}

const REQUIRED_VARS = ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_APP_TOKEN'] as const

const DEFAULT_HANDLER: SlackInboundHandler = async ({ text, channel, threadTs, userId }) => {
  process.stdout.write(
    JSON.stringify({ at: new Date().toISOString(), channel, threadTs, userId, text }) + '\n',
  )
}

export async function runSlackListen(opts: SlackListenOptions = {}): Promise<SlackListenResult> {
  const env = opts.fetchEnv ? opts.fetchEnv() : process.env
  const log = opts.log ?? ((line: string) => process.stdout.write(line + '\n'))

  const missing = REQUIRED_VARS.filter((name) => {
    const v = env[name]
    return !v || !v.trim()
  })
  if (missing.length > 0) {
    return {
      exitCode: 1,
      output: `Missing required env vars: ${missing.join(', ')}. See docs/slack-input.md.`,
    }
  }

  const botToken = env.SLACK_BOT_TOKEN!.trim()
  const signingSecret = env.SLACK_SIGNING_SECRET!.trim()
  const appToken = env.SLACK_APP_TOKEN!.trim()

  const builder = opts.buildApp ?? createSlackInputApp

  // Wire the natural-language intent classifier. When ANTHROPIC_API_KEY is set
  // we layer the LLM behind the rule-based pass; otherwise the resolver stays
  // on rules only so the listener boots even without an LLM key.
  try {
    if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim()) {
      const { getAnthropicClient } = await import('../../lib/ai/client.js')
      const client = getAnthropicClient()
      __setIntentClassifier(
        makeChainedClassifier(makeRuleBasedClassifier(), makeLlmClassifier(client)),
      )
    } else {
      __setIntentClassifier(makeRuleBasedClassifier())
    }
  } catch (err) {
    log(
      `[slack:listen] intent classifier fell back to rules only: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    __setIntentClassifier(makeRuleBasedClassifier())
  }

  // We need the Bolt app first so we can hand its WebClient to the
  // wire-agents call (the slack-gtm-agent's `poster` dep posts via Bolt).
  // The dispatcher handler is bound below via a forwarding closure; the
  // app is constructed with that closure so `start()` is only called once.
  let resolvedHandler: SlackInboundHandler =
    opts.handler ?? DEFAULT_HANDLER
  const handlerProxy: SlackInboundHandler = async (event) =>
    resolvedHandler(event)

  const app = builder({ botToken, signingSecret, appToken, handler: handlerProxy })

  // Wire the SlackPoster used by the approval store to nudge ambiguous
  // replies. We use Bolt's `WebClient.chat.postMessage` exposed on the App
  // instance so the nudge lands in the same thread as the original prompt.
  // If Bolt's client is unavailable (custom test factory) we leave the
  // store on its no-op poster.
  const boltClient =
    (app as unknown as { app?: { client?: { chat?: { postMessage?: Function } } } }).app?.client ??
    undefined
  if (boltClient?.chat?.postMessage) {
    const poster: SlackPoster = {
      async postReply(threadTs, channel, text) {
        await boltClient.chat!.postMessage!({
          channel,
          thread_ts: threadTs,
          text,
        })
      },
    }
    __setSlackPoster(poster)
  } else {
    __setSlackPoster(null)
  }

  // Route inbound messages to a headless Claude Code subprocess. The spawned
  // process reads the matching skill in `.claude/skills/` and drives the chain
  // end to end, posting progress and the final result back to the same Slack
  // thread via the Slack MCP. When the caller injects a custom handler (tests)
  // we skip this wiring entirely.
  if (!opts.handler) {
    // Keep the approval store registered so reaction/reply resolution stays
    // wired; the skill enforces the original-sender-only invariant using the
    // sender id embedded in the spawn prompt.
    try {
      __setApprovalStore(await createSqliteApprovalStore())
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`[slack:listen] approval store init failed, continuing: ${msg}`)
    }

    // The child runs from the project root (process.cwd() when launched via
    // `npx tsx src/cli/index.ts slack:listen`) so it loads `.mcp.json` and
    // discovers `.claude/skills/`.
    const projectRoot = env.GTM_OS_PROJECT_ROOT?.trim() || process.cwd()
    resolvedHandler = makeClaudeSpawningHandler({
      projectRoot,
      slackToken: botToken,
      log,
    })
    log('[slack:listen] dispatching inbound to Claude Code subprocess')
  }

  try {
    await app.start()
  } catch (err) {
    return {
      exitCode: 1,
      output: `Slack listener failed to start: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  log('[slack:listen] listening (Socket Mode)')
  return { exitCode: 0, output: '[slack:listen] listening (Socket Mode)', app }
}

