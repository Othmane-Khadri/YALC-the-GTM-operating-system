/**
 * macOS desktop channel sender for gate notifications (D2).
 *
 * Shells out to `osascript -e 'display notification "<body>" with title "<title>"'`.
 * On non-darwin platforms, emits a one-shot `console.warn` per process and
 * returns without doing anything — there is no portable cross-platform
 * notification primitive in stdlib node, and this module's v1 is darwin-only.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DesktopSendArgs } from './types.js'

const execFileAsync = promisify(execFile)

let warnedNonDarwin = false

/** Test-only: reset the one-shot warn flag. */
export function __resetDesktopWarnedForTests(): void {
  warnedNonDarwin = false
}

/**
 * Escape a string for safe interpolation into an AppleScript double-quoted
 * literal. AppleScript escapes `"` as `\"` and `\` as `\\`.
 */
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function defaultExec(bin: string, args: string[]): Promise<void> {
  await execFileAsync(bin, args)
}

export async function sendDesktopNotification(
  args: DesktopSendArgs,
): Promise<void> {
  const platform = args.platform ?? process.platform
  if (platform !== 'darwin') {
    if (!warnedNonDarwin) {
      warnedNonDarwin = true
      // eslint-disable-next-line no-console
      console.warn(
        `[notifications/desktop] non-darwin platform "${platform}" — desktop notifications are macOS-only and will be skipped.`,
      )
    }
    return
  }
  const exec = args.exec ?? defaultExec
  const safeTitle = escapeAppleScript(args.title)
  const safeBody = escapeAppleScript(args.body)
  const script = `display notification "${safeBody}" with title "${safeTitle}"`
  await exec('osascript', ['-e', script])
}
