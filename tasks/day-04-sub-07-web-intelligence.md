# Sub-Brief 4.7 — Web Intelligence

**Goal:** Build a service that fetches and analyzes real-time web data for enrichment, prospect research, and trigger event detection. Provider-agnostic (uses Firecrawl MCP if connected, built-in fetch otherwise). Results cached with TTL per content type.

---

## Read These Files First

Read every file listed below before writing any code. Understand the current shapes, imports, and patterns.

1. `src/lib/providers/registry.ts` — provider registry (from 4.1) — you will check for Firecrawl MCP here
2. `src/lib/mcp/client.ts` — MCP client (from 4.2) — for calling Firecrawl tools
3. `src/lib/db/schema.ts` — current tables
4. `src/lib/ai/client.ts` — Anthropic client + model constants (Sonnet model ID for analysis)
5. `docs/SYSTEMS_ARCHITECTURE.md` — Web Intelligence section

---

## New Files to Create

### `src/lib/web/types.ts`

All web-intelligence types. No runtime logic, only types and interfaces.

```ts
// WebResearchType — what kind of entity we are researching
export type WebResearchType = 'company' | 'person' | 'competitor' | 'trigger_event';

// CacheContentType — classification for TTL management
export type CacheContentType =
  | 'company_page'
  | 'blog_post'
  | 'job_posting'
  | 'press_release'
  | 'social_profile'
  | 'search_result';

// WebInsight — a single piece of analyzed information
export interface WebInsight {
  source: string;              // URL or source identifier
  content: string;             // the extracted insight text
  relevance: 'high' | 'medium' | 'low';
  extractedAt: string;         // ISO-8601
}

// WebResearchRequest — input to the researcher
export interface WebResearchRequest {
  targetType: WebResearchType;
  targetIdentifier: string;    // domain, person name, company name, etc.
  questions: string[];         // specific questions to answer from the research
  maxAge?: number;             // max cache age in hours (default 24)
}

// WebResearchResult — output from the researcher
export interface WebResearchResult {
  insights: WebInsight[];
  sources: { url: string; fetchedAt: string }[];
  fromCache: boolean;
}

// CachedPage — a single cached web page
export interface CachedPage {
  id: string;
  url: string;
  content: string;
  contentType: CacheContentType;
  extractedInsights: WebInsight[] | null;
  fetchedAt: string;
  expiresAt: string;
}
```

---

### `src/lib/web/fetcher.ts`

The `WebFetcher` class. Provider-agnostic with cache-first resolution.

