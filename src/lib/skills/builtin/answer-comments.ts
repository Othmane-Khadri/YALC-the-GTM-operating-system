import type { Skill, SkillEvent, SkillContext } from '../types'

export const answerCommentsSkill: Skill = {
  id: 'answer-comments',
  name: 'Answer LinkedIn Comments',
  version: '1.0.0',
  description:
    'Monitor and reply to LinkedIn post comments. Lead Magnet mode sends a template reply; General mode generates personalized AI replies.',
  category: 'outreach',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'LinkedIn post URL' },
      mode: {
        type: 'string',
        enum: ['lead-magnet', 'general'],
        description: 'Reply mode',
        default: 'general',
      },
      replyTemplate: {
        type: 'string',
        description: 'Template for lead-magnet mode (use {{name}} for first name)',
      },
      maxReplies: { type: 'number', description: 'Max replies to send', default: 50 },
      dryRun: { type: 'boolean', description: 'Preview without sending', default: true },
    },
    required: ['url'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      sent: { type: 'number' },
      failed: { type: 'number' },
      drafts: { type: 'array', items: { type: 'object' } },
    },
  },
  requiredCapabilities: ['unipile'],

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const {
      url,
      mode = 'general',
      replyTemplate,
      maxReplies = 50,
      dryRun = true,
    } = input as {
      url: string
      mode?: 'lead-magnet' | 'general'
      replyTemplate?: string
      maxReplies?: number
      dryRun?: boolean
    }

    yield { type: 'progress', message: 'Resolving LinkedIn post...', percent: 5 }

    // Get LinkedIn account
    const { unipileService } = await import('../../services/unipile')
    const accounts = await unipileService.getAccounts()
    const accountList = (accounts as { items?: Record<string, unknown>[] }).items ?? []
    const linkedinAccount = accountList.find(
      (a: Record<string, unknown>) => String(a.type ?? '').toLowerCase() === 'linkedin',
    )
    if (!linkedinAccount) {
      yield { type: 'error', message: 'No LinkedIn account connected in Unipile.' }
      return
    }
    const accountId = String(linkedinAccount.id)

    // Extract post ID
    const activityMatch = url.match(/activity[/-](\d+)/)
    const ugcMatch = url.match(/urn:li:ugcPost:(\d+)/)
    const postId = activityMatch?.[1] ?? (ugcMatch ? `urn:li:ugcPost:${ugcMatch[1]}` : null)
    if (!postId) {
      yield { type: 'error', message: `Cannot extract activity ID from URL: ${url}` }
      return
    }

    // Resolve post
    const post = await unipileService.getPost(accountId, postId) as Record<string, unknown>
    const socialId = String(post.social_id ?? post.id ?? postId)
    const postText = String(post.text ?? '').slice(0, 200)

    yield { type: 'progress', message: `Post: "${postText}..."`, percent: 15 }

    // Fetch comments
    const { CommentManager } = await import('../../linkedin/comment-manager')
    const manager = new CommentManager()
    const comments = await manager.getComments(accountId, socialId)
    const unreplied = comments.filter((c) => !c.isOwnComment && !c.hasReply)

    yield {
      type: 'progress',
      message: `Found ${comments.length} comments, ${unreplied.length} unreplied`,
      percent: 30,
    }

    if (unreplied.length === 0) {
      yield { type: 'result', data: { sent: 0, failed: 0, drafts: [] } }
      yield { type: 'progress', message: 'No unreplied comments found.', percent: 100 }
      return
    }

    // Generate drafts
    const limited = unreplied.slice(0, maxReplies)
    let drafts

    if (mode === 'lead-magnet') {
      const template = replyTemplate ?? 'Hello {{name}}, thanks for engaging! Check the link in the post description.'
      drafts = manager.batchReplyDrafts(limited, template)
      yield { type: 'progress', message: `Generated ${drafts.length} batch replies`, percent: 50 }
    } else {
      const voiceCtx = await (async () => {
        try {
          const { getVoiceContext } = await import('../../outbound/voice-injector')
          return await getVoiceContext()
        } catch {
          return undefined
        }
      })()

      drafts = await manager.personalizedReplyDrafts(limited, postText, voiceCtx ?? undefined)
      yield { type: 'progress', message: `Generated ${drafts.length} personalized replies`, percent: 50 }
    }

    // Show drafts for approval
    yield {
      type: 'approval_needed',
      title: `${drafts.length} comment replies ready`,
      description: drafts.map((d) => `→ ${d.authorName}: "${d.replyText}"`).join('\n'),
      payload: { drafts, dryRun },
    }

    // Send replies
    yield { type: 'progress', message: dryRun ? 'Dry run — previewing...' : 'Sending replies...', percent: 60 }
    const result = await manager.sendReplies(accountId, socialId, drafts, dryRun)

    yield {
      type: 'result',
      data: { sent: result.sent, failed: result.failed, drafts },
    }

    yield {
      type: 'progress',
      message: `Done: ${result.sent} sent, ${result.failed} failed${dryRun ? ' (dry run)' : ''}`,
      percent: 100,
    }
  },
}
