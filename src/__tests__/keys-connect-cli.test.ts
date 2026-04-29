/**
 * Tests for `yalc-gtm keys:connect [provider] [--open]` (0.9.D).
 *
 * The CLI delegates to `runKeysConnect()`. Each test stubs `spawn` (so no
 * real browser launches) and writes/reads sentinel files in a hermetic
 * temp directory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-keys-connect-cli-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
})

describe('keys:connect — open browser to the route URL', () => {
  it('opens /keys/connect?provider=<id> on darwin via the platform opener', async () => {
    const { runKeysConnect } = await import('../cli/commands/keys-connect')
    const spawner = vi.fn(() => ({ unref: () => {} }))
    const result = await runKeysConnect('crustdata', {
      homeOverride: TMP,
      platform: 'darwin',
      spawner: spawner as unknown as typeof import('node:child_process').spawn,
      timeoutMs: 50,
    })
    const call = spawner.mock.calls[0] as unknown as [string, string[], unknown]
    expect(call[0]).toBe('open')
    expect(call[1]).toContain(
      'http://localhost:3847/keys/connect?provider=crustdata',
    )
    expect(result.url).toContain('provider=crustdata')
  })
})

describe('keys:connect — sentinel detection', () => {
  it('exits 0 when the schema-driven sentinel appears', async () => {
    const handoffDir = join(TMP, '.gtm-os', '_handoffs', 'keys')
    mkdirSync(handoffDir, { recursive: true })
    const { runKeysConnect } = await import('../cli/commands/keys-connect')

    // Spawn the run with a long timeout, then drop the sentinel after a
    // few ms. We use the real timer so the polling loop is exercised.
    setTimeout(() => {
      writeFileSync(
        join(handoffDir, 'crustdata.ready'),
        JSON.stringify({ provider: 'crustdata', healthcheck_status: 'ok' }),
        'utf-8',
      )
    }, 50)

    const result = await runKeysConnect('crustdata', {
      homeOverride: TMP,
      open: false,
      timeoutMs: 5000,
      pollIntervalMs: 25,
    })
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('configured')
    expect(result.sentinelPath).toContain('crustdata.ready')
  })

  it('returns a non-zero exit on timeout', async () => {
    const { runKeysConnect } = await import('../cli/commands/keys-connect')
    const result = await runKeysConnect('never-arrives', {
      homeOverride: TMP,
      open: false,
      timeoutMs: 30,
      pollIntervalMs: 10,
    })
    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('timeout')
  })
})

describe('keys:connect — agnostic mode', () => {
  it('opens /keys/connect (no provider query) and polls _handoffs/keys/*.ready', async () => {
    const handoffDir = join(TMP, '.gtm-os', '_handoffs', 'keys')
    mkdirSync(handoffDir, { recursive: true })
    const { runKeysConnect } = await import('../cli/commands/keys-connect')

    const spawner = vi.fn(() => ({ unref: () => {} }))
    setTimeout(() => {
      writeFileSync(
        join(handoffDir, 'whatever-the-user-typed.ready'),
        JSON.stringify({ provider: 'whatever-the-user-typed', healthcheck_status: 'ok' }),
        'utf-8',
      )
    }, 50)

    const result = await runKeysConnect(undefined, {
      homeOverride: TMP,
      platform: 'darwin',
      spawner: spawner as unknown as typeof import('node:child_process').spawn,
      timeoutMs: 5000,
      pollIntervalMs: 25,
    })
    expect(result.exitCode).toBe(0)
    expect(result.url).toBe('http://localhost:3847/keys/connect')
    expect(result.url).not.toContain('?provider=')
    expect(result.resolvedProvider).toBe('whatever-the-user-typed')
    const call = spawner.mock.calls[0] as unknown as [string, string[], unknown]
    expect(call[1]).toContain('http://localhost:3847/keys/connect')
  })
})
