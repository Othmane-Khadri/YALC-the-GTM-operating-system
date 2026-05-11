/**
 * Notifications config loader (D2).
 *
 * Reads `~/.gtm-os/config.yaml` and surfaces the `notifications:` block.
 * When the block (or the file) is absent, returns the defaults:
 *   - slack: false
 *   - desktop: true on darwin, false elsewhere
 *
 * Resolved at call time so HOME pivots in tests apply.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { NotificationsConfig } from './types.js'

export function defaultNotificationsConfig(
  platform: NodeJS.Platform | string = process.platform,
): NotificationsConfig {
  return { slack: false, desktop: platform === 'darwin' }
}

export function loadNotificationsConfig(
  platform: NodeJS.Platform | string = process.platform,
): NotificationsConfig {
  const cfgPath = join(homedir(), '.gtm-os', 'config.yaml')
  const fallback = defaultNotificationsConfig(platform)
  if (!existsSync(cfgPath)) return fallback
  try {
    const raw = readFileSync(cfgPath, 'utf-8')
    const parsed = (yaml.load(raw) as Record<string, unknown> | null) ?? {}
    const block = parsed.notifications as Record<string, unknown> | undefined
    if (!block || typeof block !== 'object') return fallback
    return {
      slack: typeof block.slack === 'boolean' ? block.slack : fallback.slack,
      desktop: typeof block.desktop === 'boolean' ? block.desktop : fallback.desktop,
    }
  } catch {
    // Malformed YAML / read errors: never throw from the notification path.
    return fallback
  }
}
