/**
 * POST /api/brain/section — in-place editor for the live Brain (C4).
 *
 * The /brain SPA can flip any section into edit mode. On Save we receive a
 * dot-notation path (e.g. `icp.segments[0].name`) plus a JSON value, locate
 * the section's canonical YAML on the live tree, mutate the targeted leaf,
 * and write the file back. The first path segment names the section root:
 *
 *   `company_context.*` → `company_context.yaml`
 *   `icp.*`             → `icp/segments.yaml`
 *   `framework.*`       → `framework.yaml`
 *   `campaign_templates.*` → `campaign_templates.yaml`
 *   `config.*`          → `config.yaml`
 *
 * Editing here NEVER triggers buildProfile() or any LLM call — it's a pure
 * data write. Manual edit signals max confidence, so we also flip the
 * sidecar (`<liveRoot>/_meta.json#sections.<id>.confidence`) to 1.0 and
 * append a one-line audit entry to `<liveRoot>/brain.audit.log` (timestamp,
 * path, prior-value hash — never the new value).
 */

import { Hono } from 'hono'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import yaml from 'js-yaml'
import {
  liveRoot,
  SECTION_NAMES,
  type SectionName,
  type TenantContext,
} from '../../onboarding/preview.js'
import { DEFAULT_TENANT } from '../../tenant/index.js'

export const brainSectionRoutes = new Hono()

function tenantFromQuery(c: {
  req: { query: (k: string) => string | undefined }
}): TenantContext {
  const slug = c.req.query('tenant') ?? process.env.GTM_OS_TENANT ?? DEFAULT_TENANT
  return { tenantId: slug }
}

/**
 * Each editable section maps to exactly one YAML file under the live root.
 * `keyPrefix` is what the dot-path's first segment matches; everything after
 * it is the inner key path inside the YAML.
 */
const SECTION_TO_YAML: Record<string, { section: SectionName; relPath: string }> = {
  company_context: { section: 'company_context', relPath: 'company_context.yaml' },
  framework: { section: 'framework', relPath: 'framework.yaml' },
  icp: { section: 'icp', relPath: 'icp/segments.yaml' },
  campaign_templates: {
    section: 'campaign_templates',
    relPath: 'campaign_templates.yaml',
  },
  config: { section: 'config', relPath: 'config.yaml' },
}

interface ParsedPath {
  /** Top-level section name (first path segment). */
  root: string
  /**
   * Sequence of object keys / array indices below the section root. May be
   * empty when the user replaced the entire section root.
   */
  keys: (string | number)[]
}

/**
 * Parse a dot-notation path with bracket array indices. Examples:
 *   "icp.segments[0].name" → { root: "icp", keys: ["segments", 0, "name"] }
 *   "company_context"       → { root: "company_context", keys: [] }
 *   "company_context.company.name"
 *      → { root: "company_context", keys: ["company", "name"] }
 *
 * Returns null on a malformed input.
 */
export function parsePath(path: string): ParsedPath | null {
  if (!path || typeof path !== 'string') return null
  // Split on dots that aren't inside brackets, then expand bracketed indices.
  const segments = path.split('.')
  const keys: (string | number)[] = []
  let root: string | null = null
  for (const seg of segments) {
    if (!seg) return null
    // Match `name`, `name[0]`, `name[0][1]`, etc.
    const m = seg.match(/^([A-Za-z_][\w-]*)((?:\[\d+\])*)$/)
    if (!m) return null
    const [, name, brackets] = m
    if (root === null) {
      root = name
    } else {
      keys.push(name)
    }
    if (brackets) {
      const idxRe = /\[(\d+)\]/g
      let im: RegExpExecArray | null
      while ((im = idxRe.exec(brackets)) !== null) {
        keys.push(Number(im[1]))
      }
    }
  }
  if (root === null) return null
  return { root, keys }
}

/**
 * Apply `keys` against `root`, replacing the targeted leaf with `value`.
 * Mutates `root` in place when keys is non-empty; returns the mutated root
 * (or the new value when keys is empty).
 */
function setDeep(
  root: unknown,
  keys: (string | number)[],
  value: unknown,
): unknown {
  if (keys.length === 0) return value
  let cursor: any = root
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    if (cursor === null || typeof cursor !== 'object') return null // bail
    if (!(k in cursor)) return null
    cursor = cursor[k]
  }
  const last = keys[keys.length - 1]
  if (cursor === null || typeof cursor !== 'object') return null
  cursor[last] = value
  return root
}

/**
 * Minimal CompanyContext shape guard. We only enforce the top-level skeleton
 * (`company`, `founder`, `icp`, `voice`, `sources`, `meta` as objects, plus
 * `company.name` as a string) — enough to catch obvious corruption without
 * locking out reasonable hand edits.
 */
function isValidCompanyContext(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  for (const key of ['company', 'founder', 'icp', 'voice', 'sources', 'meta']) {
    const child = v[key]
    if (!child || typeof child !== 'object' || Array.isArray(child)) return false
  }
  const company = v.company as Record<string, unknown>
  if (typeof company.name !== 'string') return false
  return true
}

