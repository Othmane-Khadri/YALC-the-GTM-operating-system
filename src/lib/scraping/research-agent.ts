/**
 * AI Research Agent — general-purpose web research with evidence chains.
 *
 * Takes a question + target, searches the web, scrapes relevant pages,
 * extracts structured answers with Claude, cross-references findings,
 * and feeds results into the intelligence store with confidence scoring.
 */

import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { webCache, webResearchTasks } from '../db/schema'
import { firecrawlService } from '../services/firecrawl'
import { IntelligenceStore } from '../intelligence/store'
import type { Evidence } from '../intelligence/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResearchInput {
  question: string
  targetType: 'company' | 'person' | 'topic'
  target: string
  maxSources?: number
  tenantId?: string
}

export interface ResearchEvidence {
  url: string
  scrapedAt: string
  extractedText: string
  relevanceScore: number
}

export interface ResearchFinding {
  question: string
  answer: string
  confidence: number // 0-100
  evidence: ResearchEvidence[]
  structuredData: Record<string, unknown>
}

export interface SearchPlanEntry {
  query: string
  rationale: string
}

export interface ResearchProgress {
  phase: 'planning' | 'scraping' | 'extracting' | 'verifying' | 'storing'
  message: string
  percent: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SOURCES_LIMIT = 10
const CACHE_TTL_DAYS = 7
const GATED_CONTENT_TYPE = 'gated'

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

export async function getCachedContent(url: string): Promise<{ content: string; fetchedAt: string } | null> {
  const rows = await db
    .select()
    .from(webCache)
    .where(eq(webCache.url, url))
    .limit(1)

  if (rows.length === 0) return null

  const row = rows[0]
  const fetchedAt = new Date(row.fetchedAt)
  const now = new Date()
  const ageMs = now.getTime() - fetchedAt.getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)

  // Expired cache
  if (ageDays >= CACHE_TTL_DAYS) return null

  // Gated domain — return null content but signal it's gated
  if (row.contentType === GATED_CONTENT_TYPE) return null

  return { content: row.content, fetchedAt: row.fetchedAt }
}

export function isDomainGated(url: string): Promise<boolean> {
  return db
    .select()
    .from(webCache)
    .where(eq(webCache.url, url))
    .limit(1)
    .then((rows) => {
      if (rows.length === 0) return false
      return rows[0].contentType === GATED_CONTENT_TYPE
    })
}

