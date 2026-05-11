/**
 * /api/brain/* — read-only context viewer for the SPA's /brain page.
 *
 * Walks the live tenant tree and returns every section that exists, plus
 * any per-section confidence metadata.
 *
 * Confidence read order (A6, Part 2):
 *   1. `<liveRoot>/_meta.json#sections.<id>.confidence` — persisted at
 *      commit time by `commitPreview`. The fast path; no recompute.
 *   2. `_preview/_meta.json#sections.<id>.confidence` — covers the case
 *      where a re-onboarding is in progress and the new score hasn't
 *      committed yet.
 *   3. `computeConfidenceFromSignals(...)` — fallback only when the
 *      persisted file is absent and we still have raw signals.
 *
 * Endpoints:
 *   GET  /api/brain/context              — list sections with rendered content
 *   POST /api/brain/regenerate/:section  — proxy to `start --regenerate`
 */

import { Hono } from 'hono'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  liveRoot,
  readPreviewMeta,
  SECTION_NAMES,
  SECTION_PATHS,
  previewExists,
  type SectionName,
  type TenantContext,
} from '../../onboarding/preview.js'
import { DEFAULT_TENANT } from '../../tenant/index.js'

export const brainRoutes = new Hono()

// ─── Helpers ────────────────────────────────────────────────────────────────

function tenantFromQuery(c: { req: { query: (k: string) => string | undefined } }): TenantContext {
  const slug = c.req.query('tenant') ?? process.env.GTM_OS_TENANT ?? DEFAULT_TENANT
  return { tenantId: slug }
}

interface BrainSectionFile {
  canonical: string
  abs: string
  content: string
  format: 'yaml' | 'markdown' | 'text'
}

interface BrainSection {
  id: SectionName
  files: BrainSectionFile[]
  confidence: number | null
  confidence_signals: {
    input_chars: number
    llm_self_rating: number
    has_metadata_anchors: boolean
  } | null
}

function detectFormat(canonical: string): BrainSectionFile['format'] {
  if (canonical.endsWith('.yaml') || canonical.endsWith('.yml')) return 'yaml'
  if (canonical.endsWith('.md')) return 'markdown'
  return 'text'
}

/**
 * Walk a section's canonical paths under the live tree. Sections can be a
 * single file (`framework.yaml`) or a directory (`voice/`, `positioning/`).
 * For directories we collect a single level of `.md` / `.yaml` / `.txt`
 * files so the SPA can render every artifact.
 */
function collectLiveFiles(section: SectionName, tenant: TenantContext): BrainSectionFile[] {
  const out: BrainSectionFile[] = []
  for (const canonical of SECTION_PATHS[section]) {
    const abs = join(liveRoot(tenant), canonical)
    if (!existsSync(abs)) continue
    const st = statSync(abs)
    if (st.isFile()) {
      out.push({
        canonical,
        abs,
        content: readFileSync(abs, 'utf-8'),
        format: detectFormat(canonical),
      })
      continue
    }
    if (st.isDirectory()) {
      // Walk one level for the typical voice/, icp/, positioning/ shape.
      for (const entry of readdirSync(abs).sort()) {
        const subAbs = join(abs, entry)
        let subSt
        try {
          subSt = statSync(subAbs)
        } catch {
          continue
        }
        if (subSt.isFile()) {
          const sub = `${canonical}/${entry}`
          out.push({
            canonical: sub,
            abs: subAbs,
            content: readFileSync(subAbs, 'utf-8'),
            format: detectFormat(sub),
          })
        } else if (subSt.isDirectory()) {
          // One more level — captures positioning/battlecards/<slug>.md.
          for (const leaf of readdirSync(subAbs).sort()) {
            const leafAbs = join(subAbs, leaf)
            try {
              if (!statSync(leafAbs).isFile()) continue
            } catch {
              continue
            }
            const sub = `${canonical}/${entry}/${leaf}`
            out.push({
              canonical: sub,
              abs: leafAbs,
              content: readFileSync(leafAbs, 'utf-8'),
              format: detectFormat(sub),
            })
          }
        }
      }
    }
  }
  return out
}

/**
 * Best-effort metadata lookup. `<liveRoot>/_meta.json` is now persisted by
 * `commitPreview` (A6) so the typical live tree carries per-section
 * confidence directly. We still check the preview's `_meta.json` as a
 * fallback so a re-onboarding-in-progress surfaces fresh numbers before
 * the user commits.
 */
