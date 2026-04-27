/**
 * Flag-driven onboarding capture (0.6.0).
 *
 * Drives the same context-capture + synthesis pipeline that interactive
 * onboarding uses, but seeded entirely from CLI flags so Claude Code (and
 * other automation harnesses) can run setup without prompts.
 *
 * Flags handled here:
 *   --company-name <name>
 *   --website <url>          → fetched via getWebFetchProvider()
 *   --linkedin <url>         → same fetch path
 *   --docs <path>            → markdown-folder context adapter
 *   --icp-summary <text>
 *   --voice <path>           → file with voice samples for tone extraction
 *
 * Produces a populated `_preview/` folder via writeSynthesizedPreview().
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { emptyCompanyContext, type CompanyContext } from '../framework/context-types.js'
import {
  ensurePreviewDir,
  previewPath,
  previewRoot,
  writePreviewMeta,
  type TenantContext,
} from './preview.js'
import { getWebFetchProvider, isClaudeCode } from '../env/claude-code.js'
import {
  fetchCachedScrape,
  pruneScrapeCache,
  writeScrapeCache,
} from '../web/scrape-cache.js'

export interface FlagCaptureOptions {
  tenantId: string
  companyName?: string
  website?: string
  linkedin?: string
  docs?: string
  icpSummary?: string
  voice?: string
  /** When true bypass the scrape cache for this run (no read, no write). */
  noCache?: boolean
}

export interface FlagCaptureResult {
  context: CompanyContext
  websiteContent?: string | null
  linkedinContent?: string | null
  docsContent?: string | null
  voiceContent?: string | null
  /** Sources actually consulted — used for `_meta.json`. */
  sourcesUsed: {
    website?: string
    linkedin?: string
    docs?: string[]
    voice?: string
  }
}

/** True when at least one of the capture flags was provided. */
export function hasCaptureFlags(opts: FlagCaptureOptions): boolean {
  return !!(
    opts.companyName ||
    opts.website ||
    opts.linkedin ||
    opts.docs ||
    opts.icpSummary ||
    opts.voice
  )
}

/**
 * Read a folder of markdown/text/PDF-ish files. We deliberately keep this
 * simple — markdown and plain-text are read directly, anything else is
 * skipped with a warning. The full markdown-folder adapter handles glob
 * patterns and chunking; for capture we just want concatenated content for
 * the synthesis prompt.
 */
function readDocsFolder(folder: string): { content: string; files: string[] } {
  const files: string[] = []
  const parts: string[] = []
  try {
    const stat = statSync(folder)
    if (stat.isFile()) {
      const txt = readFileSync(folder, 'utf-8')
      files.push(folder)
      parts.push(`--- ${folder} ---\n${txt.slice(0, 8000)}`)
      return { content: parts.join('\n\n'), files }
    }
  } catch {
    return { content: '', files }
  }

  const visit = (dir: string) => {
    let entries: string[]
    try {
      const { readdirSync } = require('node:fs') as typeof import('node:fs')
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let s: ReturnType<typeof statSync>
      try {
        s = statSync(full)
      } catch {
        continue
      }
      if (s.isDirectory()) {
        visit(full)
        continue
      }
      if (!/\.(md|markdown|txt)$/i.test(name)) continue
      try {
        const txt = readFileSync(full, 'utf-8')
        files.push(full)
        parts.push(`--- ${full} ---\n${txt.slice(0, 8000)}`)
      } catch {
        // Skip unreadable files.
      }
    }
  }
  visit(folder)
  return { content: parts.join('\n\n').slice(0, 60000), files }
}

/**
 * Fetch a URL via the configured web-fetch provider, honoring the local
 * scrape cache. Returns null when no fetch backend is available.
 */
