/**
 * Native onboarding wizard — Phase 1 / C4.
 *
 * Interactive CLI that walks any new tenant through an 8-12 question
 * interview, optionally scrapes their company site, and optionally
 * ingests local files. Every answer flows through the chunker into
 * MemoryStore.upsertNodeBySourceHash with sourceType='interview' |
 * 'website' | 'upload'.
 *
 * This is the productized onboarding path \u2014 zero external deps beyond
 * a Claude key (for later framework derivation). For the default
 * tenant we run this WITHOUT the interview (--adapter markdown-folder
 * skips straight to the adapter sync), so interactive prompts are
 * only reached when the user explicitly runs `gtm-os onboard --tenant
 * <new-slug>`.
 */

import { createHash } from 'node:crypto'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { input, confirm, checkbox } from '@inquirer/prompts'
import { MemoryStore } from '../memory/store.js'
import { chunkMarkdown } from '../memory/chunker.js'
import { tenantConfigDir } from '../tenant/index.js'

export interface OnboardOptions {
  tenantId: string
  /** When true, uses the Firecrawl scraper to pull a company URL. */
  scrapeWebsite?: boolean
  /** Local file paths to ingest (PDF-extracted text, markdown, etc.). */
  uploadPaths?: string[]
  /** Programmatic answer overrides (used by tests). */
  answers?: Partial<InterviewAnswers>
  /** When true, skip interactive prompts entirely (test mode). */
  nonInteractive?: boolean
}

export interface InterviewAnswers {
  companyName: string
  companyUrl: string
  valueProp: string
  icps: string
  painPoints: string
  competitors: string
  channels: string
  voice: string
  successStories: string
  disqualifiers: string
}

const QUESTIONS: Array<{
  key: keyof InterviewAnswers
  message: string
  required?: boolean
}> = [
  { key: 'companyName', message: 'Company name', required: true },
  { key: 'companyUrl', message: 'Company website URL (blank if none)' },
  {
    key: 'valueProp',
    message: 'One-sentence value proposition (who you sell to and what you solve)',
    required: true,
  },
  { key: 'icps', message: 'Primary ICP(s) \u2014 industries, company sizes, roles', required: true },
  {
    key: 'painPoints',
    message: 'Top 3 pain points your buyers are trying to solve',
    required: true,
  },
  {
    key: 'competitors',
    message: 'Main competitors (comma separated)',
  },
  {
    key: 'channels',
    message: 'GTM channels you use (LinkedIn, email, Reddit, events, \u2026)',
    required: true,
  },
  {
    key: 'voice',
    message: 'Voice description \u2014 tone, phrases to use, phrases to avoid',
    required: true,
  },
  { key: 'successStories', message: 'One or two customer wins to reference' },
  {
    key: 'disqualifiers',
    message: 'Auto-disqualifiers (buyers you do NOT want)',
  },
]

/**
 * Ask every interview question interactively (or fill from `answers`
 * override in non-interactive mode). Returns the collected answers.
 */
async function askInterview(opts: OnboardOptions): Promise<InterviewAnswers> {
  const collected: Partial<InterviewAnswers> = { ...(opts.answers ?? {}) }
  if (opts.nonInteractive) {
    // Fill any missing required fields with placeholder strings so the
    // pipeline still ingests something — tests use this path.
    for (const q of QUESTIONS) {
      if (collected[q.key] == null) collected[q.key] = `(${q.key} not provided)`
    }
    return collected as InterviewAnswers
  }

  for (const q of QUESTIONS) {
    if (collected[q.key] != null) continue
    const answer = await input({
      message: q.message,
      validate: (v: string) => {
        if (q.required && !v.trim()) return `${q.key} is required`
        return true
      },
    })
    collected[q.key] = answer.trim()
  }
  return collected as InterviewAnswers
}

/**
 * Store an interview answer as a memory_node of type 'interview_answer'.
 * Each answer is one node — keeps granularity high for the index builder
 * to pick the right pointers later.
 */
async function ingestInterview(
  store: MemoryStore,
  tenantId: string,
  answers: InterviewAnswers,
): Promise<number> {
  let count = 0
  for (const [key, value] of Object.entries(answers) as Array<
    [keyof InterviewAnswers, string]
  >) {
    if (!value) continue
    const sourceHash = createHash('sha256')
      .update(`${tenantId}:interview:${key}:${value}`)
      .digest('hex')
    await store.upsertNodeBySourceHash({
      type: 'interview_answer',
      content: `${formatLabel(key)}: ${value}`,
      sourceType: 'interview',
      sourceRef: `interview://${tenantId}#${key}`,
      sourceHash,
      metadata: { question: key },
      confidence: 'validated',
      confidenceScore: 70,
    })
    count++
  }
  return count
}

function formatLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

