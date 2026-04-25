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
import type Anthropic from '@anthropic-ai/sdk'
import { input, confirm, select, editor } from '@inquirer/prompts'
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
 * Heading text shown to the user in long-form mode, indexed by the same
 * order as QUESTIONS. Used for both the editor template and the regex
 * fallback parser.
 */
const LONGFORM_HEADINGS: Record<keyof InterviewAnswers, string> = {
  companyName: 'Company name',
  companyUrl: 'Company website URL',
  valueProp: 'One-sentence value proposition (who you sell to + what you solve)',
  icps: 'Primary ICP(s) — industries, company sizes, roles',
  painPoints: 'Top 3 pain points your buyers are trying to solve',
  competitors: 'Main competitors (comma separated)',
  channels: 'GTM channels you use (LinkedIn, email, Reddit, events, ...)',
  voice: 'Voice description — tone, phrases to use, phrases to avoid',
  successStories: 'One or two customer wins to reference',
  disqualifiers: 'Auto-disqualifiers (buyers you do NOT want)',
}

/**
 * Build the markdown template shown in $EDITOR for long-form mode.
 */
function buildLongformTemplate(): string {
  const lines: string[] = [
    '# YALC Onboarding — Long-form',
    '',
    'Answer freely under each heading. Empty headings will be inferred from context if possible.',
    '',
  ]
  for (const q of QUESTIONS) {
    lines.push(`## ${LONGFORM_HEADINGS[q.key]}`)
    lines.push('')
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Heading-based regex fallback parser used when no Anthropic key is
 * available (and we're not inside Claude Code). Splits the markdown on
 * `## ` headers and matches each heading text back to its question key
 * via the LONGFORM_HEADINGS map (case-insensitive, prefix match).
 */
export function parseLongformMarkdown(markdown: string): Partial<InterviewAnswers> {
  const out: Partial<InterviewAnswers> = {}
  const lines = markdown.split(/\r?\n/)
  let currentKey: keyof InterviewAnswers | null = null
  let buffer: string[] = []
  const flush = () => {
    if (currentKey == null) return
    const cleaned = buffer
      .filter((l) => !/^\s*<!--/.test(l)) // strip comment hints
      .join('\n')
      .trim()
    if (cleaned) out[currentKey] = cleaned
    buffer = []
  }
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) {
      flush()
      currentKey = matchHeadingToKey(m[1])
      continue
    }
    if (currentKey) buffer.push(line)
  }
  flush()
  return out
}

function matchHeadingToKey(heading: string): keyof InterviewAnswers | null {
  const norm = heading.toLowerCase().trim()
  // Try exact match first against the LONGFORM_HEADINGS values.
  for (const key of Object.keys(LONGFORM_HEADINGS) as Array<keyof InterviewAnswers>) {
    if (LONGFORM_HEADINGS[key].toLowerCase() === norm) return key
  }
  // Then prefix match (heading starts with the canonical heading minus parens).
  for (const key of Object.keys(LONGFORM_HEADINGS) as Array<keyof InterviewAnswers>) {
    const canonical = LONGFORM_HEADINGS[key].toLowerCase().split('(')[0].trim()
    if (norm.startsWith(canonical) || canonical.startsWith(norm)) return key
  }
  return null
}

function summarizeAnswers(answers: Partial<InterviewAnswers>): string[] {
  const out: string[] = []
  for (const q of QUESTIONS) {
    const v = answers[q.key]
    if (!v) {
      out.push(`  ${formatLabel(q.key)}: (unknown)`)
    } else {
      const flat = String(v).replace(/\s+/g, ' ').trim()
      const trimmed = flat.length > 100 ? `${flat.slice(0, 97)}...` : flat
      out.push(`  ${formatLabel(q.key)}: ${trimmed}`)
    }
  }
  return out
}

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
 * Tool schema mirroring InterviewAnswers — handed to Claude when parsing a
 * long-form blob or a context-only ingestion bundle.
 */
const PARSE_ANSWERS_TOOL = {
  name: 'write_interview_answers',
  description:
    'Map the source material to the 10 onboarding questions. Set any field you cannot determine to the literal string "(unknown)". Keep each value short and concrete.',
  input_schema: {
    type: 'object',
    properties: {
      companyName: { type: 'string' },
      companyUrl: { type: 'string' },
      valueProp: { type: 'string' },
      icps: { type: 'string' },
      painPoints: { type: 'string' },
      competitors: { type: 'string' },
      channels: { type: 'string' },
      voice: { type: 'string' },
      successStories: { type: 'string' },
      disqualifiers: { type: 'string' },
    },
    required: ['companyName'],
  },
} as const

async function parseLongformWithClaude(
  markdown: string,
): Promise<Partial<InterviewAnswers>> {
  const { getAnthropicClient, QUALIFIER_MODEL } = await import('../ai/client.js')
  const client = getAnthropicClient()
  const res = await client.messages.create({
    model: QUALIFIER_MODEL,
    max_tokens: 2048,
    tools: [PARSE_ANSWERS_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: 'tool', name: 'write_interview_answers' },
    messages: [
      {
        role: 'user',
        content:
          'Parse the long-form onboarding markdown below into structured answers via the write_interview_answers tool. Treat empty headings as "(unknown)".\n\n<markdown>\n' +
          markdown +
          '\n</markdown>',
      },
    ],
  })
  for (const block of res.content) {
    if (block.type === 'tool_use' && block.name === 'write_interview_answers') {
      return block.input as Partial<InterviewAnswers>
    }
  }
  return {}
}

async function inferAnswersFromContext(
  contextBlob: string,
): Promise<Partial<InterviewAnswers>> {
  const { getAnthropicClient, QUALIFIER_MODEL } = await import('../ai/client.js')
  const client = getAnthropicClient()
  const res = await client.messages.create({
    model: QUALIFIER_MODEL,
    max_tokens: 2048,
    tools: [PARSE_ANSWERS_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: 'tool', name: 'write_interview_answers' },
    messages: [
      {
        role: 'user',
        content:
          "Propose answers to the 10 onboarding questions from the source material below; mark any field you can't determine as (unknown). Use the write_interview_answers tool.\n\n<source>\n" +
          contextBlob +
          '\n</source>',
      },
    ],
  })
  for (const block of res.content) {
    if (block.type === 'tool_use' && block.name === 'write_interview_answers') {
      return block.input as Partial<InterviewAnswers>
    }
  }
  return {}
}

/**
 * Long-form mode: open $EDITOR with a markdown template, parse the result
 * (Claude when available, regex fallback otherwise), show a summary, and
 * loop until the user confirms.
 */
async function askLongform(opts: OnboardOptions): Promise<InterviewAnswers> {
  let draft = buildLongformTemplate()
  for (;;) {
    const filled = await editor({
      message: 'Long-form onboarding (your editor will open). Save and close when done.',
      default: draft,
      postfix: '.md',
      waitForUserInput: false,
    })

    let parsed: Partial<InterviewAnswers> = {}
    const canUseClaude =
      !!process.env.ANTHROPIC_API_KEY || (await isClaudeCodeContext())
    if (canUseClaude && process.env.ANTHROPIC_API_KEY) {
      try {
        parsed = await parseLongformWithClaude(filled)
      } catch (err) {
        console.warn(
          `[onboard] Claude parse failed (${
            err instanceof Error ? err.message : String(err)
          }), falling back to regex parser.`,
        )
        parsed = parseLongformMarkdown(filled)
      }
    } else {
      parsed = parseLongformMarkdown(filled)
    }

    if (!parsed.companyName || /^\(unknown\)$/i.test(parsed.companyName)) {
      console.warn(
        '[onboard] Company name missing — re-opening the editor so you can fill it in.',
      )
      draft = filled
      continue
    }

    console.log('\n  Parsed answers:')
    for (const line of summarizeAnswers(parsed)) console.log(line)
    console.log('')

    const ok = await confirm({ message: 'Use these answers?', default: true })
    if (ok) {
      // Replace any "(unknown)" literals with empty strings before returning.
      const out: Partial<InterviewAnswers> = {}
      for (const k of Object.keys(parsed) as Array<keyof InterviewAnswers>) {
        const v = parsed[k]
        out[k] = !v || /^\(unknown\)$/i.test(String(v)) ? '' : String(v)
      }
      // Backfill missing required-keys with placeholders so ingest still works.
      for (const q of QUESTIONS) {
        if (out[q.key] == null) out[q.key] = ''
      }
      return out as InterviewAnswers
    }
    draft = filled
  }
}

async function isClaudeCodeContext(): Promise<boolean> {
  const { isClaudeCode } = await import('../env/claude-code.js')
  return isClaudeCode()
}

/**
 * Context-only mode: take a company name + optional URL + optional uploads,
 * run the existing scrape/ingest pipeline, then ask Claude to propose
 * answers to all 10 onboarding questions.
 *
 * Falls back to mode A (Q&A) when no Anthropic key is set and we're not
 * running inside Claude Code — context-only inference needs a model.
 */
async function askContextOnly(
  opts: OnboardOptions,
  store: MemoryStore,
): Promise<{ answers: InterviewAnswers; websiteChunks: number; uploadChunks: number }> {
  const { getWebSearchProvider } = await import('../env/claude-code.js')
  const inCC = await isClaudeCodeContext()
  if (!process.env.ANTHROPIC_API_KEY && !inCC) {
    console.log(
      '\n  Context-only mode requires either an Anthropic key or running inside Claude Code.',
    )
    console.log('  Falling back to Q&A mode.\n')
    const answers = await askInterview(opts)
    return { answers, websiteChunks: 0, uploadChunks: 0 }
  }

  const companyName = (
    await input({
      message: 'Company name',
      validate: (v: string) => (v.trim() ? true : 'Company name is required'),
    })
  ).trim()

  let companyUrl = (
    await input({ message: 'Company website URL (optional)' })
  ).trim()

  if (!companyUrl) {
    const provider = getWebSearchProvider()
    if (provider === 'firecrawl') {
      try {
        const { firecrawlService } = await import('../services/firecrawl.js')
        const results = await firecrawlService.search(
          `${companyName} official website`,
          5,
        )
        const first = results.find((r) => r.url)
        if (first?.url) {
          companyUrl = first.url
          console.log(`  Resolved website: ${companyUrl}`)
        }
      } catch (err) {
        console.warn(
          `[onboard] Firecrawl search failed (${
            err instanceof Error ? err.message : String(err)
          })`,
        )
      }
    } else if (provider === 'claude-code') {
      console.log(
        `[onboard] WebSearch handoff: please run WebSearch for "${companyName} official website" and re-invoke with --website <url>`,
      )
    }
  }

  const rawPaths = await input({
    message: 'Local file paths to ingest (comma separated, optional)',
  })
  const uploadPaths = rawPaths
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // Run the existing ingest pipeline so the resolver-aware behaviour is
  // honoured (Claude Code handoff lines, Firecrawl scraping, etc).
  let websiteChunks = 0
  if (companyUrl) {
    websiteChunks = await ingestWebsite(store, companyUrl)
  }
  const uploadChunks = uploadPaths.length > 0 ? await ingestUploads(store, uploadPaths) : 0

  // Build a context blob from whatever the store now knows about this tenant
  // plus the upload contents we just ingested. We deliberately re-read the
  // uploads here (rather than reuse what ingestUploads kept) to keep the
  // function decoupled.
  const blobParts: string[] = []
  blobParts.push(`Company name (user-provided): ${companyName}`)
  if (companyUrl) blobParts.push(`Company URL (user-provided): ${companyUrl}`)
  for (const p of uploadPaths) {
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8')
      blobParts.push(`--- ${p} ---\n${content.slice(0, 8000)}`)
    }
  }
  // Pull the most recent website chunks from the store so Claude sees them.
  const recent = await store.listNodes({ limit: 30 })
  for (const n of recent) {
    if (n.sourceType === 'website' || n.sourceType === 'upload') {
      blobParts.push(`[${n.sourceType}] ${n.content.slice(0, 1000)}`)
    }
  }
  const blob = blobParts.join('\n\n').slice(0, 60000)

  let proposed: Partial<InterviewAnswers> = {}
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      proposed = await inferAnswersFromContext(blob)
    } catch (err) {
      console.warn(
        `[onboard] Claude inference failed (${
          err instanceof Error ? err.message : String(err)
        })`,
      )
    }
  } else {
    console.log(
      '[onboard] Claude Code handoff: ask the parent session to call write_interview_answers ' +
        'over the ingested context, then re-invoke onboard with the resulting answers.',
    )
  }

  // Always make sure the user-confirmed name + URL win over any inference.
  proposed.companyName = companyName
  if (companyUrl) proposed.companyUrl = companyUrl

  console.log('\n  Proposed answers:')
  for (const line of summarizeAnswers(proposed)) console.log(line)
  console.log('')

  const ok = await confirm({ message: 'Use these answers?', default: true })
  if (!ok) {
    console.log('  Falling back to Q&A mode for the remaining fields.\n')
    const seeded: Partial<InterviewAnswers> = { ...proposed }
    for (const k of Object.keys(seeded) as Array<keyof InterviewAnswers>) {
      const v = seeded[k]
      if (!v || /^\(unknown\)$/i.test(String(v))) delete seeded[k]
    }
    const answers = await askInterview({ ...opts, answers: seeded })
    return { answers, websiteChunks, uploadChunks }
  }

  // Strip "(unknown)" placeholders before returning.
  const out: Partial<InterviewAnswers> = {}
  for (const k of Object.keys(proposed) as Array<keyof InterviewAnswers>) {
    const v = proposed[k]
    out[k] = !v || /^\(unknown\)$/i.test(String(v)) ? '' : String(v)
  }
  for (const q of QUESTIONS) {
    if (out[q.key] == null) out[q.key] = ''
  }
  return { answers: out as InterviewAnswers, websiteChunks, uploadChunks }
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
  opts: { confidenceScore?: number } = {},
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
      confidenceScore: opts.confidenceScore ?? 70,
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