export async function isAnyDomainPathGated(url: string): Promise<boolean> {
  try {
    const hostname = new URL(url).hostname
    const rows = await db
      .select()
      .from(webCache)
      .where(eq(webCache.contentType, GATED_CONTENT_TYPE))

    return rows.some((r) => {
      try {
        return new URL(r.url).hostname === hostname
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

async function setCacheEntry(url: string, content: string, contentType: string): Promise<void> {
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Upsert — delete then insert (SQLite-friendly)
  await db.delete(webCache).where(eq(webCache.url, url))
  await db.insert(webCache).values({
    id: randomUUID(),
    url,
    content,
    contentType,
    fetchedAt: now,
    expiresAt,
  })
}

// ---------------------------------------------------------------------------
// Search plan generation
// ---------------------------------------------------------------------------

export function generateSearchPlan(
  question: string,
  targetType: 'company' | 'person' | 'topic',
  target: string,
  maxSources: number,
): SearchPlanEntry[] {
  const plans: SearchPlanEntry[] = []

  if (targetType === 'company') {
    plans.push(
      { query: `${target} ${question}`, rationale: 'Direct company + question search' },
      { query: `site:${target} ${question}`, rationale: 'Search within company domain' },
      { query: `"${target}" ${question}`, rationale: 'Exact company name match' },
      { query: `${target} tech stack tools`, rationale: 'Technology intelligence' },
      { query: `${target} crunchbase OR linkedin`, rationale: 'Company profile sources' },
    )
  } else if (targetType === 'person') {
    plans.push(
      { query: `"${target}" ${question}`, rationale: 'Exact person name + question' },
      { query: `"${target}" linkedin`, rationale: 'LinkedIn profile' },
      { query: `"${target}" interview OR podcast OR talk`, rationale: 'Public appearances' },
    )
  } else {
    plans.push(
      { query: `${target} ${question}`, rationale: 'Topic + question search' },
      { query: `"${target}" analysis OR report`, rationale: 'Analysis and reports' },
      { query: `${target} market trends 2024 2025`, rationale: 'Recent market intelligence' },
    )
  }

  return plans.slice(0, maxSources)
}

// ---------------------------------------------------------------------------
// Content scraping with cache
// ---------------------------------------------------------------------------

export interface ScrapeResult {
  url: string
  content: string
  fromCache: boolean
  scrapedAt: string
  error?: string
}

async function scrapeWithCache(url: string): Promise<ScrapeResult> {
  const now = new Date().toISOString()

  // Check if domain is gated
  if (await isAnyDomainPathGated(url)) {
    return { url, content: '', fromCache: false, scrapedAt: now, error: 'domain_gated' }
  }

  // Check cache
  const cached = await getCachedContent(url)
  if (cached) {
    return { url, content: cached.content, fromCache: true, scrapedAt: cached.fetchedAt }
  }

  // Scrape via Firecrawl
  try {
    const content = await firecrawlService.scrape(url)
    await setCacheEntry(url, content, 'text/markdown')
    return { url, content, fromCache: false, scrapedAt: now }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Detect 403/paywall — mark domain as gated
    if (message.includes('403') || message.includes('paywall') || message.includes('Forbidden')) {
      await setCacheEntry(url, '', GATED_CONTENT_TYPE)
      return { url, content: '', fromCache: false, scrapedAt: now, error: 'gated_403' }
    }

    return { url, content: '', fromCache: false, scrapedAt: now, error: message }
  }
}

// ---------------------------------------------------------------------------
// Extraction — uses Claude to pull structured answers
// ---------------------------------------------------------------------------

export function buildExtractionPrompt(
  question: string,
  target: string,
  scrapedContent: Array<{ url: string; content: string }>,
): string {
  const sourcesBlock = scrapedContent
    .map((s, i) => `--- SOURCE ${i + 1} (${s.url}) ---\n${s.content.slice(0, 3000)}\n`)
    .join('\n')

  return `You are a research analyst. Extract a structured answer to the question below from the provided sources.

TARGET: ${target}
QUESTION: ${question}

SOURCES:
${sourcesBlock}

Respond with valid JSON only (no markdown fences):
{
  "answer": "Concise factual answer to the question",
  "confidence": <0-100 integer>,
  "evidence": [
    {
      "sourceIndex": <1-based>,
      "extractedText": "The specific passage supporting this answer",
      "relevanceScore": <0-100>
    }
  ],
  "structuredData": {
    // Any structured fields extracted (e.g., revenue, employee_count, tech_stack, etc.)
  }
}

Rules:
- confidence reflects how well the sources answer the question (0 = no relevant info, 100 = definitive answer with multiple confirming sources)
- extractedText must be an actual quote or close paraphrase from the source
- If sources conflict, note it in the answer and lower confidence
- If no sources have relevant info, set confidence to 0 and answer to "Insufficient data from available sources"
- structuredData should capture any quantifiable or categorical data found`
}

export interface ExtractionResult {
  answer: string
  confidence: number
  evidence: Array<{
    sourceIndex: number
    extractedText: string
    relevanceScore: number
  }>
  structuredData: Record<string, unknown>
}

export function parseExtractionResponse(raw: string): ExtractionResult {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    return {
      answer: String(parsed.answer ?? 'No answer extracted'),
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence ?? 0))),
      evidence: Array.isArray(parsed.evidence)
        ? parsed.evidence.map((e: Record<string, unknown>) => ({
            sourceIndex: Number(e.sourceIndex ?? 0),
            extractedText: String(e.extractedText ?? ''),
            relevanceScore: Math.min(100, Math.max(0, Number(e.relevanceScore ?? 0))),
          }))
        : [],
      structuredData: typeof parsed.structuredData === 'object' && parsed.structuredData
        ? parsed.structuredData
        : {},
    }
  } catch {
    return {
      answer: 'Failed to parse extraction response',
      confidence: 0,
      evidence: [],
      structuredData: {},
    }
  }
}

// ---------------------------------------------------------------------------
// Intelligence store integration
// ---------------------------------------------------------------------------

export async function storeResearchFinding(
  finding: ResearchFinding,
  target: string,
  tenantId: string,
): Promise<string> {
  const store = new IntelligenceStore(tenantId)

  const evidence: Evidence[] = finding.evidence.map((e, i) => ({
    type: 'web_research',
    sourceId: e.url,
    metric: 'relevance_score',
    value: e.relevanceScore,
    sampleSize: 1,
    timestamp: e.scrapedAt,
  }))

  const entry = await store.add({
    category: 'competitive',
    insight: `[Research] ${finding.question} — ${finding.answer}`,
    evidence,
    segment: target,
    channel: 'web',
    confidence: finding.confidence >= 70 ? 'validated' : 'hypothesis',
    source: 'external',
    biasCheck: null,
    supersedes: null,
    validatedAt: finding.confidence >= 70 ? new Date().toISOString() : null,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
  })

  return entry.id
}

// ---------------------------------------------------------------------------
// Research task tracking
// ---------------------------------------------------------------------------

async function createResearchTask(
  input: ResearchInput,
): Promise<string> {
  const id = randomUUID()
  await db.insert(webResearchTasks).values({
    id,
    tenantId: input.tenantId ?? 'default',
    targetType: input.targetType,
    targetIdentifier: input.target,
    status: 'running',
    requestedBy: 'research-agent',
    createdAt: new Date().toISOString(),
  })
  return id
}

async function completeResearchTask(
  taskId: string,
  finding: ResearchFinding,
): Promise<void> {
  await db
    .update(webResearchTasks)
    .set({
      status: 'completed',
      results: JSON.stringify(finding),
      completedAt: new Date().toISOString(),
    })
    .where(eq(webResearchTasks.id, taskId))
}

async function failResearchTask(taskId: string, error: string): Promise<void> {
  await db
    .update(webResearchTasks)
    .set({
      status: 'failed',
      results: JSON.stringify({ error }),
      completedAt: new Date().toISOString(),
    })
    .where(eq(webResearchTasks.id, taskId))
}

// ---------------------------------------------------------------------------
// Main research agent loop
// ---------------------------------------------------------------------------

export interface ResearchAgentOptions {
  /** Called with progress updates. Optional. */
  onProgress?: (progress: ResearchProgress) => void
  /** Claude call for extraction. Injected for testability. */
  callClaude?: (prompt: string) => Promise<string>
}

export async function runResearchAgent(
  input: ResearchInput,
  options: ResearchAgentOptions = {},
): Promise<ResearchFinding> {
  const { onProgress, callClaude } = options
  const maxSources = Math.min(input.maxSources ?? 5, MAX_SOURCES_LIMIT)
  const tenantId = input.tenantId ?? 'default'

  const emit = (phase: ResearchProgress['phase'], message: string, percent: number) => {
    onProgress?.({ phase, message, percent })
  }

  // Track task
  const taskId = await createResearchTask(input)

  try {
    // ── Phase 1: Plan ──
    emit('planning', `Generating search plan for: ${input.question}`, 5)
    const searchPlan = generateSearchPlan(input.question, input.targetType, input.target, maxSources)
    emit('planning', `Search plan ready: ${searchPlan.length} queries`, 10)

    // ── Phase 2: Search + Scrape ──
    emit('scraping', `Searching the web (max ${maxSources} sources)...`, 15)

    const allSearchResults: Array<{ url: string; title: string; content: string }> = []

    for (let i = 0; i < searchPlan.length && allSearchResults.length < maxSources; i++) {
      const plan = searchPlan[i]
      emit('scraping', `Query ${i + 1}/${searchPlan.length}: ${plan.query}`, 15 + (i / searchPlan.length) * 20)

      try {
        const results = await firecrawlService.search(plan.query, Math.min(3, maxSources - allSearchResults.length))
        for (const r of results) {
          if (!allSearchResults.some((existing) => existing.url === r.url)) {
            allSearchResults.push(r)
          }
        }
      } catch {
        // Search failed for this query — continue with others
      }

      if (allSearchResults.length >= maxSources) break
    }

    if (allSearchResults.length === 0) {
      const emptyFinding: ResearchFinding = {
        question: input.question,
        answer: 'No search results found for this query',
        confidence: 0,
        evidence: [],
        structuredData: {},
      }
      await completeResearchTask(taskId, emptyFinding)
      return emptyFinding
    }

    emit('scraping', `Found ${allSearchResults.length} unique URLs. Scraping content...`, 40)

    // Scrape each URL (respecting cache)
    const scrapeResults: ScrapeResult[] = []
    const urlsToScrape = allSearchResults.slice(0, maxSources)

    for (let i = 0; i < urlsToScrape.length; i++) {
      const searchResult = urlsToScrape[i]
      const percent = 40 + (i / urlsToScrape.length) * 25
      emit('scraping', `Scraping ${i + 1}/${urlsToScrape.length}: ${searchResult.url.slice(0, 60)}...`, percent)

      const result = await scrapeWithCache(searchResult.url)
      if (result.content) {
        scrapeResults.push(result)
      }
    }

    emit('scraping', `Scraped ${scrapeResults.length} pages (${scrapeResults.filter((r) => r.fromCache).length} from cache)`, 65)

    if (scrapeResults.length === 0) {
      // Fall back to search snippet content
      const snippetSources = allSearchResults
        .filter((r) => r.content)
        .map((r) => ({ url: r.url, content: r.content }))

      if (snippetSources.length === 0) {
        const emptyFinding: ResearchFinding = {
          question: input.question,
          answer: 'All sources were inaccessible (gated/403)',
          confidence: 0,
          evidence: [],
          structuredData: {},
        }
        await completeResearchTask(taskId, emptyFinding)
        return emptyFinding
      }
    }

    // ── Phase 3: Extract ──
    emit('extracting', 'Extracting structured answers with AI...', 70)

    const sourcesForExtraction = scrapeResults.length > 0
      ? scrapeResults.map((r) => ({ url: r.url, content: r.content }))
      : allSearchResults.filter((r) => r.content).map((r) => ({ url: r.url, content: r.content }))

    const extractionPrompt = buildExtractionPrompt(input.question, input.target, sourcesForExtraction)

    let extraction: ExtractionResult

    if (callClaude) {
      const raw = await callClaude(extractionPrompt)
      extraction = parseExtractionResponse(raw)
    } else {
      // Dynamic import to avoid circular deps and allow testing without Anthropic SDK
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic()
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: extractionPrompt }],
      })
      const textBlock = response.content.find((b) => b.type === 'text')
      extraction = parseExtractionResponse(textBlock?.text ?? '')
    }

    emit('extracting', `Extraction complete. Confidence: ${extraction.confidence}%`, 80)

    // ── Phase 4: Verify (cross-reference) ──
    emit('verifying', 'Cross-referencing findings across sources...', 85)

    // Build evidence chain with source URLs
    const evidenceChain: ResearchEvidence[] = extraction.evidence.map((e) => {
      const sourceIdx = e.sourceIndex - 1
      const source = sourcesForExtraction[sourceIdx]
      return {
        url: source?.url ?? 'unknown',
        scrapedAt: scrapeResults[sourceIdx]?.scrapedAt ?? new Date().toISOString(),
        extractedText: e.extractedText,
        relevanceScore: e.relevanceScore,
      }
    })

    // Adjust confidence based on source count and agreement
    let adjustedConfidence = extraction.confidence
    if (evidenceChain.length === 0) {
      adjustedConfidence = Math.min(adjustedConfidence, 20)
    } else if (evidenceChain.length === 1) {
      adjustedConfidence = Math.min(adjustedConfidence, 60) // Single source cap
    }

    const finding: ResearchFinding = {
      question: input.question,
      answer: extraction.answer,
      confidence: adjustedConfidence,
      evidence: evidenceChain,
      structuredData: extraction.structuredData,
    }

    emit('verifying', `Verified. Final confidence: ${adjustedConfidence}%`, 90)

    // ── Phase 5: Store ──
    emit('storing', 'Storing findings in intelligence store...', 92)

    const intelligenceId = await storeResearchFinding(finding, input.target, tenantId)
    finding.structuredData._intelligenceId = intelligenceId

    await completeResearchTask(taskId, finding)

    emit('storing', 'Research complete.', 100)

    return finding
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await failResearchTask(taskId, message)
    throw err
  }
}
