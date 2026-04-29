/**
 * /api/setup/* — preview-driven onboarding review surface (0.9.B).
 *
 * The CLI's `start --non-interactive --website <url>` flow writes draft
 * sections into `~/.gtm-os/_preview/`. The SPA at `/setup/review` reads
 * those drafts via these endpoints, lets the user edit each one inline,
 * and commits the approved set back to the live tree.
 *
 * Endpoints:
 *   GET    /api/setup/preview            — list every section with content + confidence
 *   PUT    /api/setup/preview/:section   — overwrite the section content (yaml-validated)
 *   POST   /api/setup/regenerate/:section — re-run synthesis for one section
 *   POST   /api/setup/commit             — promote preview → live (optional discard list)
 *
 * Tenant resolution mirrors the CLI: `?tenant=<slug>` query > `GTM_OS_TENANT`
 * env > 'default'. All disk I/O is HOME-isolated via the same helpers the
 * CLI uses, so test sandboxes that stub HOME just work.
 */

import { Hono } from 'hono'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import {
  ensurePreviewDir,
  previewExists,
  previewPath,
  previewRoot,
  readPreviewMeta,
  SECTION_NAMES,
  SECTION_PATHS,
  type SectionName,
  type TenantContext,
} from '../../onboarding/preview.js'
import { DEFAULT_TENANT } from '../../tenant/index.js'

export const setupRoutes = new Hono()

// ─── Helpers ────────────────────────────────────────────────────────────────

function tenantFromQuery(c: { req: { query: (k: string) => string | undefined } }): TenantContext {
  const slug = c.req.query('tenant') ?? process.env.GTM_OS_TENANT ?? DEFAULT_TENANT
  return { tenantId: slug }
}

function isYamlPath(canonical: string): boolean {
  return canonical.endsWith('.yaml') || canonical.endsWith('.yml')
}

/**
 * Walk a section's canonical paths and collect every concrete file. Section
 * roots can be a single file (`framework.yaml`) or a directory containing
 * multiple files (`voice/`). Returns `[{ canonical, abs }]` pairs.
 */
function collectSectionFiles(
  section: SectionName,
  tenant: TenantContext,
): Array<{ canonical: string; abs: string }> {
  const out: Array<{ canonical: string; abs: string }> = []
  const roots = SECTION_PATHS[section]
  for (const canonical of roots) {
    const abs = previewPath(canonical, tenant)
    if (!existsSync(abs)) continue
    const st = statSync(abs)
    if (st.isFile()) {
      out.push({ canonical, abs })
      continue
    }
    if (st.isDirectory()) {
      // Read top-level entries inside the section directory. We don't
      // recurse — the synthesis writer only emits one level (e.g.
      // `voice/tone-of-voice.md`, `voice/examples.md`).
      const { readdirSync } = require('node:fs') as typeof import('node:fs')
      for (const entry of readdirSync(abs).sort()) {
        const sub = join(canonical, entry)
        const subAbs = previewPath(sub, tenant)
        if (existsSync(subAbs) && statSync(subAbs).isFile()) {
          out.push({ canonical: sub, abs: subAbs })
        }
      }
    }
  }
  return out
}

interface SectionEntry {
  id: SectionName
  /** Canonical relative path (e.g. `framework.yaml`, `voice/tone-of-voice.md`). */
  canonical: string
  content: string
  confidence: number | null
  confidence_signals: {
    input_chars: number
    llm_self_rating: number
    has_metadata_anchors: boolean
  } | null
}

// ─── GET /api/setup/preview ─────────────────────────────────────────────────

setupRoutes.get('/preview', async (c) => {
  const tenant = tenantFromQuery(c)
  if (!previewExists(tenant)) {
    return c.json(
      { error: 'no_preview', message: `No preview at ${previewRoot(tenant)}` },
      404,
    )
  }

  const meta = readPreviewMeta(tenant)
  const sections: SectionEntry[] = []
  for (const id of SECTION_NAMES) {
    const files = collectSectionFiles(id, tenant)
    if (files.length === 0) continue
    const sectionMeta = meta?.sections?.[id] ?? null
    for (const { canonical, abs } of files) {
      sections.push({
        id,
        canonical,
        content: readFileSync(abs, 'utf-8'),
        confidence: sectionMeta?.confidence ?? null,
        confidence_signals: sectionMeta?.confidence_signals ?? null,
      })
    }
  }

  return c.json({
    tenant: tenant.tenantId,
    preview_root: previewRoot(tenant),
    captured_at: meta?.captured_at ?? null,
    sections,
  })
})

// ─── PUT /api/setup/preview/:section ────────────────────────────────────────