```ts
import { randomUUID } from 'crypto';
import { eq, and, gt } from 'drizzle-orm';
import { db } from '../db';
import { webCache } from '../db/schema';
import type { CacheContentType, CachedPage } from './types';

// TTL per content type (in hours)
const TTL_HOURS: Record<CacheContentType, number> = {
  company_page: 168,       // 7 days
  blog_post: 24,
  job_posting: 72,         // 3 days
  press_release: 24,
  social_profile: 168,     // 7 days
  search_result: 24,
};

export class WebFetcher {
  /**
   * Fetch a URL with cache-first resolution.
   * Resolution order:
   *   1. Check web_cache (if not expired)
   *   2. Try Firecrawl MCP (if connected via provider registry)
   *   3. Fall back to built-in fetch + HTML-to-markdown strip
   */
  async fetch(
    url: string,
    contentType: CacheContentType = 'company_page'
  ): Promise<{ content: string; contentType: CacheContentType; fromCache: boolean }> {
    // 1. Check cache
    const now = new Date().toISOString();
    const cached = await db
      .select()
      .from(webCache)
      .where(
        and(
          eq(webCache.url, url),
          gt(webCache.expiresAt, now)
        )
      )
      .limit(1);

    if (cached.length > 0) {
      return {
        content: cached[0].content,
        contentType: cached[0].contentType as CacheContentType,
        fromCache: true,
      };
    }

    // 2. Try Firecrawl MCP (if available)
    let content: string | null = null;
    try {
      content = await this.fetchViaFirecrawl(url);
    } catch {
      // Firecrawl not available or failed — fall through to built-in
    }

    // 3. Fall back to built-in fetch
    if (!content) {
      content = await this.fetchBuiltIn(url);
    }

    // Store in cache
    const ttlHours = TTL_HOURS[contentType] ?? 24;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

    // Upsert: delete old entry if exists, then insert
    await db.delete(webCache).where(eq(webCache.url, url));
    await db.insert(webCache).values({
      id: randomUUID(),
      url,
      content,
      contentType,
      extractedInsights: null,
      fetchedAt: now,
      expiresAt,
    });

    return { content, contentType, fromCache: false };
  }

  /**
   * Try fetching via Firecrawl MCP.
   * Returns null if Firecrawl is not connected.
   */
  private async fetchViaFirecrawl(url: string): Promise<string | null> {
    // Dynamic import to avoid circular dependencies
    const { getRegistry } = await import('../providers/registry');
    const registry = getRegistry();

    // Check if a Firecrawl MCP provider is registered
    const providers = registry.getAll();
    const firecrawl = providers.find(
      p => p.id.includes('firecrawl') && p.type === 'mcp' && p.status === 'active'
    );

    if (!firecrawl) return null;

    // Use MCP client to call Firecrawl's scrape tool
    const { getMCPClient } = await import('../mcp/client');
    const mcpClient = getMCPClient();
    if (!mcpClient) return null;

    try {
      const result = await mcpClient.callTool('firecrawl_scrape', { url });
      // Firecrawl returns markdown content
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch {
      return null;
    }
  }

  /**
   * Built-in fetch: GET the URL, strip HTML to approximate markdown.
   * Uses a simple regex-based strip — no new dependencies.
   */
  private async fetchBuiltIn(url: string): Promise<string> {
    const response = await globalThis.fetch(url, {
      headers: {
        'User-Agent': 'GTM-OS Web Intelligence/1.0',
        'Accept': 'text/html, application/json, text/plain',
      },
      signal: AbortSignal.timeout(15000),    // 15s timeout
    });

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    return this.htmlToMarkdown(html);
  }

  /**
   * Simple regex-based HTML-to-markdown conversion.
   * NOT a full parser — handles the 80% case for extracting readable text.
   */
  private htmlToMarkdown(html: string): string {
    let text = html;

    // Remove script, style, noscript blocks
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

    // Convert headings
    text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
    text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
    text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
    text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');

    // Convert paragraphs and divs to newlines
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/div>/gi, '\n');

    // Convert links
    text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

    // Convert bold and italic
    text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
    text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

    // Convert list items
    text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');

    // Strip all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode common HTML entities
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, ' ');

    // Collapse multiple blank lines
    text = text.replace(/\n{3,}/g, '\n\n');

    // Trim
    text = text.trim();

    // Truncate to 50k chars to avoid blowing up Claude context
    if (text.length > 50000) {
      text = text.substring(0, 50000) + '\n\n[Content truncated at 50,000 characters]';
    }

    return text;
  }
}
```

---

### `src/lib/web/researcher.ts`

The `WebResearcher` class. Uses `WebFetcher` for data retrieval and Claude Sonnet for analysis.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient, MODELS } from '../ai/client';
import { WebFetcher } from './fetcher';
import type {
  WebResearchRequest,
  WebResearchResult,
  WebInsight,
  CacheContentType,
} from './types';

// Map research types to the URLs/pages we should fetch
const RESEARCH_STRATEGIES: Record<string, (identifier: string) => { urls: string[]; contentType: CacheContentType }[]> = {
  company: (domain) => [
    { urls: [`https://${domain}`], contentType: 'company_page' },
    { urls: [`https://${domain}/about`], contentType: 'company_page' },
    { urls: [`https://${domain}/blog`], contentType: 'blog_post' },
    { urls: [`https://${domain}/careers`], contentType: 'job_posting' },
  ],
  person: (name) => [
    // LinkedIn search is unreliable without auth — rely on general web presence
    { urls: [`https://www.google.com/search?q=${encodeURIComponent(name)}`], contentType: 'search_result' },
  ],
  trigger_event: (domain) => [
    { urls: [`https://${domain}/careers`], contentType: 'job_posting' },
    { urls: [`https://${domain}/blog`], contentType: 'blog_post' },
    { urls: [`https://${domain}/press`, `https://${domain}/news`], contentType: 'press_release' },
  ],
  competitor: (domain) => [
    { urls: [`https://${domain}`], contentType: 'company_page' },
    { urls: [`https://${domain}/pricing`], contentType: 'company_page' },
    { urls: [`https://${domain}/features`], contentType: 'company_page' },
  ],
};

