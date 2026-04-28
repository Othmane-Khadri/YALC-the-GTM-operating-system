/**
 * Framework runtime registry.
 *
 * Tracks which frameworks are installed for the current user. Installed
 * configs live at `~/.gtm-os/agents/<name>.yaml` (the existing agent
 * runner picks them up) PLUS `~/.gtm-os/frameworks/installed/<name>.json`
 * for the framework-specific metadata (output destination, resolved
 * input values, install timestamp).
 *
 * Run output (the rendered rows the dashboard / Notion adapter consume)
 * lands in `~/.gtm-os/agents/<name>.runs/<timestamp>.json`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { InstalledFrameworkConfig } from './types.js'

/**
 * Path helpers resolve $HOME at call time so HOME-overrides in test
 * harnesses (and per-process home pivots) take effect. Resolving at
 * import time would freeze the constants to whatever HOME was set when
 * the module first loaded.
 */
function gtmOsDir(): string {
  return join(homedir(), '.gtm-os')
}
function installedDir(): string {
  return join(gtmOsDir(), 'frameworks', 'installed')
}
function agentsDir(): string {
  return join(gtmOsDir(), 'agents')
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/** Path the per-user installed metadata lives at. */
export function installedConfigPath(name: string): string {
  return join(installedDir(), `${name}.json`)
}

/** Directory that holds the framework's per-run output JSON files. */
export function runsDir(name: string): string {
  return join(agentsDir(), `${name}.runs`)
}

/** Path of the agent-runner-readable schedule file. */
export function agentYamlPath(name: string): string {
  return join(agentsDir(), `${name}.yaml`)
}

/** Persist the installed-framework metadata to disk. */
export function saveInstalledConfig(cfg: InstalledFrameworkConfig): void {
  ensureDir(installedDir())
  writeFileSync(installedConfigPath(cfg.name), JSON.stringify(cfg, null, 2) + '\n', 'utf-8')
}

/** Read installed-framework metadata. Returns null if not installed. */
export function loadInstalledConfig(name: string): InstalledFrameworkConfig | null {
  const p = installedConfigPath(name)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as InstalledFrameworkConfig
  } catch {
    return null
  }
}

/** Delete the installed metadata + agent yaml + runs directory. */
export function removeInstalledConfig(name: string): void {
  for (const p of [installedConfigPath(name), agentYamlPath(name)]) {
    if (existsSync(p)) rmSync(p, { force: true })
  }
  const rd = runsDir(name)
  if (existsSync(rd)) rmSync(rd, { recursive: true, force: true })
}

/** Names of every framework that has an installed config on disk. */
export function listInstalledFrameworks(): string[] {
  const dir = installedDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort()
}

/** Latest run JSON for a framework (path + parsed). Null when no runs yet. */
export function latestRun(name: string): { path: string; data: unknown } | null {
  const rd = runsDir(name)
  if (!existsSync(rd)) return null
  const files = readdirSync(rd)
    .filter((f) => f.endsWith('.json'))
    .sort()
  if (files.length === 0) return null
  const last = files[files.length - 1]
  const path = join(rd, last)
  try {
    return { path, data: JSON.parse(readFileSync(path, 'utf-8')) }
  } catch {
    return null
  }
}

/** Mark an installed framework as enabled / disabled (preserves config). */
export function setFrameworkDisabled(name: string, disabled: boolean): boolean {
  const cfg = loadInstalledConfig(name)
  if (!cfg) return false
  cfg.disabled = disabled
  saveInstalledConfig(cfg)
  return true
}
