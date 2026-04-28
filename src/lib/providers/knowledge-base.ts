/**
 * Provider knowledge base.
 *
 * Each `configs/providers/<id>.yaml` describes ONE provider — what it does,
 * how to acquire a key, what env vars it needs, which capabilities it
 * implements, and an optional canary `test_query`. The `connect-provider`
 * skill + CLI command consume this knowledge to walk a user through
 * adding a new provider end-to-end.
 *
 * Two roots are scanned:
 *   1. Bundled — `<PKG_ROOT>/configs/providers/*.yaml`. Ships with the
 *      package; covers every provider the codebase has first-class
 *      support for.
 *   2. User — `~/.gtm-os/providers/*.yaml`. Owned by the user (and
 *      written by the `connect-provider` custom-provider flow). Files
 *      here override bundled entries with the same `id`.
 *
 * The schema is intentionally narrow: we describe install UX, not
 * runtime behavior. Adapter modules / MCP templates remain the source
 * of truth for runtime execution.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { PKG_ROOT } from '../paths.js'

export type ProviderIntegrationKind = 'rest' | 'mcp' | 'builtin'

export interface ProviderEnvVar {
  name: string
  description?: string
  example?: string
  required?: boolean
}

export interface ProviderCapabilityBinding {
  id: string
  adapter_module?: string
}

export interface ProviderTestQuery {
  capability: string
  input?: Record<string, unknown>
}

export interface ProviderKnowledge {
  id: string
  display_name: string
  homepage?: string
  docs_url?: string
  key_acquisition_url?: string
  integration_kind: ProviderIntegrationKind
  /** When `integration_kind: mcp`, the bundled MCP template name in `configs/mcp/<name>.json`. */
  mcp_template?: string | null
  env_vars: ProviderEnvVar[]
  capabilities_supported: ProviderCapabilityBinding[]
  install_steps: string[]
  test_query?: ProviderTestQuery | null
  /**
   * Source root of this entry — set by the loader. Lets callers tell a
   * user-override apart from a bundled entry without re-reading the disk.
   */
  source?: 'bundled' | 'user'
  /** Absolute path the entry was loaded from — diagnostics only. */
  source_path?: string
}

const VALID_KINDS: ProviderIntegrationKind[] = ['rest', 'mcp', 'builtin']

export class ProviderKnowledgeError extends Error {
  readonly file: string
  readonly issues: string[]
  constructor(file: string, issues: string[]) {
    super(`Invalid provider yaml at ${file}:\n  - ${issues.join('\n  - ')}`)
    this.name = 'ProviderKnowledgeError'
    this.file = file
    this.issues = issues
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0)
}

/**
 * Validate + coerce one parsed yaml object into a `ProviderKnowledge`.
 * Returns the parsed value plus a list of validation issues — callers
 * can decide whether to throw or to log + skip.
 */
