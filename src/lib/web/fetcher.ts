import { randomUUID, createHash } from 'crypto'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { eq, and, gt } from 'drizzle-orm'
import { db } from '../db'
import { webCache } from '../db/schema'
import type { CacheContentType } from './types'
import { validateUrl } from './url-validator'
import { isClaudeCode } from '../env/claude-code'

const TTL_HOURS: Record<CacheContentType, number> = {
  company_page: 168,
  blog_post: 24,
  job_posting: 72,
  press_release: 24,
  social_profile: 168,
  search_result: 24,
}

/** Pages with at least this many chars count as "real" content. */
export const THIN_CONTENT_THRESHOLD = 500

/**
 * Auth/permission errors must NOT be retried — the keys / scopes / URL are
 * wrong and a retry just wastes wall-clock. Everything else (network, 5xx,
 * throttling, generic failures) goes through the backoff loop.
 *
 * Exposed for tests + callers that want to gate their own retry logic.
 */
export function isAuthFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /\b(401|403|404)\b/.test(msg)
}

/** Backoff schedule for the 3-attempt retry wrapper: 1s, 3s, 9s. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 9000]

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 3× exponential-backoff retry around any async fetch operation. Returns
 * the operation's value on success, or the last seen error on failure.
 * Auth failures (401/403/404) short-circuit immediately.
 *
 * Exported so other fetch wrappers (Firecrawl service, future scrape paths)
 * can opt into the same envelope without each re-implementing it.
 */
export async function withRetry<T>(
  op: () => Promise<T>,
  ctx: { label: string; sleepFn?: (ms: number) => Promise<void> } = { label: 'fetch' },
): Promise<T> {
  const wait = ctx.sleepFn ?? sleep
  const attempts = RETRY_DELAYS_MS.length
  let lastErr: unknown

  for (let i = 0; i < attempts; i += 1) {
    try {
      return await op()
    } catch (err) {
      lastErr = err
      if (isAuthFailure(err)) {
        throw err
      }
      const isLast = i === attempts - 1
      if (isLast) break
      await wait(RETRY_DELAYS_MS[i])
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export interface FetchResult {
  content: string
  contentType: CacheContentType
  fromCache: boolean
  /** True when the fetched body is below `THIN_CONTENT_THRESHOLD`. */
  thin: boolean
}

export class WebFetcher {
  async fetch(
    url: string,
    contentType: CacheContentType = 'company_page'
  ): Promise<FetchResult> {
    // Validate URL before any fetch path (Firecrawl or built-in)
    await validateUrl(url)
    const now = new Date().toISOString()
    const cached = await db
      .select()
      .from(webCache)
      .where(
        and(
          eq(webCache.url, url),
          gt(webCache.expiresAt, now)
        )
      )
      .limit(1)

    if (cached.length > 0) {
      return {
        content: cached[0].content,
        contentType: cached[0].contentType as CacheContentType,
        fromCache: true,
        thin: cached[0].content.length < THIN_CONTENT_THRESHOLD,
      }
    }

    let content: string | null = null
    try {
      content = await this.fetchViaFirecrawl(url)
    } catch {
      // Firecrawl not available — fall through
    }

    if (!content) {
      // Inside Claude Code without Firecrawl: emit a structured handoff
      // marker so the parent session can WebFetch the URL on our behalf and
      // re-invoke. The marker is both stdout-tagged (parsable by CC's
      // pattern matcher) AND mirrored to a JSON file under
      // `~/.gtm-os/_handoffs/<id>.json` for tools that prefer file-based.
      if (isClaudeCode() && !process.env.FIRECRAWL_API_KEY) {
        emitWebFetchHandoff(url, 'fetcher fell back to handoff because no Firecrawl key is set inside Claude Code')
      }
      content = await this.fetchBuiltIn(url)
    }

    const ttlHours = TTL_HOURS[contentType] ?? 24
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString()

    await db.delete(webCache).where(eq(webCache.url, url))
    await db.insert(webCache).values({
      id: randomUUID(),
      url,
      content,
      contentType,
      extractedInsights: null,
      fetchedAt: now,
      expiresAt,
    })

    return {
      content,
      contentType,
      fromCache: false,
      thin: content.length < THIN_CONTENT_THRESHOLD,
    }
  }

  private async fetchViaFirecrawl(url: string): Promise<string | null> {
    const { firecrawlService } = await import('../services/firecrawl')
    if (!firecrawlService.isAvailable()) return null
    try {
      return await withRetry(() => firecrawlService.scrape(url), {
        label: `firecrawl:${url}`,
      })
    } catch {
      // After 3× backoff still failing, surface as null so the outer caller
      // can fall back to the built-in fetcher or emit a handoff.
      return null
    }
  }

  private async fetchBuiltIn(url: string): Promise<string> {
    return withRetry(
      async () => {
        const response = await globalThis.fetch(url, {
          headers: {
            'User-Agent': 'GTM-OS Web Intelligence/1.0',
            'Accept': 'text/html, application/json, text/plain',
          },
          signal: AbortSignal.timeout(15000),
        })

        if (!response.ok) {
          throw new Error(`Fetch failed: ${response.status} ${response.statusText}`)
        }

        const html = await response.text()
        return this.htmlToMarkdown(html)
      },
      { label: `builtin:${url}` },
    )
  }

  private htmlToMarkdown(html: string): string {
    let text = html
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
    text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
    text = text.replace(/<\/p>/gi, '\n\n')
    text = text.replace(/<br\s*\/?>/gi, '\n')
    text = text.replace(/<\/div>/gi, '\n')
    text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    text = text.replace(/<[^>]+>/g, '')
    text = text.replace(/&amp;/g, '&')
    text = text.replace(/&lt;/g, '<')
    text = text.replace(/&gt;/g, '>')
    text = text.replace(/&quot;/g, '"')
    text = text.replace(/&#39;/g, "'")
    text = text.replace(/&nbsp;/g, ' ')
    text = text.replace(/\n{3,}/g, '\n\n')
    text = text.trim()
    if (text.length > 50000) {
      text = text.substring(0, 50000) + '\n\n[Content truncated at 50,000 characters]'
    }
    return text
  }
}

/**
 * Emit a structured WebFetch handoff so a parent Claude Code session can
 * intercept and execute the fetch on our behalf. Two surfaces:
 *
 *   1. A stdout marker line —
 *      `<<<YALC_WEBFETCH_REQUEST:{"url": "...", ...}>>>` —
 *      pattern-matchable by CC.
 *   2. A JSON file written to `~/.gtm-os/_handoffs/<id>.json` so harnesses
 *      that prefer file-based watching can pick it up.
 *
 * Returns the handoff id (also used as the file name).
 */
export function emitWebFetchHandoff(
  url: string,
  reason: string,
  saveTo?: string,
): string {
  const id = createHash('sha256').update(`${url}|${Date.now()}|${Math.random()}`).digest('hex').slice(0, 16)
  const dir = join(homedir(), '.gtm-os', '_handoffs')
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // Best-effort.
    }
  }
  const target = saveTo ?? join(dir, `${id}.fetched.md`)
  const payload = {
    id,
    url,
    save_to: target,
    reason,
    requested_at: new Date().toISOString(),
  }

  // Stdout marker (single line — required for CC's regex pickup).
  console.log(`<<<YALC_WEBFETCH_REQUEST:${JSON.stringify(payload)}>>>`)

  // File mirror — best-effort, never throws on the caller path.
  try {
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(payload, null, 2))
  } catch {
    // No-op.
  }
  return id
}
