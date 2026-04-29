/**
 * `yalc-gtm keys:connect [provider] [--open]` — open the SPA's
 * /keys/connect form, then poll the sentinel file the form drops at
 * `~/.gtm-os/_handoffs/keys/<provider>.ready` (or any file there in
 * agnostic mode).
 *
 * Two shapes:
 *   keys:connect <id> [--open]    Schema-driven route; sentinel pinned
 *                                  to `<id>.ready`.
 *   keys:connect [--open]         Agnostic route; the user picks the
 *                                  provider in the UI. We poll the
 *                                  whole `_handoffs/keys/` directory
 *                                  and exit when ANY new sentinel
 *                                  appears.
 *
 * The sentinel signals "the form was submitted" — NOT "the keys work".
 * The selfHealthCheck status comes back via the /api/keys/save JSON
 * response on the SPA side; the CLI re-reads the sentinel JSON for the
 * status string for diagnostic output.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { openBrowser } from '../../lib/cli/open-browser.js'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const POLL_INTERVAL_MS = 2000

export interface KeysConnectOptions {
  /** Override $HOME (sandbox tests). */
  homeOverride?: string
  /** Override the polling timeout (tests). */
  timeoutMs?: number
  /** Override the polling interval (tests). */
  pollIntervalMs?: number
  /** Override the platform for openBrowser (tests). */
  platform?: NodeJS.Platform
  /** Override spawn for openBrowser (tests). */
  spawner?: typeof import('node:child_process').spawn
  /** When true, skip the sentinel wait (returns immediately). */
  skipPoll?: boolean
  /** When false, do not call openBrowser. */
  open?: boolean
  /** Override base URL the browser is opened against (tests). */
  baseUrl?: string
  /** Pre-existing sentinel snapshot to compare against in agnostic mode. */
  ignoreExistingSentinels?: boolean
  /** Clock injection (tests). */
  now?: () => number
}

export interface KeysConnectResult {
  url: string
  exitCode: number
  status: 'configured' | 'failed' | 'timeout'
  /** Path of the sentinel that ended the wait — when one was found. */
  sentinelPath: string | null
  /** Slug parsed from the sentinel filename (agnostic mode only). */
  resolvedProvider: string | null
}

function gtmHome(opts: KeysConnectOptions): string {
  return join(opts.homeOverride ?? process.env.HOME ?? homedir(), '.gtm-os')
}

function handoffDir(opts: KeysConnectOptions): string {
  return join(gtmHome(opts), '_handoffs', 'keys')
}

function snapshotSentinels(dir: string): Set<string> {
  if (!existsSync(dir)) return new Set()
  try {
    return new Set(readdirSync(dir).filter((f) => f.endsWith('.ready')))
  } catch {
    return new Set()
  }
}

function readSentinelStatus(file: string): string | null {
  try {
    const raw = readFileSync(file, 'utf-8')
    const parsed = JSON.parse(raw) as { healthcheck_status?: unknown }
    if (typeof parsed.healthcheck_status === 'string') return parsed.healthcheck_status
  } catch {
    // Sentinel may be empty (legacy connect-provider sentinels) — fall through.
  }
  return null
}

export async function runKeysConnect(
  providerArg: string | undefined,
  opts: KeysConnectOptions = {},
): Promise<KeysConnectResult> {
  const baseUrl = opts.baseUrl ?? 'http://localhost:3847'
  const provider = providerArg && providerArg.trim() !== '' ? providerArg.trim() : null
  const url = provider
    ? `${baseUrl}/keys/connect?provider=${encodeURIComponent(provider)}`
    : `${baseUrl}/keys/connect`

  if (opts.open !== false) {
    openBrowser(url, { platform: opts.platform, spawner: opts.spawner })
  }

  const dir = handoffDir(opts)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  // Snapshot what's there before we start polling so agnostic mode only
  // exits on a NEW sentinel (the user might have rotated something earlier
  // and the file is still on disk).
  const baseline = opts.ignoreExistingSentinels === false
    ? new Set<string>()
    : snapshotSentinels(dir)

  if (opts.skipPoll) {
    return {
      url,
      exitCode: 0,
      status: 'configured',
      sentinelPath: null,
      resolvedProvider: provider,
    }
  }

  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const interval = opts.pollIntervalMs ?? POLL_INTERVAL_MS
  const clock = opts.now ?? Date.now
  const deadline = clock() + timeout

  while (clock() < deadline) {
    if (provider) {
      const sentinel = join(dir, `${provider}.ready`)
      if (existsSync(sentinel) && !baseline.has(`${provider}.ready`)) {
        const status = readSentinelStatus(sentinel)
        return {
          url,
          exitCode: 0,
          status: status === 'ok' ? 'configured' : 'failed',
          sentinelPath: sentinel,
          resolvedProvider: provider,
        }
      }
    } else {
      const current = snapshotSentinels(dir)
      for (const f of current) {
        if (!baseline.has(f)) {
          const sentinel = join(dir, f)
          const status = readSentinelStatus(sentinel)
          return {
            url,
            exitCode: 0,
            status: status === 'ok' ? 'configured' : 'failed',
            sentinelPath: sentinel,
            resolvedProvider: f.replace(/\.ready$/, ''),
          }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  return {
    url,
    exitCode: 1,
    status: 'timeout',
    sentinelPath: null,
    resolvedProvider: provider,
  }
}
