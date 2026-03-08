import type { ColumnDef, ColumnType } from '@/lib/ai/types'
import type { ProposedStep } from '@/lib/ai/types'

// Default columns for search steps
export const SEARCH_COLUMNS: ColumnDef[] = [
  { key: 'company_name', label: 'Company Name', type: 'text' },
  { key: 'website', label: 'Website', type: 'url' },
  { key: 'industry', label: 'Industry', type: 'badge' },
  { key: 'employee_count', label: 'Employees', type: 'number' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'description', label: 'Description', type: 'text' },
]

// Provider-specific search columns (falls back to SEARCH_COLUMNS if not mapped)
export const SEARCH_COLUMNS_BY_PROVIDER: Record<string, ColumnDef[]> = {
  'apify-leads': [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'title', label: 'Job Title', type: 'text' },
    { key: 'company', label: 'Company', type: 'text' },
    { key: 'linkedin_url', label: 'LinkedIn', type: 'url' },
    { key: 'industry', label: 'Industry', type: 'badge' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'company_size', label: 'Company Size', type: 'text' },
  ],
}

// Enrichment columns by provider
export const ENRICH_COLUMNS: Record<string, ColumnDef[]> = {
  apollo: [
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'linkedin_url', label: 'LinkedIn', type: 'url' },
    { key: 'title', label: 'Title', type: 'text' },
  ],
  firecrawl: [
    { key: 'tech_stack', label: 'Tech Stack', type: 'badge' },
    { key: 'seo_score', label: 'SEO Score', type: 'score' },
  ],
  builtwith: [
    { key: 'technologies', label: 'Technologies', type: 'badge' },
    { key: 'cms', label: 'CMS', type: 'badge' },
  ],
  hunter: [
    { key: 'email_verified', label: 'Email Verified', type: 'badge' },
    { key: 'confidence', label: 'Confidence', type: 'score' },
  ],
  'apify-leads': [
    { key: 'email', label: 'Email', type: 'text' as ColumnType },
    { key: 'linkedin_url', label: 'LinkedIn', type: 'url' as ColumnType },
    { key: 'title', label: 'Job Title', type: 'text' as ColumnType },
  ],
  'apify-linkedin-engagement': [
    { key: 'headline', label: 'Headline', type: 'text' as ColumnType },
    { key: 'reaction_type', label: 'Reaction', type: 'badge' as ColumnType },
    { key: 'comment_text', label: 'Comment', type: 'text' as ColumnType },
  ],
}

// Qualify columns
export const QUALIFY_COLUMNS: ColumnDef[] = [
  { key: 'icp_score', label: 'ICP Score', type: 'score' },
  { key: 'qualification_reason', label: 'Qualification Reason', type: 'text' },
]

export function buildColumnsFromSteps(steps: ProposedStep[]): ColumnDef[] {
  const seen = new Set<string>()
  const columns: ColumnDef[] = []

  function addColumns(defs: ColumnDef[]) {
    for (const col of defs) {
      if (!seen.has(col.key)) {
        seen.add(col.key)
        columns.push(col)
      }
    }
  }

  for (const step of steps) {
    switch (step.stepType) {
      case 'search':
        addColumns(SEARCH_COLUMNS_BY_PROVIDER[step.provider] ?? SEARCH_COLUMNS)
        break
      case 'enrich':
        addColumns(ENRICH_COLUMNS[step.provider] ?? [])
        break
      case 'qualify':
        addColumns(QUALIFY_COLUMNS)
        break
      case 'filter':
        // Filter doesn't add columns — it reduces rows
        break
      case 'export':
        // Export doesn't add columns
        break
    }
  }

  return columns
}

export function getColumnTypeWidth(type: ColumnType): string {
  switch (type) {
    case 'text': return 'min-w-[180px]'
    case 'number': return 'min-w-[100px]'
    case 'url': return 'min-w-[200px]'
    case 'badge': return 'min-w-[120px]'
    case 'score': return 'min-w-[120px]'
  }
}
