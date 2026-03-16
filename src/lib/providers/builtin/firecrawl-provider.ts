import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'
import { firecrawlService } from '@/lib/services/firecrawl'
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
      const rows: Record<string, unknown>[] = [{
        company_name: new URL(url).hostname.replace('www.', ''),
        website: url,
        description: markdown.slice(0, 2000),
        industry: '',
        location: '',
      }]
      yield { rows, batchIndex: 0, totalSoFar: rows.length }
      return
    }

    // If enriching with previous rows, scrape each row's website
    if (step.stepType === 'enrich' && context.previousStepRows?.length) {
      const batchSize = context.batchSize || 10
      const rows = context.previousStepRows
      let totalSoFar = 0

      for (let i = 0; i < rows.length; i += batchSize) {
        const slice = rows.slice(i, i + batchSize)
        const enriched = await Promise.all(
          slice.map(async (row) => {
            const site = String(row.website ?? '')
            if (!site) return row
            try {
              const content = await firecrawlService.scrape(site)
              return { ...row, scraped_content: content.slice(0, 2000) }
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

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    return SEARCH_COLUMNS
  }
}
