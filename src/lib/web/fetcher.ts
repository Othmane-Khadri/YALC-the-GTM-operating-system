import { randomUUID } from 'crypto'
import { eq, and, gt } from 'drizzle-orm'
import { db } from '../db'
import { webCache } from '../db/schema'
import type { CacheContentType } from './types'

const TTL_HOURS: Record<CacheContentType, number> = {
  company_page: 168,
  blog_post: 24,
  job_posting: 72,
  press_release: 24,
  social_profile: 168,
  search_result: 24,
}

export class WebFetcher {
  async fetch(
    url: string,
    contentType: CacheContentType = 'company_page'
  ): Promise<{ content: string; contentType: CacheContentType; fromCache: boolean }> {
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
      }
    }

    let content: string | null = null
    try {
      content = await this.fetchViaFirecrawl(url)
    } catch {
      // Firecrawl not available — fall through
    }

    if (!content) {
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

    return { content, contentType, fromCache: false }
  }

  private async fetchViaFirecrawl(url: string): Promise<string | null> {
    const { getRegistry } = await import('../providers/registry')
    const registry = getRegistry()

    const providers = registry.getAll()
    const firecrawl = providers.find(
      p => p.id.includes('firecrawl') && p.type === 'mcp' && p.status === 'active'
    )

    if (!firecrawl) return null

    const { mcpManager } = await import('../mcp/client')
    try {
      const result = await mcpManager.callTool(firecrawl.id, 'firecrawl_scrape', { url })
      return typeof result === 'string' ? result : JSON.stringify(result)
    } catch {
      return null
    }
  }

  private async fetchBuiltIn(url: string): Promise<string> {
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