export type OnboardMode = 'qa' | 'longform' | 'context-only'

/**
 * Pick which onboarding mode to run. Skipped under --non-interactive (always
 * 'qa' — the legacy default). Exported so tests can drive the dispatch
 * without going through inquirer.
 */
export async function pickOnboardingMode(opts: OnboardOptions): Promise<OnboardMode> {
  if (opts.nonInteractive) return 'qa'
  const choice = await select<OnboardMode>({
    message: 'How would you like to provide your company context?',
    default: 'qa',
    choices: [
      {
        name: 'A. Q&A — answer 10 questions one by one (current default)',
        value: 'qa',
      },
      {
        name: 'B. Long-form — see all questions at once and write a single response',
        value: 'longform',
      },
      {
        name: "C. Context-only — give me your website + docs and I'll fill it in",
        value: 'context-only',
      },
    ],
  })
  return choice
}

export async function runOnboarding(opts: OnboardOptions): Promise<OnboardReport> {
  const { tenantId } = opts
  const store = new MemoryStore(tenantId)

  // 0. Mode picker (skipped under --non-interactive)
  const mode = await pickOnboardingMode(opts)

  // 1. Interview — branch on the chosen mode.
  let answers: InterviewAnswers
  let websiteChunks = 0
  let uploadChunks = 0
  let confidenceScore = 70

  if (mode === 'longform') {
    answers = await askLongform(opts)
    confidenceScore = 65
  } else if (mode === 'context-only') {
    const result = await askContextOnly(opts, store)
    answers = result.answers
    websiteChunks = result.websiteChunks
    uploadChunks = result.uploadChunks
    // Lower the score for Claude-derived answers — they're inferred, not
    // user-stated. Match the behaviour spelled out in the phase brief.
    confidenceScore = 60
  } else {
    answers = await askInterview(opts)
  }

  const interviewAnswers = await ingestInterview(store, tenantId, answers, {
    confidenceScore,
  })

  // 2. Website scrape — only run if the chosen branch hasn't already done
  //    it (context-only handles it inline).
  if (mode !== 'context-only') {
    if ((opts.scrapeWebsite ?? true) && answers.companyUrl) {
      websiteChunks = await ingestWebsite(store, answers.companyUrl)
    }
  }

  // 3. Uploads — context-only collects them inline; qa/longform may still
  //    prompt at the end for any extra files.
  const uploadPaths = opts.uploadPaths ?? []
  if (mode !== 'context-only') {
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
  askLongform,
  askContextOnly,
  ingestInterview,
  ingestUploads,
  buildLongformTemplate,
}