export function parseProviderKnowledge(
  raw: unknown,
  file: string,
): { value: ProviderKnowledge | null; issues: string[] } {
  const issues: string[] = []
  if (!raw || typeof raw !== 'object') {
    return { value: null, issues: [`top-level must be a yaml mapping`] }
  }
  const obj = raw as Record<string, unknown>

  if (typeof obj.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(obj.id)) {
    issues.push('"id" must be a lowercase slug (a-z0-9-)')
  }
  if (typeof obj.display_name !== 'string' || obj.display_name.trim() === '') {
    issues.push('"display_name" must be a non-empty string')
  }
  if (typeof obj.integration_kind !== 'string' || !VALID_KINDS.includes(obj.integration_kind as ProviderIntegrationKind)) {
    issues.push(`"integration_kind" must be one of: ${VALID_KINDS.join(', ')}`)
  }

  // env_vars
  const envVars: ProviderEnvVar[] = []
  if (obj.env_vars !== undefined) {
    if (!Array.isArray(obj.env_vars)) {
      issues.push('"env_vars" must be an array')
    } else {
      for (let i = 0; i < obj.env_vars.length; i++) {
        const item = obj.env_vars[i] as Record<string, unknown> | undefined
        if (!item || typeof item !== 'object') {
          issues.push(`env_vars[${i}] must be a mapping`)
          continue
        }
        if (typeof item.name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(item.name)) {
          issues.push(`env_vars[${i}].name must be an UPPER_SNAKE env var name`)
          continue
        }
        envVars.push({
          name: item.name,
          description: typeof item.description === 'string' ? item.description : undefined,
          example: typeof item.example === 'string' ? item.example : undefined,
          required: item.required === undefined ? true : Boolean(item.required),
        })
      }
    }
  }

  // capabilities_supported
  const caps: ProviderCapabilityBinding[] = []
  if (obj.capabilities_supported !== undefined) {
    if (!Array.isArray(obj.capabilities_supported)) {
      issues.push('"capabilities_supported" must be an array')
    } else {
      for (let i = 0; i < obj.capabilities_supported.length; i++) {
        const item = obj.capabilities_supported[i] as Record<string, unknown> | undefined
        if (!item || typeof item !== 'object') {
          issues.push(`capabilities_supported[${i}] must be a mapping`)
          continue
        }
        if (typeof item.id !== 'string' || item.id.trim() === '') {
          issues.push(`capabilities_supported[${i}].id must be a non-empty string`)
          continue
        }
        caps.push({
          id: item.id,
          adapter_module: typeof item.adapter_module === 'string' ? item.adapter_module : undefined,
        })
      }
    }
  }

  // install_steps
  let installSteps: string[] = []
  if (obj.install_steps !== undefined) {
    if (!isStringArray(obj.install_steps)) {
      issues.push('"install_steps" must be an array of non-empty strings')
    } else {
      installSteps = obj.install_steps
    }
  }

  // test_query (optional)
  let testQuery: ProviderTestQuery | null = null
  if (obj.test_query !== undefined && obj.test_query !== null) {
    const tq = obj.test_query as Record<string, unknown>
    if (typeof tq.capability !== 'string' || tq.capability.trim() === '') {
      issues.push('"test_query.capability" must be a non-empty string')
    } else {
      testQuery = {
        capability: tq.capability,
        input: tq.input && typeof tq.input === 'object' ? (tq.input as Record<string, unknown>) : undefined,
      }
    }
  }

  // mcp_template (optional)
  let mcpTemplate: string | null = null
  if (obj.mcp_template !== undefined && obj.mcp_template !== null) {
    if (typeof obj.mcp_template === 'string' && obj.mcp_template.length > 0) {
      mcpTemplate = obj.mcp_template
    } else {
      issues.push('"mcp_template" must be a non-empty string when set')
    }
  }
  if (obj.integration_kind === 'mcp' && !mcpTemplate) {
    // Allowed but flagged — adapter authors may bundle the template
    // separately. Surface a soft note in the issues list at info level
    // (we don't currently distinguish severity).
  }

  if (issues.length > 0 || typeof obj.id !== 'string' || typeof obj.display_name !== 'string' || typeof obj.integration_kind !== 'string') {
    return { value: null, issues }
  }

  const value: ProviderKnowledge = {
    id: obj.id,
    display_name: obj.display_name,
    homepage: typeof obj.homepage === 'string' ? obj.homepage : undefined,
    docs_url: typeof obj.docs_url === 'string' ? obj.docs_url : undefined,
    key_acquisition_url: typeof obj.key_acquisition_url === 'string' ? obj.key_acquisition_url : undefined,
    integration_kind: obj.integration_kind as ProviderIntegrationKind,
    mcp_template: mcpTemplate,
    env_vars: envVars,
    capabilities_supported: caps,
    install_steps: installSteps,
    test_query: testQuery,
    source_path: file,
  }
  return { value, issues }
}

/**
 * Substitute `$<token>` references in a single install-step string. Only
 * a small whitelist of tokens are recognized — anything else is returned
 * verbatim so we never accidentally swallow text the user typed.
 */
