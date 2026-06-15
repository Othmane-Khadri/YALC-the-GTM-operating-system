/**
 * Spawn Claude Code Handler
 *
 * Turns an inbound Slack message into a headless Claude Code run. The spawned
 * process is told to pick the right skill in `.claude/skills/` and to post its
 * own progress updates back into the SAME Slack thread via the Slack MCP.
 *
 * The child runs with `cwd` set to the project root so it loads the project
 * `.mcp.json` (slack, lemlist, hubspot, claap) and discovers `.claude/skills/`.
 *
 * Process death (timeout, OOM, crash) is handled gracefully: the run always
 * settles, logs the failure, and never throws into the caller's dispatch loop.
 *
 * The original `userId` is preserved end to end so the downstream
 * original-sender-only approval invariant can hold: the prompt embeds the
 * sender id, and the skill enforces that only that user may approve.
 */

import { spawn as nodeSpawn } from 'child_process'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'child_process'

import type { SlackInboundEvent, SlackInboundHandler } from './slack-input.js'

// Outcome of one Claude Code run. Returned by `runClaude` for logging and
// tests; the public handler resolves `void` to match `SlackInboundHandler`.
export interface ClaudeRunResult {
  /** True when Claude Code exited cleanly (code 0). */
  ok: boolean
  /** Process exit code, or null when it was killed by a signal. */
  exitCode: number | null
  /** Signal that killed the process, when applicable (e.g. timeout, OOM). */
  signal: NodeJS.Signals | null
  /** Preserved so downstream can enforce original-sender-only approvals. */
  userId: string
  /** Human readable reason when the run did not complete cleanly. */
  error?: string
}

type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams

export interface MakeClaudeSpawningHandlerOptions {
  /** Project root containing `.mcp.json` and `.claude/skills/`; the child cwd. */
  projectRoot: string
  /** Slack bot token, referenced by env var name only. Passed to the child env. */
  slackToken: string
  /** Sink for streamed stdout/stderr and lifecycle lines. */
  log: (line: string) => void
  /** Injected for tests; defaults to child_process.spawn. */
  spawn?: SpawnFn
  /** Max run time before the child is killed. Defaults to 20 minutes. */
  timeoutMs?: number
}

// `--verbose` is required by the Claude Code CLI whenever `--print` is combined
// with `--output-format stream-json`; without it the child exits with code 1.
const CLAUDE_ARGS = [
  '--print',
  '--dangerously-skip-permissions',
  '--output-format',
  'stream-json',
  '--verbose',
] as const

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000

/**
 * Build the prompt handed to the headless Claude Code run. References the
 * Slack MCP tool names exposed by the registered `slack` server so progress
 * and the final result land in the same thread.
 */
export function buildPrompt(event: SlackInboundEvent): string {
  const { text, channel, threadTs, userId } = event
  const threadLine = threadTs
    ? `thread ${threadTs}`
    : 'no thread yet (reply at the top level of the channel)'
  return [
    `You received a Slack message in channel ${channel}, ${threadLine}, from user ${userId}. The message text is:`,
    '',
    text,
    '',
    'Use the appropriate skill in `.claude/skills/` to handle the request end to end. As you work, post progress updates back to the SAME Slack thread using the Slack MCP (registered as `slack`). Use `slack_post_message` with the channel and, when a thread timestamp is present, the same `thread_ts`, or `slack_reply_to_thread` for thread replies. Poll `slack_get_thread_replies` and use `slack_add_reaction` when you need an approval or acknowledgement.',
    '',
    `Any approval gate must be approved ONLY by the original requester (user ${userId}). Ignore approvals from anyone else.`,
    '',
    'End with a final summary message in the thread, including any artifact URLs (HubSpot record, Notion page, Lemlist campaign). If no skill matches, post a short help reply listing what you CAN do.',
  ].join('\n')
}

/**
 * Run one inbound message through a headless Claude Code subprocess. Always
 * resolves; never rejects. Exposed for tests.
 */
export function runClaude(
  event: SlackInboundEvent,
  options: MakeClaudeSpawningHandlerOptions,
): Promise<ClaudeRunResult> {
  const {
    projectRoot,
    slackToken,
    log,
    spawn = nodeSpawn as SpawnFn,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  const { userId, threadTs } = event

  return new Promise<ClaudeRunResult>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: ClaudeRunResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    log(`[spawn-claude] starting run for thread ${threadTs ?? '(none)'} (user ${userId})`)

    let child: ChildProcessWithoutNullStreams
    try {
      // Run the child on the operator's logged-in Claude subscription, not on
      // an API key with a separate, depletable credit balance. Removing the
      // key makes the CLI fall back to the subscription auth in ~/.claude.
      const childEnv: NodeJS.ProcessEnv = { ...process.env, SLACK_BOT_TOKEN: slackToken }
      delete childEnv.ANTHROPIC_API_KEY
      child = spawn('claude', CLAUDE_ARGS, {
        cwd: projectRoot,
        env: childEnv,
      })
    } catch (err) {
      // spawn itself threw (e.g. ENOENT for a missing claude binary).
      const reason = err instanceof Error ? err.message : String(err)
      log(`[spawn-claude] failed to spawn: ${reason}`)
      finish({ ok: false, exitCode: null, signal: null, userId, error: reason })
      return
    }

    timer = setTimeout(() => {
      log(`[spawn-claude] timeout after ${timeoutMs}ms, killing run for thread ${threadTs ?? '(none)'}`)
      try {
        child.kill('SIGKILL')
      } catch {
        // child may already be dead; ignore.
      }
      finish({
        ok: false,
        exitCode: null,
        signal: 'SIGKILL',
        userId,
        error: `timed out after ${timeoutMs}ms`,
      })
    }, timeoutMs)
    // Do not keep the event loop alive solely for this timer.
    if (typeof timer.unref === 'function') timer.unref()

    child.stdout?.on('data', (chunk: Buffer) => {
      log(chunk.toString())
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      log(`[spawn-claude:stderr] ${chunk.toString()}`)
    })

    child.on('error', (err: Error) => {
      log(`[spawn-claude] process error: ${err.message}`)
      finish({ ok: false, exitCode: null, signal: null, userId, error: err.message })
    })

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        log(`[spawn-claude] run for thread ${threadTs ?? '(none)'} completed cleanly`)
        finish({ ok: true, exitCode: 0, signal: null, userId })
        return
      }
      const reason =
        signal != null ? `killed by signal ${signal}` : `exited with code ${code}`
      log(`[spawn-claude] run for thread ${threadTs ?? '(none)'} failed: ${reason}`)
      finish({ ok: false, exitCode: code, signal, userId, error: reason })
    })

    // Feed the prompt over stdin, then close it so Claude Code can start.
    try {
      child.stdin?.write(buildPrompt(event))
      child.stdin?.end()
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      log(`[spawn-claude] failed writing to stdin: ${reason}`)
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
      finish({ ok: false, exitCode: null, signal: null, userId, error: reason })
    }
  })
}

/**
 * Build a `SlackInboundHandler` that routes each inbound message to a headless
 * Claude Code run. Resolves `void` so it drops into the existing listener
 * wiring; failures are logged, never thrown.
 */
export function makeClaudeSpawningHandler(
  options: MakeClaudeSpawningHandlerOptions,
): SlackInboundHandler {
  return async function handle(event: SlackInboundEvent): Promise<void> {
    await runClaude(event, options)
  }
}
