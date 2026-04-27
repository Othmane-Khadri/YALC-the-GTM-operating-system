import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability, ProviderHealthStatus } from '../types'
import type { ColumnDef } from '../../ai/types'
import { firecrawlService } from '../../services/firecrawl'
import { SEARCH_COLUMNS } from '../../execution/columns'

export class FirecrawlProvider implements StepExecutor {
  id = 'firecrawl'
  name = 'Firecrawl'
  description = 'Web search and scraping via Firecrawl. Searches the web, scrapes URLs to markdown, and extracts structured data.'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['search', 'enrich']

  isAvailable(): boolean {
    return firecrawlService.isAvailable()
  }

  async selfHealthCheck(): Promise<ProviderHealthStatus> {
    if (!process.env.FIRECRAWL_API_KEY) {
      return { status: 'warn', detail: 'FIRECRAWL_API_KEY not set' }
    }
    try {
      const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'], timeout: 5000 }),
        signal: AbortSignal.timeout(10000),
      })
      if (resp.ok) return { status: 'ok', detail: 'scrape endpoint reachable' }
      if (resp.status === 401) return { status: 'fail', detail: 'API key invalid' }
      if (resp.status === 402) return { status: 'fail', detail: 'credits exhausted' }
      return { status: 'warn', detail: `HTTP ${resp.status}` }
    } catch (err) {
      return {
        status: 'fail',
        detail: `connection failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  canExecute(step: WorkflowStepInput): boolean {
    if (step.provider === 'firecrawl') return true
    // Claim generic search/enrich steps that aren't LinkedIn-specific
    if (step.stepType === 'search' || step.stepType === 'enrich') {
      const query = String(step.config?.query ?? step.description ?? '').toLowerCase()
      const url = String(step.config?.url ?? '').toLowerCase()
      // Don't claim LinkedIn-specific steps
      if (query.includes('linkedin') || url.includes('linkedin.com')) return false
      return true
    }
    return false
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const url = step.config?.url ? String(step.config.url) : ''
    const query = step.config?.query ? String(step.config.query) : step.description

    // If a URL is provided, scrape it
    if (url) {
      const markdown = await firecrawlService.scrape(url)
      let hostname = url
      try { hostname = new URL(url).hostname.replace('www.', '') } catch { /* keep raw url */ }
      const rows: Record<string, unknown>[] = [{
        company_name: hostname,
        website: url,
        description: markdown.slice(0, 2000),
        industry: '',
        location: '',
      }]
      yield { rows, batchIndex: 0, totalSoFar: rows.length }
      return
    }

    // If enriching with previous rows, scrape each row's website (or search by company name)
    if (step.stepType === 'enrich' && context.previousStepRows?.length) {
      const batchSize = context.batchSize || 10
      const rows = context.previousStepRows
      const enrichmentType = String(step.config?.enrichmentType ?? '')
      const isCompanyResearch = enrichmentType === 'company_research'
      let totalSoFar = 0

      for (let i = 0; i < rows.length; i += batchSize) {
        const slice = rows.slice(i, i + batchSize)
        const enriched = await Promise.all(
          slice.map(async (row) => {
            // Skip if already researched (cost guard)
            if (row.company_description) return row

            const site = String(row.website ?? row.company_website ?? '')
            const companyName = String(row.company ?? row.company_name ?? '')

            try {
              if (site) {
                const content = await firecrawlService.scrape(site)
                return isCompanyResearch
                  ? { ...row, company_description: content.slice(0, 2000), company_research_source: site }
                  : { ...row, scraped_content: content.slice(0, 2000) }
              }
              if (isCompanyResearch && companyName) {
                const results = await firecrawlService.search(companyName, 1)
                if (results.length > 0) {
                  return {
                    ...row,
                    company_description: results[0].content.slice(0, 2000),
                    company_research_source: results[0].url,
                  }
                }
              }
              return row
            } catch {
              return row
            }
          }),
        )
        totalSoFar += enriched.length
        yield { rows: enriched, batchIndex: Math.floor(i / batchSize), totalSoFar }
      }
      return
    }

    // Default: web search
    const results = await firecrawlService.search(query, context.totalRequested || 25)
    const rows = results.map((r) => ({
      company_name: r.title,
      website: r.url,
      description: r.content.slice(0, 500),
      industry: '',
      employee_count: '',
      location: '',
    }))

    if (rows.length === 0) {
      yield { rows: [], batchIndex: 0, totalSoFar: 0 }
      return
    }

    const batchSize = context.batchSize || 10
    let totalSoFar = 0
    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize)
      totalSoFar += slice.length
      yield { rows: slice, batchIndex: Math.floor(i / batchSize), totalSoFar }
    }
  }

  getColumnDefinitions(step: WorkflowStepInput): ColumnDef[] {
    const enrichmentType = String(step.config?.enrichmentType ?? '')
    if (enrichmentType === 'company_research') {
      return [
        ...SEARCH_COLUMNS,
        { key: 'company_description', label: 'Company Description', type: 'text' },
        { key: 'company_research_source', label: 'Research Source', type: 'url' },
      ]
    }
    return SEARCH_COLUMNS
  }
}