async function ingestWebsite(
  store: MemoryStore,
  companyUrl: string,
): Promise<number> {
  if (!companyUrl || !/^https?:\/\//i.test(companyUrl)) return 0
  const targets = [
    companyUrl,
    joinUrl(companyUrl, '/about'),
    joinUrl(companyUrl, '/pricing'),
    joinUrl(companyUrl, '/customers'),
  ]

  // Resolve which web-fetch backend is available right now. The user may
  // be running standalone (Firecrawl), inside a Claude Code session
  // (parent-driven WebFetch), or with neither — never crash on the last
  // case, just skip cleanly so onboarding can finish.
  const { getWebFetchProvider } = await import('../env/claude-code.js')
  const provider = getWebFetchProvider()

  if (provider === 'none') {
    // eslint-disable-next-line no-console
    console.warn(
      '[onboard] No web fetch capability available — skipping website step. ' +
        'Add FIRECRAWL_API_KEY or run inside Claude Code to enable.',
    )
    return 0
  }

  if (provider === 'claude-code') {
    // Emit one structured handoff line per URL. The parent CC session can
    // pick these up, run its built-in WebFetch tool, save the markdown,
    // and re-run onboarding with --input <file>. Skip without crashing.
    for (const url of targets) {
      // eslint-disable-next-line no-console
      console.log(
        `[onboard] Claude Code WebFetch handoff: please run WebFetch on ${url} and re-run with --input <file>`,
      )
    }
    return 0
  }

  // Late-import so tests and the --nonInteractive path don't trigger the
  // Firecrawl service just by importing this file.
  const { firecrawlService } = await import('../services/firecrawl.js')
  let count = 0
  for (const url of targets) {
    try {
      const markdown = await firecrawlService.scrape(url)
      if (!markdown.trim()) continue
      const chunks = chunkMarkdown(markdown)
      for (const chunk of chunks) {
        const sourceRef = `website://${url}#${chunk.headingPath.join('/')}:${chunk.startLine}`
        const result = await store.upsertNodeBySourceHash({
          type: 'document_chunk',
          content: chunk.content,
          sourceType: 'website',
          sourceRef,
          sourceHash: chunk.sourceHash,
          metadata: { url, headingPath: chunk.headingPath },
        })
        if (result.inserted) count++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.warn(`[onboard] scrape ${url} failed: ${msg}`)
    }
  }
  return count
}

function joinUrl(base: string, path: string): string {
  try {
    return new URL(path, base).toString()
  } catch {
    return base
  }
}

async function ingestUploads(
  store: MemoryStore,
  paths: string[],
): Promise<number> {
  let count = 0
  for (const path of paths) {
    if (!existsSync(path)) continue
    const content = readFileSync(path, 'utf-8')
    if (!content.trim()) continue
    const chunks = chunkMarkdown(content)
    for (const chunk of chunks) {
      const sourceRef = `upload://${path}#${chunk.headingPath.join('/')}:${chunk.startLine}`
      const result = await store.upsertNodeBySourceHash({
        type: 'document_chunk',
        content: chunk.content,
        sourceType: 'upload',
        sourceRef,
        sourceHash: chunk.sourceHash,
        metadata: { path, headingPath: chunk.headingPath },
      })
      if (result.inserted) count++
    }
  }
  return count
}

export interface OnboardReport {
  tenantId: string
  interviewAnswers: number
  websiteChunks: number
  uploadChunks: number
  configWritten: string | null
}

export async function runOnboarding(opts: OnboardOptions): Promise<OnboardReport> {
  const { tenantId } = opts
  const store = new MemoryStore(tenantId)

  // 1. Interview
  const answers = await askInterview(opts)
  const interviewAnswers = await ingestInterview(store, tenantId, answers)

  // 2. Website scrape (optional)
  let websiteChunks = 0
  if ((opts.scrapeWebsite ?? true) && answers.companyUrl) {
    websiteChunks = await ingestWebsite(store, answers.companyUrl)
  }

  // 3. Uploads (optional — only interactive mode prompts for these)
  let uploadChunks = 0
  const uploadPaths = opts.uploadPaths ?? []
  if (!opts.nonInteractive && uploadPaths.length === 0) {
    const wantUploads = await confirm({
      message: 'Ingest local files (paste paths separated by commas)?',
      default: false,
    })
    if (wantUploads) {
      const raw = await input({ message: 'File paths (comma separated)' })
      const parsed = raw.split(',').map((s) => s.trim()).filter(Boolean)
      uploadChunks = await ingestUploads(store, parsed)
    }
  } else if (uploadPaths.length > 0) {
    uploadChunks = await ingestUploads(store, uploadPaths)
  }

  // 4. Write a minimal tenant config stub so future runs know onboarding
  //    happened. Does not overwrite an existing file.
  const dir = tenantConfigDir(tenantId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const configPath = join(dir, 'onboarding.yaml')
  let configWritten: string | null = null
  if (!existsSync(configPath)) {
    const stub = {
      tenant_id: tenantId,
      company_name: answers.companyName,
      onboarded_at: new Date().toISOString(),
      stats: {
        interview_answers: interviewAnswers,
        website_chunks: websiteChunks,
        upload_chunks: uploadChunks,
      },
    }
    writeFileSync(configPath, yaml.dump(stub))
    configWritten = configPath
  }

  return {
    tenantId,
    interviewAnswers,
    websiteChunks,
    uploadChunks,
    configWritten,
  }
}

// Exported for tests — lets specs drive the pipeline without touching
// the interactive prompts or Firecrawl.
export const _internal = {
  askInterview,
  ingestInterview,
  ingestUploads,
}
