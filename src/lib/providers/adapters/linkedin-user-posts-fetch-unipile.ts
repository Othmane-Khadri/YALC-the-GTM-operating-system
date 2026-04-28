import type { CapabilityAdapter } from '../capabilities.js'
import { unipileService } from '../../services/unipile.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface LinkedInUserPostsInput {
  accountId?: string
  userId?: string
  limit?: number
  lookback?: number
  /** Snake-case aliases. */
  account_id?: string
  user_id?: string
}

interface UnipilePostsResponse {
  items?: Record<string, unknown>[]
  cursor?: string
}

/**
 * Unipile linkedin-user-posts-fetch adapter.
 *
 * Wraps `GET /api/v1/users/<user_id>/posts` (which `unipileService.listUserPosts`
 * already implements). When `userId` is omitted the adapter uses the special
 * `me` endpoint via the SDK's profile lookup so the user's own posts are
 * returned — matches `list-recent-linkedin-posts.md` behavior.
 */
export const linkedinUserPostsFetchUnipileAdapter: CapabilityAdapter = {
  capabilityId: 'linkedin-user-posts-fetch',
  providerId: 'unipile',
  isAvailable: () => !!(process.env.UNIPILE_API_KEY && process.env.UNIPILE_DSN),
  async execute(input) {
    if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) {
      throw new MissingApiKeyError('unipile', 'UNIPILE_API_KEY/UNIPILE_DSN')
    }
    const raw = (input ?? {}) as LinkedInUserPostsInput
    const accountId = raw.accountId ?? raw.account_id
    if (!accountId) {
      throw new ProviderApiError('unipile', 'accountId (or account_id) is required')
    }
    const userId = raw.userId ?? raw.user_id ?? 'me'
    const limit = raw.limit ?? raw.lookback ?? 10
    try {
      const data = (await unipileService.listUserPosts(accountId, userId, limit)) as UnipilePostsResponse
      const posts = data.items ?? []
      return { posts, accountId, userId, limit }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('unipile', message)
    }
  },
}
