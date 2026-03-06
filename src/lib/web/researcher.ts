import Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'
import { WebFetcher } from './fetcher'
import type {
  WebResearchRequest,
  WebResearchResult,
  WebInsight,
  CacheContentType,
} from './types'

const RESEARCH_STRATEGIES: Record<string, (identifier: string) => { urls: string[]; contentType: CacheContentType }[]> = {
  company: (domain) => [
    { urls: [`https://${domain}`], contentType: 'company_page' },
    { urls: [`https://${domain}/about`], contentType: 'company_page' },
    { urls: [`https://${domain}/blog`], contentType: 'blog_post' },
    { urls: [`https://${domain}/careers`], contentType: 'job_posting' },
  ],
  person: (name) => [
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
}

export class WebResearcher {
  private fetcher = new WebFetcher()

  async research(request: WebResearchRequest): Promise<WebResearchResult> {
    const strategy = RESEARCH_STRATEGIES[request.targetType]
    if (!strategy) {
      throw new Error(`Unknown research type: ${request.targetType}`)
    }

    const targets = strategy(request.targetIdentifier)
    const fetchedSources: { url: string; fetchedAt: string }[] = []
    const allContent: { url: string; content: string }[] = []
    let anyFromCache = false

    for (const target of targets) {
      for (const url of target.urls) {
        try {
          const result = await this.fetcher.fetch(url, target.contentType)
          fetchedSources.push({ url, fetchedAt: new Date().toISOString() })
          allContent.push({ url, content: result.content })
          if (result.fromCache) anyFromCache = true
        } catch {
          // Skip failed fetches
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
      }
    }

    const insights = await this.analyze(request, allContent)

    return {
      insights,
      sources: fetchedSources,
      fromCache: anyFromCache && allContent.length === fetchedSources.length,
    }
  }

  private async analyze(
    request: WebResearchRequest,
    content: { url: string; content: string }[]
  ): Promise<WebInsight[]> {
    const client = getAnthropicClient()

    const pageContext = content
      .map(c => {
        const truncated = c.content.length > 15000
          ? c.content.substring(0, 15000) + '\n[truncated]'
          : c.content
        return `--- Source: ${c.url} ---\n${truncated}`
      })
      .join('\n\n')

    const questionsFormatted = request.questions
      .map((q, i) => `${i + 1}. ${q}`)
      .join('\n')

    const systemPrompt = `You are a web research analyst for a GTM intelligence system. You analyze web page content to extract structured insights about companies, people, and market signals.

Your responses must be precise, factual, and based only on the provided content. If the content does not contain information to answer a question, say so explicitly — do not speculate.

For each insight you extract, rate its relevance as "high", "medium", or "low" based on how directly it answers the research questions.`

    const userPrompt = `Research target: ${request.targetType} — "${request.targetIdentifier}"

Questions to answer:
${questionsFormatted}

Web page content:
${pageContext}

Respond with a JSON array of insights. Each insight must have:
- "source": the URL it came from
- "content": the specific finding (1-3 sentences)
- "relevance": "high" | "medium" | "low"

Return ONLY the JSON array, no markdown fences, no commentary.`

    const response = await client.messages.create({
      model: PLANNER_MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('')

    try {
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) throw new Error('Not an array')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return parsed.map((item: any) => ({
        source: item.source ?? request.targetIdentifier,
        content: item.content ?? '',
        relevance: ['high', 'medium', 'low'].includes(item.relevance) ? item.relevance : 'medium',
        extractedAt: new Date().toISOString(),
      }))
    } catch {
      return [{
        source: request.targetIdentifier,
        content: text,
        relevance: 'medium' as const,
        extractedAt: new Date().toISOString(),
      }]
    }
  }
}