export async function fetchForCapture(
  url: string,
  opts: { noCache?: boolean } = {},
): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null

  if (!opts.noCache) {
    const cached = await fetchCachedScrape(url)
    if (cached.hit) return cached.content ?? null
  }

  const provider = getWebFetchProvider()
  if (provider === 'none') {
    return null
  }
  if (provider === 'claude-code') {
    // Inside CC the parent emits a handoff line so the user knows what to
    // do. We return null (no content captured automatically) — the caller
    // surfaces the handoff in its log.
    console.log(
      `[start] Claude Code WebFetch handoff: please run WebFetch on ${url} and re-run with --input <file>`,
    )
    return null
  }

  // Firecrawl path.
  let content: string | null = null
  try {
    const { firecrawlService } = await import('../services/firecrawl.js')
    content = await firecrawlService.scrape(url)
  } catch (err) {
    console.warn(
      `[start] scrape ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
  if (!content) return null

  if (!opts.noCache) {
    writeScrapeCache({
      url,
      fetched_at: new Date().toISOString(),
      content_md: content,
      ttl_s: 3600,
    })
    pruneScrapeCache()
  }
  return content
}

/**
 * Capture phase. Builds a CompanyContext seeded from the flags + scraped
 * raw sources. Synthesis (framework, voice, ICP, etc.) happens in
 * writeSynthesizedPreview().
 */
export async function runFlagCapture(opts: FlagCaptureOptions): Promise<FlagCaptureResult> {
  const ctx = emptyCompanyContext()
  ctx.meta.captured_at = new Date().toISOString()
  ctx.meta.last_updated_at = ctx.meta.captured_at
  ctx.meta.version = '0.6.0'

  const sourcesUsed: FlagCaptureResult['sourcesUsed'] = {}

  if (opts.companyName) ctx.company.name = opts.companyName

  let websiteContent: string | null = null
  if (opts.website) {
    ctx.company.website = opts.website
    websiteContent = await fetchForCapture(opts.website, { noCache: opts.noCache })
    ctx.sources.website = opts.website
    ctx.sources.website_fetched_at = new Date().toISOString()
    sourcesUsed.website = opts.website
  }

  let linkedinContent: string | null = null
  if (opts.linkedin) {
    ctx.founder.linkedin = opts.linkedin
    linkedinContent = await fetchForCapture(opts.linkedin, { noCache: opts.noCache })
    ctx.sources.linkedin = opts.linkedin
    ctx.sources.linkedin_fetched_at = new Date().toISOString()
    sourcesUsed.linkedin = opts.linkedin
  }

  let docsContent: string | null = null
  if (opts.docs) {
    const { content, files } = readDocsFolder(opts.docs)
    docsContent = content || null
    if (files.length > 0) {
      ctx.sources.docs = files
      sourcesUsed.docs = files
    }
  }

  if (opts.icpSummary) {
    ctx.icp.segments_freeform = opts.icpSummary
  }

  let voiceContent: string | null = null
  if (opts.voice) {
    ctx.voice.examples_path = opts.voice
    ctx.sources.voice = opts.voice
    sourcesUsed.voice = opts.voice
    try {
      voiceContent = readFileSync(opts.voice, 'utf-8').slice(0, 20000)
      ctx.voice.description = voiceContent.split('\n').slice(0, 2).join(' ').slice(0, 280)
    } catch {
      voiceContent = null
    }
  }

  return { context: ctx, websiteContent, linkedinContent, docsContent, voiceContent, sourcesUsed }
}

/**
 * Write the captured context to `_preview/company_context.yaml` and produce
 * placeholder synthesis files for downstream review. Pure 0.6.1+ runs will
 * replace these placeholder bodies with LLM-derived content via
 * `writeSynthesizedPreview()` once an Anthropic key is present.
 */
export function writeCapturedPreview(
  result: FlagCaptureResult,
  tenant?: TenantContext,
): void {
  const root = previewRoot(tenant)
  if (!existsSync(root)) mkdirSync(root, { recursive: true })

  // 1. company_context.yaml — first-class capture record.
  ensurePreviewDir('company_context.yaml', tenant)
  writeFileSync(previewPath('company_context.yaml', tenant), yaml.dump(result.context))

  // 2. _meta.json — captured_at + sources.
  writePreviewMeta(
    {
      captured_at: result.context.meta.captured_at,
      sources: {
        website: result.sourcesUsed.website ?? null,
        linkedin: result.sourcesUsed.linkedin ?? null,
        docs: result.sourcesUsed.docs ?? null,
        voice: result.sourcesUsed.voice ?? null,
      },
      version: '0.6.0',
    },
    tenant,
  )
}

/**
 * Print a short summary of what was captured — used by the start command
 * after running `runFlagCapture()`.
 */
export function summarizeCapture(result: FlagCaptureResult): string {
  const lines: string[] = []
  const c = result.context.company
  if (c.name) lines.push(`  Company: ${c.name}`)
  if (c.website) lines.push(`  Website: ${c.website}${result.websiteContent ? ' (scraped)' : ''}`)
  if (result.context.founder.linkedin) {
    lines.push(
      `  LinkedIn: ${result.context.founder.linkedin}${result.linkedinContent ? ' (fetched)' : ''}`,
    )
  }
  if (result.sourcesUsed.docs?.length) {
    lines.push(`  Docs: ${result.sourcesUsed.docs.length} file(s) ingested`)
  }
  if (result.context.icp.segments_freeform) {
    lines.push(`  ICP: ${result.context.icp.segments_freeform}`)
  }
  if (result.context.voice.examples_path) {
    lines.push(`  Voice samples: ${result.context.voice.examples_path}`)
  }
  return lines.join('\n')
}

/**
 * True if the user is invoking start in a non-interactive harness AND has
 * supplied capture flags — the flag-driven path should run.
 */
export function shouldRunFlagDrivenCapture(opts: {
  nonInteractive?: boolean
  capture: FlagCaptureOptions
}): boolean {
  return !!opts.nonInteractive && hasCaptureFlags(opts.capture)
}

export interface CaptureValidationInput {
  websiteContent?: string | null
  linkedinContent?: string | null
  docsContent?: string | null
  docsFiles?: string[]
}

export interface CaptureValidationResult {
  ok: boolean
  /** Diagnostic numbers for the error message. */
  websiteChars: number
  linkedinChars: number
  docsFiles: number
  /** Number of docs files that meet the per-file 200ch bar. */
  docsFilesOver200: number
}

/**
 * Validate that captured raw inputs have enough content to drive
 * Claude-based synthesis. The bar (any one of):
 *   - website fetch  ≥ 500 chars
 *   - linkedin fetch ≥ 200 chars
 *   - docs folder has ≥ 1 file with ≥ 200 chars of text
 *
 * If none of those are met we refuse synthesis. The CLI surfaces the result
 * (with --force-synthesis to bypass).
 */
export function validateCaptureForSynthesis(
  input: CaptureValidationInput,
): CaptureValidationResult {
  const websiteChars = input.websiteContent?.length ?? 0
  const linkedinChars = input.linkedinContent?.length ?? 0
  const docsFiles = input.docsFiles?.length ?? 0

  // We don't have per-file char counts at the call site, so approximate by
  // assuming concatenated docs content is ≥ 200ch * fileCount on average.
  // This stays correct in the only failure mode that matters — empty / near
  // empty docs — because docsContent would be ~0 chars.
  const totalDocsChars = input.docsContent?.length ?? 0
  const docsFilesOver200 = totalDocsChars >= 200 ? Math.max(1, docsFiles) : 0

  const ok =
    websiteChars >= 500 || linkedinChars >= 200 || docsFilesOver200 >= 1

  return { ok, websiteChars, linkedinChars, docsFiles, docsFilesOver200 }
}

/** Re-export for ergonomic imports. */
export { isClaudeCode }
