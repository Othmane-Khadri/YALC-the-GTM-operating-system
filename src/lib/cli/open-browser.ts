/**
 * Cross-platform browser-open helper for the post-capture handoff (0.9.B).
 *
 * The CLI's `start --non-interactive --website <url>` flow ends by handing
 * the user off to the SPA at /setup/review. We try to launch the browser
 * automatically using the platform's standard opener — `open` on macOS,
 * `xdg-open` on Linux, `start` on Windows — but the launch is always a
 * best-effort: failures fall through to a printed URL so the user can copy
 * it manually.
 *
 * Safe to call from non-interactive contexts: caller passes `noOpen` (e.g.
 * from `--no-open`) to suppress the launch entirely.
 */

import { spawn } from 'node:child_process'

export interface OpenBrowserOptions {
  /** When true, return without launching the browser. */
  noOpen?: boolean
  /** Platform override for tests. Defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** Process spawner override for tests. */
  spawner?: typeof spawn
}

export interface OpenBrowserResult {
  attempted: boolean
  launched: boolean
  command: string | null
  reason?: string
}

export function openBrowser(
  url: string,
  options: OpenBrowserOptions = {},
): OpenBrowserResult {
  if (options.noOpen) {
    return { attempted: false, launched: false, command: null, reason: 'no-open flag' }
  }
  const platform = options.platform ?? process.platform
  const spawner = options.spawner ?? spawn

  let command: string
  let args: string[]
  if (platform === 'darwin') {
    command = 'open'
    args = [url]
  } else if (platform === 'win32') {
    // `start` is a cmd-builtin so we shell out via cmd /c. The empty quoted
    // first arg is required by `start` to handle window titles correctly.
    command = 'cmd'
    args = ['/c', 'start', '""', url]
  } else {
    command = 'xdg-open'
    args = [url]
  }

  try {
    const child = spawner(command, args, {
      stdio: 'ignore',
      detached: true,
    })
    if (child && typeof (child as { unref?: () => void }).unref === 'function') {
      ;(child as { unref?: () => void }).unref?.()
    }
    return { attempted: true, launched: true, command }
  } catch (err) {
    return {
      attempted: true,
      launched: false,
      command,
      reason: err instanceof Error ? err.message : 'spawn failed',
    }
  }
}
