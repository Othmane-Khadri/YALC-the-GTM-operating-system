import type { CapabilityAdapter } from '../capabilities.js'
import { unipileService } from '../../services/unipile.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface LinkedInContentFetchInput {
  accountId?: string
  competitorUrl?: string
  /** Optional explicit user id; otherwise resolved from `competitorUrl`. */
  userId?: string
  limit?: number
  /** Snake-case aliases. */
  account_id?: string
  competitor_url?: string
  user_id?: string
}

interface UnipilePostsResponse {
  items?: Record<string, unknown>[]
  cursor?: string
}

/**
 * Unipile linkedin-content-fetch adapter.
 *
 * Fetches recent posts authored by a given competitor's LinkedIn URL
 * (or explicit `userId`). Used by `monitor-competitor-content` to surface
 * what a tracked competitor is publishing this week.
 *
 * The adapter resolves a LinkedIn URL into a Unipile-friendly identifier
 * via `unipileService.getProfile()` when only `competitorUrl` is given,
 * then delegates to the existing `listUserPosts()` SDK call so the
 * underlying request shape stays identical to `list-recent-linkedin-posts`.
 */
export const linkedinContentFetchUnipileAdapter: CapabilityAdapter = {
  capabilityId: 'linkedin-content-fetch',
  providerId: 'unipile',
  isAvailable: () => !!(process.env.UNIPILE_API_KEY && process.env.UNIPILE_DSN),
  async execute(input) {
    if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) {
      throw new MissingApiKeyError('unipile', 'UNIPILE_API_KEY/UNIPILE_DSN')
    }
    const raw = (input ?? {}) as LinkedInContentFetchInput
    const accountId = raw.accountId ?? raw.account_id
    if (!accountId) {
      throw new ProviderApiError('unipile', 'accountId (or account_id) is required')
    }
    const competitorUrl = raw.competitorUrl ?? raw.competitor_url
    let userId = raw.userId ?? raw.user_id
    if (!userId && !competitorUrl) {
      throw new ProviderApiError('unipile', 'userId or competitorUrl is required')
    }
    const limit = raw.limit ?? 10

    try {
      if (!userId && competitorUrl) {
        // Strip the LinkedIn URL down to the slug Unipile expects.
        const slug = extractLinkedInSlug(competitorUrl)
        const profile = (await unipileService.getProfile(accountId, slug)) as Record<string, unknown>
        userId = (profile.provider_id as string | undefined) ?? slug
      }
      const data = (await unipileService.listUserPosts(accountId, userId!, limit)) as UnipilePostsResponse
      const posts = data.items ?? []
      return { posts, accountId, competitorUrl: competitorUrl ?? null, userId, limit }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('unipile', message)
    }
  },
}

/** Extract a usable LinkedIn slug from a `linkedin.com/in/<slug>/` style URL. */
export function extractLinkedInSlug(url: string): string {
  const trimmed = url.trim().replace(/\/$/, '')
  const m = trimmed.match(/linkedin\.com\/(?:in|company|school)\/([^/?#]+)/i)
  return m ? m[1] : trimmed
}