setupRoutes.put('/preview/:section', async (c) => {
  const tenant = tenantFromQuery(c)
  const sectionParam = c.req.param('section')
  const body = (await c.req.json().catch(() => ({}))) as {
    content?: string
    canonical?: string
  }

  if (typeof body.content !== 'string') {
    return c.json({ error: 'bad_request', message: 'Body must include `content` (string)' }, 400)
  }

  if (!previewExists(tenant)) {
    return c.json(
      { error: 'no_preview', message: `No preview at ${previewRoot(tenant)}` },
      404,
    )
  }

  // The route param can be either a section id (e.g. `framework`) or a
  // canonical path (e.g. `voice/tone-of-voice.md`). When it's a section id
  // and the section maps to multiple files, the body must specify which
  // canonical path to write.
  const sectionNames = SECTION_NAMES as readonly string[]
  let canonical: string | null = null
  let sectionId: SectionName | null = null

  if (sectionNames.includes(sectionParam)) {
    sectionId = sectionParam as SectionName
    const roots = SECTION_PATHS[sectionId]
    if (body.canonical) {
      canonical = body.canonical
    } else if (roots.length === 1 && !roots[0].includes('/') && !isDirectorySection(sectionId, tenant)) {
      canonical = roots[0]
    } else {
      // Multi-file section without an explicit canonical — pick the first
      // existing file deterministically.
      const files = collectSectionFiles(sectionId, tenant)
      if (files.length === 0) {
        return c.json(
          { error: 'section_empty', message: `No files in section ${sectionId}` },
          404,
        )
      }
      canonical = files[0].canonical
    }
  } else {
    // Direct canonical path. Map back to a section so we know how to validate.
    canonical = sectionParam
    for (const name of SECTION_NAMES) {
      const roots = SECTION_PATHS[name]
      if (roots.some((r) => canonical === r || canonical!.startsWith(r + '/'))) {
        sectionId = name
        break
      }
    }
  }

  if (!canonical || !sectionId) {
    return c.json({ error: 'unknown_section', message: `Unknown section ${sectionParam}` }, 400)
  }

  // Schema-validate yaml content. We don't enforce a specific shape here —
  // just that it parses — so the user can iterate without a tight schema.
  if (isYamlPath(canonical)) {
    try {
      yaml.load(body.content)
    } catch (err) {
      return c.json(
        {
          error: 'invalid_yaml',
          message: err instanceof Error ? err.message : 'YAML did not parse',
        },
        400,
      )
    }
  }

  const target = previewPath(canonical, tenant)
  ensurePreviewDir(canonical, tenant)
  writeFileSync(target, body.content)

  return c.json({ ok: true, section: sectionId, canonical })
})

function isDirectorySection(section: SectionName, tenant: TenantContext): boolean {
  for (const r of SECTION_PATHS[section]) {
    const abs = previewPath(r, tenant)
    if (existsSync(abs) && statSync(abs).isDirectory()) return true
  }
  return false
}

// ─── POST /api/setup/regenerate/:section ────────────────────────────────────

setupRoutes.post('/regenerate/:section', async (c) => {
  const tenant = tenantFromQuery(c)
  const section = c.req.param('section')
  const body = (await c.req.json().catch(() => ({}))) as { hint?: string }

  if (!previewExists(tenant)) {
    return c.json(
      { error: 'no_preview', message: `No preview at ${previewRoot(tenant)}` },
      404,
    )
  }

  const { regeneratePreviewSection } = await import('../../onboarding/start.js')
  try {
    const result = await regeneratePreviewSection({
      tenantId: tenant.tenantId,
      section,
      hint: body.hint,
    })
    return c.json({ ok: true, ...result })
  } catch (err) {
    return c.json(
      {
        error: 'regenerate_failed',
        message: err instanceof Error ? err.message : 'Regenerate failed',
      },
      400,
    )
  }
})

// ─── POST /api/setup/commit ─────────────────────────────────────────────────

setupRoutes.post('/commit', async (c) => {
  const tenant = tenantFromQuery(c)
  if (!previewExists(tenant)) {
    return c.json(
      { error: 'no_preview', message: `No preview at ${previewRoot(tenant)}` },
      404,
    )
  }

  const body = (await c.req.json().catch(() => ({}))) as { discard?: string[] }
  const discard = Array.isArray(body.discard) ? body.discard : []
  const sectionNames = SECTION_NAMES as readonly string[]
  const unknown = discard.filter((s) => !sectionNames.includes(s))
  if (unknown.length > 0) {
    return c.json(
      {
        error: 'unknown_discard',
        message: `Unknown discard section(s): ${unknown.join(', ')}`,
        valid_sections: SECTION_NAMES,
      },
      400,
    )
  }

  const { commitPreview, refreshLiveIndex } = await import('../../onboarding/preview.js')
  const result = commitPreview({
    tenant,
    discardSections: discard as SectionName[],
  })
  await refreshLiveIndex(tenant)

  // Drop a sentinel so non-interactive harnesses can detect commit completion
  // without polling the preview directory.
  writeReviewCommittedSentinel(tenant)

  return c.json({
    ok: true,
    committed: result.committed,
    discarded: result.discarded,
  })
})

/**
 * Write `~/.gtm-os/_handoffs/setup/review.committed` once the SPA commits.
 * Best-effort — never fails the commit response.
 */
function writeReviewCommittedSentinel(tenant: TenantContext): void {
  try {
    const { liveRoot } = require('../../onboarding/preview.js') as typeof import('../../onboarding/preview.js')
    const { mkdirSync } = require('node:fs') as typeof import('node:fs')
    const dir = join(liveRoot(tenant), '_handoffs', 'setup')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'review.committed'),
      JSON.stringify({ at: new Date().toISOString(), tenant: tenant.tenantId }) + '\n',
    )
  } catch {
    // Sentinel is advisory — swallow.
  }
}