export function templateInstallStep(step: string, k: ProviderKnowledge): string {
  return step
    .replace(/\$homepage\b/g, k.homepage ?? '')
    .replace(/\$docs_url\b/g, k.docs_url ?? '')
    .replace(/\$key_acquisition_url\b/g, k.key_acquisition_url ?? '')
    .replace(/\$display_name\b/g, k.display_name)
    .replace(/\$id\b/g, k.id)
}

function readYamlsFromDir(dir: string): Array<{ file: string; raw: unknown }> {
  if (!existsSync(dir)) return []
  let entries: string[] = []
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
  } catch {
    return []
  }
  const out: Array<{ file: string; raw: unknown }> = []
  for (const name of entries) {
    const full = join(dir, name)
    let text: string
    try {
      text = readFileSync(full, 'utf-8')
    } catch {
      continue
    }
    try {
      out.push({ file: full, raw: yaml.load(text) })
    } catch {
      out.push({ file: full, raw: null })
    }
  }
  return out
}

export interface LoadProviderKnowledgeOptions {
  /** Override the bundled directory (used by tests). */
  bundledDir?: string
  /** Override the user directory (used by tests). */
  userDir?: string
  /**
   * If true, every malformed yaml throws a `ProviderKnowledgeError`. By
   * default malformed entries are logged via `onIssue` (or silently
   * dropped if no callback is given) so a single broken yaml never bricks
   * the CLI.
   */
  strict?: boolean
  onIssue?: (file: string, issues: string[]) => void
}

/**
 * Load every provider knowledge entry. User entries override bundled
 * entries with the same `id`. Returns a Map keyed by id.
 */
export function loadProviderKnowledge(
  opts: LoadProviderKnowledgeOptions = {},
): Map<string, ProviderKnowledge> {
  const bundledDir = opts.bundledDir ?? join(PKG_ROOT, 'configs', 'providers')
  const userDir = opts.userDir ?? join(homedir(), '.gtm-os', 'providers')

  const out = new Map<string, ProviderKnowledge>()

  for (const { file, raw } of readYamlsFromDir(bundledDir)) {
    const { value, issues } = parseProviderKnowledge(raw, file)
    if (issues.length > 0) {
      if (opts.strict) throw new ProviderKnowledgeError(file, issues)
      opts.onIssue?.(file, issues)
      if (!value) continue
    }
    if (!value) continue
    out.set(value.id, { ...value, source: 'bundled' })
  }

  // `_user/` lives alongside the bundled yamls so the npm tarball can ship
  // it pre-empty and the custom-provider flow has a guaranteed write target.
  // Entries here override bundled entries with the same id.
  const bundledUserDir = join(bundledDir, '_user')
  for (const { file, raw } of readYamlsFromDir(bundledUserDir)) {
    const { value, issues } = parseProviderKnowledge(raw, file)
    if (issues.length > 0) {
      if (opts.strict) throw new ProviderKnowledgeError(file, issues)
      opts.onIssue?.(file, issues)
      if (!value) continue
    }
    if (!value) continue
    out.set(value.id, { ...value, source: 'user' })
  }

  for (const { file, raw } of readYamlsFromDir(userDir)) {
    const { value, issues } = parseProviderKnowledge(raw, file)
    if (issues.length > 0) {
      if (opts.strict) throw new ProviderKnowledgeError(file, issues)
      opts.onIssue?.(file, issues)
      if (!value) continue
    }
    if (!value) continue
    out.set(value.id, { ...value, source: 'user' })
  }

  return out
}

/**
 * Levenshtein edit distance — used by suggestion code paths. Exported
 * so the CLI command can compute closest-match suggestions without
 * pulling another dep.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

/**
 * Top-N closest provider ids to `target` from a candidate list. Stable
 * tiebreaker: alphabetical by id.
 */
export function closestProviderIds(target: string, candidates: string[], n = 3): string[] {
  const norm = target.toLowerCase()
  const ranked = candidates
    .map((c) => ({ id: c, d: levenshtein(norm, c.toLowerCase()) }))
    .sort((a, b) => (a.d - b.d) || a.id.localeCompare(b.id))
  return ranked.slice(0, n).map((r) => r.id)
}
