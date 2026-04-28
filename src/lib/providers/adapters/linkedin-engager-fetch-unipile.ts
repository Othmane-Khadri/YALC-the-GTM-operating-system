import type { CapabilityAdapter } from '../capabilities.js'
import { unipileService } from '../../services/unipile.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface LinkedInEngagerInput {
  accountId: string
  postId: string
  engagementTypes?: Array<'reaction' | 'comment'>
}

interface Engager {
  type: 'reaction' | 'comment'
  raw: Record<string, unknown>
}

export const linkedinEngagerFetchUnipileAdapter: CapabilityAdapter = {
  capabilityId: 'linkedin-engager-fetch',
  providerId: 'unipile',
  async execute(input) {
    if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) {
      throw new MissingApiKeyError('unipile', 'UNIPILE_API_KEY/UNIPILE_DSN')
    }
    const { accountId, postId, engagementTypes } = (input ?? {}) as LinkedInEngagerInput
    if (!accountId || !postId) {
      throw new ProviderApiError('unipile', 'accountId and postId are required')
    }
    const types = engagementTypes && engagementTypes.length > 0 ? engagementTypes : ['reaction', 'comment']
    const engagers: Engager[] = []
    try {
      if (types.includes('reaction')) {
        const reactions = await unipileService.listPostReactions(accountId, postId)
        for (const r of reactions) engagers.push({ type: 'reaction', raw: r })
      }
      if (types.includes('comment')) {
        const comments = await unipileService.listPostComments(accountId, postId)
        for (const c of comments) engagers.push({ type: 'comment', raw: c })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('unipile', message)
    }
    return { engagers }
  },
}