function readSectionMeta(tenant: TenantContext): Record<string, BrainSection['confidence_signals'] extends infer X ? X : never> {
  const out: Record<string, BrainSection['confidence_signals']> = {}
  // Live-tree meta (rare) takes precedence.
  const liveMetaPath = join(liveRoot(tenant), '_meta.json')
  if (existsSync(liveMetaPath)) {
    try {
      const parsed = JSON.parse(readFileSync(liveMetaPath, 'utf-8')) as {
        sections?: Record<string, { confidence_signals?: BrainSection['confidence_signals'] }>
      }
      if (parsed?.sections) {
        for (const [k, v] of Object.entries(parsed.sections)) {
          if (v?.confidence_signals) out[k] = v.confidence_signals
        }
      }
    } catch {
      // ignore
    }
  }
  // Preview meta (when a re-onboarding is pending) provides the freshest
  // confidence numbers for sections that haven't yet been committed.
  if (previewExists(tenant)) {
    const meta = readPreviewMeta(tenant)
    if (meta?.sections) {
      for (const [k, v] of Object.entries(meta.sections)) {
        if (!(k in out) && v?.confidence_signals) out[k] = v.confidence_signals
      }
    }
  }
  return out
}

function computeConfidenceFromSignalsImpl(signals: {
  input_chars: number
  llm_self_rating: number
  has_metadata_anchors: boolean
}): number {
  // Mirrors src/lib/onboarding/confidence.ts at a high level — but we don't
  // need to reimplement it here. The preview meta already stores the score.
  // This helper is only used when the upstream payload omitted `confidence`.
  const ratio = Math.min(1, signals.input_chars / 2000) * 0.3
  const rating = Math.min(1, signals.llm_self_rating / 10) * 0.5
  const anchors = signals.has_metadata_anchors ? 0.2 : 0
  return Math.round((ratio + rating + anchors) * 100) / 100
}

/**
 * Test seam: brain.ts intentionally short-circuits to the persisted live
 * `_meta.json#sections.<id>.confidence` when present (A6, Part 2). Tests
 * spy on this object's `compute` field to verify the recompute path is
 * never invoked for sections with a persisted score.
 */
export const __confidenceRecompute = {
  compute: computeConfidenceFromSignalsImpl,
}

function computeConfidenceFromSignals(signals: {
  input_chars: number
  llm_self_rating: number
  has_metadata_anchors: boolean
}): number {
  return __confidenceRecompute.compute(signals)
}

// ─── GET /api/brain/context ─────────────────────────────────────────────────

brainRoutes.get('/context', (c) => {
  const tenant = tenantFromQuery(c)
  const root = liveRoot(tenant)
  if (!existsSync(root)) {
    return c.json(
      {
        error: 'no_brain',
        message: `No context at ${root}. Run \`yalc-gtm start\` first.`,
      },
      404,
    )
  }

  // Pull confidence signals from whichever meta is available.
  const metaSignals = readSectionMeta(tenant)
  // Also try the live `_meta.json` for an explicit `confidence` field that
  // would override the recomputed value.
  let livePerSectionConfidence: Record<string, number | null> = {}
  const liveMetaPath = join(root, '_meta.json')
  if (existsSync(liveMetaPath)) {
    try {
      const parsed = JSON.parse(readFileSync(liveMetaPath, 'utf-8')) as {
        sections?: Record<string, { confidence?: number }>
      }
      if (parsed?.sections) {
        for (const [k, v] of Object.entries(parsed.sections)) {
          if (typeof v?.confidence === 'number') livePerSectionConfidence[k] = v.confidence
        }
      }
    } catch {
      // ignore
    }
  }
  if (previewExists(tenant)) {
    const meta = readPreviewMeta(tenant)
    if (meta?.sections) {
      for (const [k, v] of Object.entries(meta.sections)) {
        if (livePerSectionConfidence[k] === undefined && typeof v?.confidence === 'number') {
          livePerSectionConfidence[k] = v.confidence
        }
      }
    }
  }

  const sections: BrainSection[] = []
  for (const id of SECTION_NAMES) {
    const files = collectLiveFiles(id, tenant)
    if (files.length === 0) continue
    const signals = metaSignals[id] ?? null
    const confidence =
      livePerSectionConfidence[id] !== undefined && livePerSectionConfidence[id] !== null
        ? livePerSectionConfidence[id]
        : signals
          ? computeConfidenceFromSignals(signals)
          : null
    sections.push({
      id,
      files,
      confidence,
      confidence_signals: signals,
    })
  }

  return c.json({
    tenant: tenant.tenantId,
    live_root: root,
    sections,
  })
})

// ─── POST /api/brain/regenerate/:section ────────────────────────────────────

brainRoutes.post('/regenerate/:section', async (c) => {
  const tenant = tenantFromQuery(c)
  const section = c.req.param('section')
  const body = (await c.req.json().catch(() => ({}))) as { hint?: string }

  if (!(SECTION_NAMES as readonly string[]).includes(section)) {
    return c.json(
      {
        error: 'unknown_section',
        message: `Unknown section ${section}.`,
        valid_sections: SECTION_NAMES,
      },
      400,
    )
  }

  // Proxy through the same regenerate helper /api/setup/regenerate uses.
  // The helper writes into _preview/, which is the staging surface — the
  // SPA's /brain card invites the user to commit afterward via /setup/review.
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