export class WebResearcher {
  private fetcher = new WebFetcher();

  /**
   * Research a target entity by fetching relevant web pages and analyzing them with Claude.
   */
  async research(request: WebResearchRequest): Promise<WebResearchResult> {
    const strategy = RESEARCH_STRATEGIES[request.targetType];
    if (!strategy) {
      throw new Error(`Unknown research type: ${request.targetType}`);
    }

    const targets = strategy(request.targetIdentifier);
    const fetchedSources: { url: string; fetchedAt: string }[] = [];
    const allContent: { url: string; content: string }[] = [];
    let anyFromCache = false;

    // Fetch all target URLs (skip failures gracefully)
    for (const target of targets) {
      for (const url of target.urls) {
        try {
          const result = await this.fetcher.fetch(url, target.contentType);
          fetchedSources.push({ url, fetchedAt: new Date().toISOString() });
          allContent.push({ url, content: result.content });
          if (result.fromCache) anyFromCache = true;
        } catch (err) {
          // Skip failed fetches — some pages won't exist (e.g. /press)
          console.warn(`[WebResearcher] Failed to fetch ${url}:`, err);
        }
      }
    }

    if (allContent.length === 0) {
      return {
        insights: [{
          source: request.targetIdentifier,
          content: `Could not fetch any web pages for ${request.targetIdentifier}. The site may be unreachable or blocking automated requests.`,
          relevance: 'low',
          extractedAt: new Date().toISOString(),
        }],
        sources: [],
        fromCache: false,
      };
    }

    // Analyze with Claude Sonnet
    const insights = await this.analyze(request, allContent);

    return {
      insights,
      sources: fetchedSources,
      fromCache: anyFromCache && allContent.length === fetchedSources.length,
    };
  }

  /**
   * Use Claude Sonnet to analyze fetched content and answer research questions.
   */
  private async analyze(
    request: WebResearchRequest,
    content: { url: string; content: string }[]
  ): Promise<WebInsight[]> {
    const client = getAnthropicClient();

    // Build context from fetched pages (truncate each to keep within context window)
    const pageContext = content
      .map(c => {
        const truncated = c.content.length > 15000
          ? c.content.substring(0, 15000) + '\n[truncated]'
          : c.content;
        return `--- Source: ${c.url} ---\n${truncated}`;
      })
      .join('\n\n');

    const questionsFormatted = request.questions
      .map((q, i) => `${i + 1}. ${q}`)
      .join('\n');

    const systemPrompt = `You are a web research analyst for a GTM intelligence system. You analyze web page content to extract structured insights about companies, people, and market signals.

Your responses must be precise, factual, and based only on the provided content. If the content does not contain information to answer a question, say so explicitly — do not speculate.

For each insight you extract, rate its relevance as "high", "medium", or "low" based on how directly it answers the research questions.`;

    const userPrompt = `Research target: ${request.targetType} — "${request.targetIdentifier}"

Questions to answer:
${questionsFormatted}

Web page content:
${pageContext}

Respond with a JSON array of insights. Each insight must have:
- "source": the URL it came from
- "content": the specific finding (1-3 sentences)
- "relevance": "high" | "medium" | "low"

Return ONLY the JSON array, no markdown fences, no commentary.`;

    const response = await client.messages.create({
      model: MODELS.SONNET,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Extract text content from response
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('Not an array');

      return parsed.map((item: any) => ({
        source: item.source ?? request.targetIdentifier,
        content: item.content ?? '',
        relevance: ['high', 'medium', 'low'].includes(item.relevance) ? item.relevance : 'medium',
        extractedAt: new Date().toISOString(),
      }));
    } catch {
      // If Claude didn't return valid JSON, wrap the whole response as a single insight
      return [{
        source: request.targetIdentifier,
        content: text,
        relevance: 'medium' as const,
        extractedAt: new Date().toISOString(),
      }];
    }
  }
}
```

---

### `src/app/api/web/research/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { WebResearcher } from '@/lib/web/researcher';
import type { WebResearchRequest } from '@/lib/web/types';

const researcher = new WebResearcher();

// POST /api/web/research — run web research on a target
export async function POST(req: NextRequest) {
  const body = (await req.json()) as WebResearchRequest;

  if (!body.targetType || !body.targetIdentifier || !body.questions?.length) {
    return NextResponse.json(
      { error: 'Required fields: targetType, targetIdentifier, questions[]' },
      { status: 400 }
    );
  }

  try {
    const result = await researcher.research(body);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? 'Research failed' },
      { status: 500 }
    );
  }
}
```

---

### `src/app/api/web/cache/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { eq, count } from 'drizzle-orm';
import { db } from '@/lib/db';
import { webCache } from '@/lib/db/schema';
import type { CacheContentType } from '@/lib/web/types';

