/**
 * Unit tests for the Claude Code spawning Slack handler.
 *
 * child_process.spawn is always mocked. The real `claude` binary is never
 * launched.
 */

import { EventEmitter } from 'events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildPrompt,
  makeClaudeSpawningHandler,
  runClaude,
} from '../spawn-claude-handler'
import type { SlackInboundEvent } from '../slack-input'

// Fake child process plumbing.

class FakeStream extends EventEmitter {
  public written: string[] = []
  public ended = false
  write(data: string) {
    this.written.push(data)
    return true
  }
  end() {
    this.ended = true
  }
}

class FakeChild extends EventEmitter {
  public stdout = new FakeStream()
  public stderr = new FakeStream()
  public stdin = new FakeStream()
  public killed: NodeJS.Signals | undefined
  kill(signal?: NodeJS.Signals) {
    this.killed = signal ?? 'SIGTERM'
    return true
  }
}

const event: SlackInboundEvent = {
  text: 'qualify these leads from the attached csv',
  channel: 'C12345',
  threadTs: '1700000000.000100',
  userId: 'U99999',
}

const baseOpts = {
  projectRoot: '/work/project-root',
  slackToken: 'xoxb-test-token',
  log: () => {},
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runClaude', () => {
  it('spawns claude with the exact headless args, cwd, and token env', async () => {
    const child = new FakeChild()
    const spawn = vi.fn().mockReturnValue(child)

    const promise = runClaude(event, { ...baseOpts, spawn: spawn as never })
    child.emit('close', 0, null)
    const result = await promise

    expect(spawn).toHaveBeenCalledTimes(1)
    const [command, args, opts] = spawn.mock.calls[0]
    expect(command).toBe('claude')
    expect(args).toEqual([
      '--print',
      '--dangerously-skip-permissions',
      '--output-format',
      'stream-json',
      '--verbose',
    ])
    expect(opts.cwd).toBe('/work/project-root')
    expect(opts.env.SLACK_BOT_TOKEN).toBe('xoxb-test-token')

    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.userId).toBe('U99999')
  })

  it('writes the prompt to stdin and closes it', async () => {
    const child = new FakeChild()
    const spawn = vi.fn().mockReturnValue(child)

    const promise = runClaude(event, { ...baseOpts, spawn: spawn as never })
    child.emit('close', 0, null)
    await promise

    expect(child.stdin.written).toHaveLength(1)
    expect(child.stdin.written[0]).toBe(buildPrompt(event))
    expect(child.stdin.ended).toBe(true)
  })

  it('does not crash and reports failure when the child exits non-zero', async () => {
    const child = new FakeChild()
    const spawn = vi.fn().mockReturnValue(child)

    const promise = runClaude(event, { ...baseOpts, spawn: spawn as never })
    child.emit('close', 137, null)
    const result = await promise

    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(137)
    expect(result.userId).toBe('U99999')
    expect(result.error).toContain('137')
  })

  it('does not crash when the child emits an error event', async () => {
    const child = new FakeChild()
    const spawn = vi.fn().mockReturnValue(child)

    const promise = runClaude(event, { ...baseOpts, spawn: spawn as never })
    child.emit('error', new Error('spawn ENOENT'))
    const result = await promise

    expect(result.ok).toBe(false)
    expect(result.error).toContain('ENOENT')
    expect(result.userId).toBe('U99999')
  })

  it('does not crash when spawn itself throws', async () => {
    const spawn = vi.fn(() => {
      throw new Error('spawn ENOENT')
    })

    const result = await runClaude(event, { ...baseOpts, spawn: spawn as never })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('ENOENT')
    expect(result.userId).toBe('U99999')
  })

  it('kills the child and reports timeout when the run runs too long', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const spawn = vi.fn().mockReturnValue(child)

    const promise = runClaude(event, {
      ...baseOpts,
      spawn: spawn as never,
      timeoutMs: 5000,
    })
    vi.advanceTimersByTime(5001)
    const result = await promise

    expect(child.killed).toBe('SIGKILL')
    expect(result.ok).toBe(false)
    expect(result.signal).toBe('SIGKILL')
    expect(result.error).toContain('timed out')
    vi.useRealTimers()
  })

  it('streams stdout and stderr to the log', async () => {
    const child = new FakeChild()
    const spawn = vi.fn().mockReturnValue(child)
    const lines: string[] = []

    const promise = runClaude(event, {
      ...baseOpts,
      log: (l) => lines.push(l),
      spawn: spawn as never,
    })
    child.stdout.emit('data', Buffer.from('{"type":"progress"}'))
    child.stderr.emit('data', Buffer.from('a warning'))
    child.emit('close', 0, null)
    await promise

    expect(lines.some((l) => l.includes('{"type":"progress"}'))).toBe(true)
    expect(lines.some((l) => l.includes('a warning'))).toBe(true)
  })

  it('does not pass ANTHROPIC_API_KEY to the child (uses subscription auth)', async () => {
    const child = new FakeChild()
    const spawn = vi.fn().mockReturnValue(child)
    const prev = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-propagate'

    const promise = runClaude(event, { ...baseOpts, spawn: spawn as never })
    child.emit('close', 0, null)
    await promise

    const [, , opts] = spawn.mock.calls[0]
    expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(opts.env.SLACK_BOT_TOKEN).toBe('xoxb-test-token')

    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = prev
  })

  it('handles a DM with no thread timestamp', async () => {
    const child = new FakeChild()
    const spawn = vi.fn().mockReturnValue(child)
    const dm: SlackInboundEvent = { ...event, threadTs: undefined }

    const promise = runClaude(dm, { ...baseOpts, spawn: spawn as never })
    child.emit('close', 0, null)
    const result = await promise

    expect(result.ok).toBe(true)
    expect(child.stdin.written[0]).toBe(buildPrompt(dm))
  })
})

describe('makeClaudeSpawningHandler', () => {
  it('returns a handler that resolves void and conforms to SlackInboundHandler', async () => {
    const child = new FakeChild()
    const spawn = vi.fn().mockReturnValue(child)
    const handler = makeClaudeSpawningHandler({ ...baseOpts, spawn: spawn as never })

    const promise = handler(event)
    child.emit('close', 0, null)
    const result = await promise

    expect(result).toBeUndefined()
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})

describe('buildPrompt', () => {
  it('embeds channel, thread, user, and message text', () => {
    const prompt = buildPrompt(event)
    expect(prompt).toContain('channel C12345')
    expect(prompt).toContain('thread 1700000000.000100')
    expect(prompt).toContain('from user U99999')
    expect(prompt).toContain('qualify these leads from the attached csv')
  })

  it('instructs the model to use a skill and reply in the same thread', () => {
    const prompt = buildPrompt(event)
    expect(prompt).toContain('.claude/skills/')
    expect(prompt).toContain('thread_ts')
    expect(prompt).toContain('If no skill matches')
  })

  it('embeds the original-sender-only approval constraint', () => {
    const prompt = buildPrompt(event)
    expect(prompt).toContain('original requester')
    expect(prompt).toContain('U99999')
  })

  it('describes top-level reply behaviour when there is no thread', () => {
    const prompt = buildPrompt({ ...event, threadTs: undefined })
    expect(prompt).toContain('no thread yet')
  })
})
