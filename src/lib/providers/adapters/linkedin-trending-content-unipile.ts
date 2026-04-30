import type { CapabilityAdapter } from '../capabilities.js'
import { unipileService } from '../../services/unipile.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface LinkedInTrendingInput {
  accountId?: string
  keyword?: string
  /** Minimum total reactions+comments to consider a post "high-engagement". */
  minEngagement?: number
  limit?: number
  /** Snake-case aliases. */
  account_id?: string
  min_engagement?: number
}

/**
 * Unipile linkedin-trending-content adapter.
 *
 * Searches LinkedIn for posts matching `keyword` and filters down to those
 * above a minimum engagement floor (likes + comments). Backs the
 * `linkedin-trending-content` skill used by the content-calendar-builder
 * archetype to mine high-performing examples.
 *
 * Unipile's `searchLinkedIn` returns mixed people / posts results; this
 * adapter assumes the underlying endpoint surfaces post-shaped records
 * with `engagement.likes` + `engagement.comments` (as both v1 and v2 of
 * the LinkedIn search API do).
 */
export const linkedinTrendingContentUnipileAdapter: CapabilityAdapter = {
  capabilityId: 'linkedin-trending-content',
  providerId: 'unipile',
  isAvailable: () => !!(process.env.UNIPILE_API_KEY && process.env.UNIPILE_DSN),
  async execute(input) {
    if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) {
      throw new MissingApiKeyError('unipile', 'UNIPILE_API_KEY/UNIPILE_DSN')
    }
    const raw = (input ?? {}) as LinkedInTrendingInput
    const accountId = raw.accountId ?? raw.account_id
    const keyword = raw.keyword ?? ''
    if (!accountId) {
      throw new ProviderApiError('unipile', 'accountId (or account_id) is required')
    }
    if (!keyword.trim()) {
      throw new ProviderApiError('unipile', 'keyword is required')
    }
    const minEngagement = raw.minEngagement ?? raw.min_engagement ?? 50
    const limit = raw.limit ?? 25

    try {
      const items = await unipileService.searchLinkedIn(accountId, keyword, limit)
      const posts = items
        .map((it) => normalizeTrendingPost(it))
        .filter((p): p is TrendingPost => p !== null)
        .filter((p) => p.engagement.total >= minEngagement)
        .sort((a, b) => b.engagement.total - a.engagement.total)
      return { posts, keyword, minEngagement, limit, accountId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('unipile', message)
    }
  },
}

interface TrendingPost {
  post_id: string
  url: string | null
  text_excerpt: string
  engagement: { likes: number; comments: number; total: number }
  raw: Record<string, unknown>
}

function normalizeTrendingPost(raw: Record<string, unknown>): TrendingPost | null {
  const id =
    (raw.post_id as string | undefined) ??
    (raw.id as string | undefined) ??
    (raw.urn as string | undefined)
  if (!id) return null
  const engagementRaw = (raw.engagement ?? {}) as Record<string, unknown>
  const likes = num(engagementRaw.likes ?? engagementRaw.reactions ?? raw.likes)
  const comments = num(engagementRaw.comments ?? raw.comments)
  const text =
    (raw.text_excerpt as string | undefined) ??
    (raw.text as string | undefined) ??
    (raw.commentary as string | undefined) ??
    ''
  return {
    post_id: id,
    url: (raw.url as string | undefined) ?? null,
    text_excerpt: text.slice(0, 500),
    engagement: { likes, comments, total: likes + comments },
    raw,
  }
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}