// GET /api/web/cache — cache stats
export async function GET() {
  const rows = await db.select().from(webCache);

  const stats = {
    totalEntries: rows.length,
    byContentType: {} as Record<string, number>,
    oldestEntry: rows.length > 0
      ? rows.reduce((oldest, r) => r.fetchedAt < oldest.fetchedAt ? r : oldest).fetchedAt
      : null,
    newestEntry: rows.length > 0
      ? rows.reduce((newest, r) => r.fetchedAt > newest.fetchedAt ? r : newest).fetchedAt
      : null,
  };

  for (const row of rows) {
    const ct = row.contentType ?? 'unknown';
    stats.byContentType[ct] = (stats.byContentType[ct] ?? 0) + 1;
  }

  return NextResponse.json(stats);
}

// DELETE /api/web/cache — clear cache (all or by contentType)
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contentType = searchParams.get('contentType') as CacheContentType | null;

  if (contentType) {
    await db.delete(webCache).where(eq(webCache.contentType, contentType));
  } else {
    await db.delete(webCache);
  }

  return NextResponse.json({ cleared: true, contentType: contentType ?? 'all' });
}
```

---

## Existing Files to Modify

### `src/lib/db/schema.ts`

**Add** the `web_cache` table:

```ts
export const webCache = sqliteTable('web_cache', {
  id: text('id').primaryKey(),
  url: text('url').notNull().unique(),
  content: text('content').notNull(),
  contentType: text('content_type').notNull(),       // CacheContentType
  extractedInsights: text('extracted_insights'),      // JSON: WebInsight[] | null
  fetchedAt: text('fetched_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});
```

**Add** the `web_research_tasks` table:

```ts
export const webResearchTasks = sqliteTable('web_research_tasks', {
  id: text('id').primaryKey(),
  targetType: text('target_type').notNull(),         // WebResearchType
  targetIdentifier: text('target_identifier').notNull(),
  status: text('status').notNull().default('pending'),
  results: text('results'),                          // JSON: WebResearchResult | null
  requestedBy: text('requested_by').notNull(),       // system or user identifier
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
});
```

Add standalone relations:

```ts
export const webCacheRelations = relations(webCache, () => ({}));
export const webResearchTasksRelations = relations(webResearchTasks, () => ({}));
```

---

## Verification Steps

Run these checks in order. Every one must pass before committing.

1. **Research a company:**
   ```bash
   curl -X POST http://localhost:3000/api/web/research \
     -H 'Content-Type: application/json' \
     -d '{"targetType":"company","targetIdentifier":"stripe.com","questions":["What does this company do?","What is their tech stack?"]}'
   ```
   Returns insights about Stripe (fetched via built-in fetcher since no Firecrawl MCP is connected).

2. **Cache hit:** Run the same request again. Response should have `"fromCache": true` (at least partially). The insights may be re-analyzed but source content comes from cache.

3. **Cache stats:**
   ```bash
   curl http://localhost:3000/api/web/cache
   ```
   Returns `totalEntries > 0` with the Stripe pages listed by content type.

4. **Cache clear:**
   ```bash
   curl -X DELETE http://localhost:3000/api/web/cache
   ```
   Returns `{ "cleared": true, "contentType": "all" }`. Subsequent GET shows 0 entries.

5. **Error handling:** Research a non-existent domain (e.g. `targetIdentifier: "thisdomaindoesnotexist12345.com"`). Should return gracefully with a low-relevance insight explaining the failure, not a 500 error.

6. **`pnpm build`** — production build completes with zero errors and zero TypeScript errors.

---

## Commit Message

```
feat: web intelligence with research + caching (4.7)
```
