import { readFileSync } from 'fs'
import type { ReviewRequest, ReviewType, ReviewPriority } from './types'

/**
 * A ReviewAdapter loads data into the ReviewQueue from an external source.
 * Implement this to plug in your own lead pipeline, CRM export, or JSON files.
 */
export interface ReviewAdapter {
  id: string
  name: string
  /** Load items to review. Returns everything except id/status/createdAt (set by ReviewQueue). */
  load(): Promise<Omit<ReviewRequest, 'id' | 'status' | 'createdAt'>[]>
}

/**
 * Built-in adapter: reads a JSON file containing an array of leads.
 *
 * Expected JSON structure (flexible):
 * ```json
 * {
 *   "leads": [{ "name": "...", "score": 95, ... }]
 * }
 * ```
 * Or a flat array: `[{ "name": "...", "score": 95, ... }]`
 *
 * Each lead becomes a ReviewRequest with the full lead object as payload.
 */
export class JsonFileReviewAdapter implements ReviewAdapter {
  id = 'json-file'
  name = 'JSON File'

  constructor(
    private filePath: string,
    private options: {
      /** JSON path to the array (e.g., 'qualified', 'leads'). If omitted, expects root array. */
      arrayKey?: string
      /** Filter function applied before loading */
      filter?: (item: Record<string, unknown>) => boolean
      /** Review type assigned to each item */
      reviewType?: ReviewType
      /** Function to extract a title from each item */
      titleFn?: (item: Record<string, unknown>) => string
      /** Function to extract a description from each item */
      descriptionFn?: (item: Record<string, unknown>) => string
      /** Function to determine priority from each item */
      priorityFn?: (item: Record<string, unknown>) => ReviewPriority
    } = {},
  ) {}

  async load(): Promise<Omit<ReviewRequest, 'id' | 'status' | 'createdAt'>[]> {
    const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'))

    let items: Record<string, unknown>[]
    if (this.options.arrayKey) {
      items = raw[this.options.arrayKey]
    } else if (Array.isArray(raw)) {
      items = raw
    } else {
      // Try common keys
      items = raw.leads ?? raw.qualified ?? raw.items ?? raw.data ?? []
    }

    if (this.options.filter) {
      items = items.filter(this.options.filter)
    }

    const reviewType = this.options.reviewType ?? 'lead_qualification'
    const titleFn = this.options.titleFn ?? ((item) => String(item.name ?? item.title ?? 'Untitled'))
    const descriptionFn =
      this.options.descriptionFn ??
      ((item) => {
        const parts = [item.headline, item.company, item.title].filter(Boolean)
        return parts.length > 0 ? parts.join(' — ') : ''
      })
    const priorityFn =
      this.options.priorityFn ??
      ((item) => {
        const score = Number(item.score ?? 50)
        if (score >= 95) return 'high' as const
        if (score >= 80) return 'normal' as const
        return 'low' as const
      })

    return items.map((item) => ({
      type: reviewType,
      title: titleFn(item),
      description: String(descriptionFn(item)),
      sourceSystem: 'json-file',
      sourceId: String(item.profile_url ?? item.id ?? item.url ?? ''),
      priority: priorityFn(item),
      payload: item,
      action: null,
      nudgeEvidence: null,
      reviewedAt: null,
      reviewNotes: null,
      expiresAt: null,
    }))
  }
}