brainSectionRoutes.post('/section', async (c) => {
  const tenant = tenantFromQuery(c)
  const body = (await c.req.json().catch(() => ({}))) as {
    path?: string
    value?: unknown
  }

  if (typeof body.path !== 'string' || body.path.length === 0) {
    return c.json(
      { error: 'invalid_path', message: 'Body must include `path` (string).' },
      400,
    )
  }
  if (!('value' in body)) {
    return c.json(
      { error: 'invalid_path', message: 'Body must include `value`.' },
      400,
    )
  }
  const parsed = parsePath(body.path)
  if (!parsed) {
    return c.json(
      { error: 'invalid_path', message: `Cannot parse path: ${body.path}` },
      400,
    )
  }

  const mapping = SECTION_TO_YAML[parsed.root]
  if (!mapping) {
    return c.json(
      {
        error: 'invalid_path',
        message: `Unknown section root: ${parsed.root}`,
        valid_roots: Object.keys(SECTION_TO_YAML),
      },
      400,
    )
  }

  const root = liveRoot(tenant)
  if (!existsSync(root)) {
    return c.json(
      {
        error: 'no_brain',
        message: `No context at ${root}.`,
      },
      404,
    )
  }

  const filePath = join(root, mapping.relPath)
  if (!existsSync(filePath)) {
    return c.json(
      { error: 'section_missing', message: `Section file missing: ${mapping.relPath}` },
      404,
    )
  }

  let parsedYaml: unknown
  try {
    parsedYaml = yaml.load(readFileSync(filePath, 'utf-8'))
  } catch (err) {
    return c.json(
      {
        error: 'invalid_yaml',
        message: `Existing yaml unparsable: ${err instanceof Error ? err.message : String(err)}`,
      },
      500,
    )
  }
  if (parsedYaml === null || parsedYaml === undefined) parsedYaml = {}

  // Hash the prior value at the targeted path BEFORE mutation, for the audit
  // log. Use a short-ish hex digest; enough to spot identical reverts.
  const priorLeaf =
    parsed.keys.length === 0 ? parsedYaml : readDeep(parsedYaml, parsed.keys)
  const priorHash = createHash('sha256')
    .update(JSON.stringify(priorLeaf ?? null))
    .digest('hex')
    .slice(0, 12)

  const updated = setDeep(parsedYaml, parsed.keys, body.value)
  if (updated === null) {
    return c.json(
      {
        error: 'invalid_path',
        message: `Path does not exist in section: ${body.path}`,
      },
      400,
    )
  }

  // Schema guard for company_context — keep the file's required skeleton
  // intact even after a deep edit. We re-validate the entire root rather than
  // the leaf so partial deletes don't silently break the file.
  if (mapping.section === 'company_context') {
    if (!isValidCompanyContext(updated)) {
      return c.json(
        {
          error: 'schema_violation',
          message:
            'Edit would violate the CompanyContext shape (required keys: company, founder, icp, voice, sources, meta — and company.name must be a string).',
        },
        400,
      )
    }
  }

  // Atomic-ish write: serialize first, then overwrite. js-yaml preserves
  // primitive types but not comments — we accept that loss for now.
  let serialized: string
  try {
    serialized = yaml.dump(updated)
  } catch (err) {
    return c.json(
      {
        error: 'serialize_failed',
        message: err instanceof Error ? err.message : 'YAML dump failed',
      },
      500,
    )
  }
  writeFileSync(filePath, serialized)

  // Sidecar — flip section confidence to 1.0 (manual edit = max trust). We
  // merge into any existing entry so confidence_signals from the previous
  // synthesis round are preserved (if present) for historical reference.
  updateSidecarConfidence(root, mapping.section)

  // Audit log: timestamp, full dot-path, prior-value hash. Never the new value.
  appendAuditLog(root, body.path, priorHash)

  return c.json({
    ok: true,
    section: mapping.section,
    canonical: mapping.relPath,
  })
})

function readDeep(root: unknown, keys: (string | number)[]): unknown {
  let cur: any = root
  for (const k of keys) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[k]
  }
  return cur
}

function updateSidecarConfidence(rootDir: string, section: SectionName): void {
  const sidecarPath = join(rootDir, '_meta.json')
  let existing: { sections?: Record<string, Record<string, unknown>> } = {}
  if (existsSync(sidecarPath)) {
    try {
      existing = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    } catch {
      existing = {}
    }
  }
  const sections = { ...(existing.sections ?? {}) }
  const prior = sections[section] ?? {}
  sections[section] = { ...prior, confidence: 1.0 }
  const merged = { ...existing, sections }
  if (!existsSync(rootDir)) mkdirSync(rootDir, { recursive: true })
  writeFileSync(sidecarPath, JSON.stringify(merged, null, 2))
}

function appendAuditLog(rootDir: string, path: string, priorHash: string): void {
  const logPath = join(rootDir, 'brain.audit.log')
  const line = `${new Date().toISOString()}\t${path}\tprior-hash:${priorHash}\n`
  // Ensure parent exists (`liveRoot` is the parent — should always exist by
  // now, but guard for the edge case).
  const parent = dirname(logPath)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
  appendFileSync(logPath, line)
}

// Re-export the section-name constant for any future router that wants to
// validate path roots against the canonical list (and for symmetry with
// `brainRoutes`).
export { SECTION_NAMES }
