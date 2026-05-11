/**
 * `yalc-gtm dashboard` (alias `ui`) — summon the SPA from anywhere.
 *
 * Today the SPA only opens at the end of `start --non-interactive`. Operators
 * who want to re-check state had to re-run setup or hit `campaign:dashboard`
 * (which forces them onto the legacy `/campaigns` route). This command:
 *
 *   1. Probes port 3847 over loopback. If something is listening, it does
 *      NOT spawn a second server — it just opens the browser and prints
 *      the URL. Idempotent across repeated invocations.
 *   2. If the port is free, spawns the dashboard server detached (same
 *      mechanism used by `start`) and waits up to 10s for it to come up.
 *   3. Resolves the route from disk:
 *        - `~/.gtm-os/company_context.yaml` missing  → `/setup/review`
 *        - present                                   → `/today`
 *        - `--route <path>` overrides both
 *   4. Always prints the URL so SSH'd-in operators can copy it. Browser
 *      auto-open is best-effort; failures fall through to the printed URL.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { spawn as nodeSpawn } from 'node:child_process'
import { isArchetypeId } from '../../lib/frameworks/archetypes.js'

const DEFAULT_PORT = 3847

export interface DashboardCliOptions {
  /** Override $HOME for hermetic tests. */
  homeOverride?: string
  /** Route override — if provided, bypasses the on-disk inference. */
  route?: string
  /** Server port. Defaults to 3847. */
  port?: number
  /** Open the browser. Defaults to true. Set false for headless / tests. */
  open?: boolean
  /** Test override for the port probe. */
  isPortListening?: (port: number) => Promise<boolean>
  /** Test override for the server-spawn helper. Returns the spawned PID. */
  spawnServer?: (port: number) => Promise<number | null>
  /** Test override for the browser-open helper. */
  openBrowser?: (
    url: string,
  ) => { attempted: boolean; launched: boolean; command: string | null; reason?: string }
  /** Platform override forwarded to openBrowser when no override is set. */
  platform?: NodeJS.Platform
  /** Spawner override forwarded to openBrowser when no override is set. */
  spawner?: typeof nodeSpawn
  /** Cap on how long to wait for a freshly-spawned server (ms). */
  waitTimeoutMs?: number
  /** Poll interval while waiting for the server to come up (ms). */
  waitIntervalMs?: number
  /**
   * Open the archetype-specific dashboard. Takes precedence over `route`.
   * Accepts a-d (case-insensitive). Unknown values cause a non-zero exit.
   */
  archetype?: string
}

export interface DashboardCliResult {
  exitCode: number
  url: string
  route: string
  port: number
  /** True when an existing server was reused (no spawn). */
  alreadyRunning: boolean
  /** PID of the spawned server, when we spawned one. */
  spawnedPid: number | null
}

function gtmHome(opts: DashboardCliOptions): string {
  return join(opts.homeOverride ?? process.env.HOME ?? homedir(), '.gtm-os')
}

function normaliseRoute(route: string): string {
  const trimmed = route.trim()
  if (!trimmed) return '/'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function resolveRoute(opts: DashboardCliOptions): string {
  // --archetype wins over --route so users can pin a specific dashboard.
  if (opts.archetype && opts.archetype.trim() !== '') {
    return `/dashboard/${opts.archetype.trim().toLowerCase()}`
  }
  if (opts.route && opts.route.trim() !== '') {
    return normaliseRoute(opts.route)
  }
  const ctxPath = join(gtmHome(opts), 'company_context.yaml')
  return existsSync(ctxPath) ? '/today' : '/setup/review'
}

/**
 * Detect whether something is already listening on the given port.
 * Mirrors the helper used by `runStart` so behaviour is consistent.
 */
async function defaultIsPortListening(port: number, host = '127.0.0.1'): Promise<boolean> {
  const { createConnection } = await import('node:net')
  return new Promise((resolve) => {
    const socket = createConnection({ port, host })
    let settled = false
    const done = (result: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    setTimeout(() => done(false), 1000)
  })
}

/**
 * Spawn the dashboard server as a detached child process so it survives
 * this CLI's exit. Re-uses the same node binary + CLI entry point so it
 * works inside sandboxed installs where `yalc-gtm` may not be on PATH.
 */
async function defaultSpawnServer(port: number): Promise<number | null> {
  try {
    const { spawn } = await import('node:child_process')
    const cliEntry = process.argv[1]
    if (!cliEntry) return null
    const child = spawn(
      process.execPath,
      [cliEntry, 'campaign:dashboard', '--port', String(port)],
      {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      },
    )
    if (typeof child.unref === 'function') child.unref()
    return child.pid ?? null
  } catch {
    return null
  }
}

export async function runDashboard(
  opts: DashboardCliOptions = {},
): Promise<DashboardCliResult> {
  const port = opts.port ?? DEFAULT_PORT

  // Validate --archetype before any side-effects so we exit cleanly without
  // probing the port or printing a confusing URL.
  if (opts.archetype !== undefined && opts.archetype.trim() !== '') {
    if (!isArchetypeId(opts.archetype.trim())) {
      console.error(
        `Unknown archetype "${opts.archetype}". Expected one of a, b, c, d.`,
      )
      return {
        exitCode: 1,
        url: '',
        route: '',
        port,
        alreadyRunning: false,
        spawnedPid: null,
      }
    }
  }

  const route = resolveRoute(opts)
  const url = `http://localhost:${port}${route}`

  const probe = opts.isPortListening ?? defaultIsPortListening
  const spawner = opts.spawnServer ?? defaultSpawnServer
  const waitTimeout = opts.waitTimeoutMs ?? 10_000
  const waitInterval = opts.waitIntervalMs ?? 500

  let alreadyRunning = false
  let spawnedPid: number | null = null

  if (await probe(port).catch(() => false)) {
    alreadyRunning = true
  } else {
    spawnedPid = await spawner(port)
    if (spawnedPid !== null) {
      const deadline = Date.now() + waitTimeout
      while (Date.now() < deadline) {
        if (await probe(port).catch(() => false)) break
        await new Promise((r) => setTimeout(r, waitInterval))
      }
    }
  }

  console.log(`URL: ${url}`)
  if (alreadyRunning) {
    console.log(`Server already running on port ${port}.`)
  } else if (spawnedPid !== null) {
    console.log(
      `Started dashboard server on :${port} (pid: ${spawnedPid}). Stop later with: kill ${spawnedPid}`,
    )
  } else {
    console.log(
      `Could not auto-spawn the dashboard server. In another terminal run:`,
    )
    console.log(`  yalc-gtm campaign:dashboard --port ${port}`)
  }

  if (opts.open !== false) {
    if (opts.openBrowser) {
      try {
        opts.openBrowser(url)
      } catch {
        // Best-effort — printed URL is the fallback.
      }
    } else {
      try {
        const { openBrowser } = await import('../../lib/cli/open-browser.js')
        openBrowser(url, { platform: opts.platform, spawner: opts.spawner })
      } catch {
        // Best-effort — printed URL is the fallback.
      }
    }
  }

  return {
    exitCode: 0,
    url,
    route,
    port,
    alreadyRunning,
    spawnedPid,
  }
}
