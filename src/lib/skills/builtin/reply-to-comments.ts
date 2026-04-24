import type { Skill, SkillEvent, SkillContext } from '../types'

/**
 * Reply-to-Comments Skill
 *
 * Sends threaded replies to LinkedIn post comments via Unipile API.
 * Uses the `comment_id` field (NOT `reply_to_comment_id`) to ensure
 * replies are nested under the original comment, not posted as
 * top-level comments.
 *
 * Unipile API contract (POST /api/v1/posts/{post_id}/comments):
 *   - account_id: string (required)
 *   - text: string (required)
 *   - comment_id: string (required for threaded reply)
 *
 * If comment_id is omitted, the API posts a top-level comment.
 * This skill ALWAYS includes comment_id — it refuses to send without one.
 */

interface CommentTarget {
  commentId: string
  authorName: string
  originalText: string
  replyText: string
}

export const replyToCommentsSkill: Skill = {
  id: 'reply-to-comments',
  name: 'Reply to LinkedIn Comments',
  version: '1.0.0',
  description:
    'Send threaded replies to LinkedIn post comments. Always replies UNDER the original comment (never top-level). Supports template with {{name}} interpolation and exclude list.',
  category: 'outreach',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'LinkedIn post URL' },
      template: { type: 'string', description: 'Reply text. Use {{name}} for first name.' },
      exclude: {
        type: 'array',
        items: { type: 'string' },
        description: 'Author names to skip (partial match, case-insensitive)',
      },
      includeKeywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only reply to comments containing any of these keywords (case-insensitive)',
      },
      templates: {
        type: 'array',
        items: { type: 'string' },
        description: 'Multiple reply templates to rotate through (alternative to single template)',
      },
      maxReplies: { type: 'number', description: 'Max replies to send', default: 100 },
      dryRun: { type: 'boolean', description: 'Preview without sending', default: true },
    },
    required: ['url'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      sent: { type: 'number' },
      failed: { type: 'number' },
      skipped: { type: 'number' },
      replies: { type: 'array', items: { type: 'object' } },
    },
  },
  requiredCapabilities: ['unipile'],

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const {
      url,
      template,
      templates,
      exclude = [],
      includeKeywords,
      maxReplies = 100,
      dryRun = true,
    } = input as {
      url: string
      template?: string
      templates?: string[]
      exclude?: string[]
      includeKeywords?: string[]
      maxReplies?: number
      dryRun?: boolean
    }

    // Build template list: either explicit templates array or single template
    const templateList = templates?.length ? templates : template ? [template] : []
    if (templateList.length === 0) {
      yield { type: 'error', message: 'Provide either --template or --templates.' }
      return
    }

    // ── Step 1: Resolve LinkedIn account ──────────────────────────────────
    yield { type: 'progress', message: 'Connecting to LinkedIn...', percent: 5 }

    const dsn = process.env.UNIPILE_DSN
    const apiKey = process.env.UNIPILE_API_KEY
    if (!dsn || !apiKey) {
      yield { type: 'error', message: 'UNIPILE_DSN and UNIPILE_API_KEY must be set.' }
      return
    }
    // Normalize DSN: strip trailing slash, ensure no double https
    const baseUrl = dsn.replace(/\/+$/, '')

    const accountsRes = await fetch(`${baseUrl}/api/v1/accounts`, {
      headers: { 'X-API-KEY': apiKey },
    })
    if (!accountsRes.ok) {
      yield { type: 'error', message: `Failed to fetch accounts: ${accountsRes.status}` }
      return
    }
    const accountsData = (await accountsRes.json()) as { items?: Array<{ id: string; type: string }> }
    const linkedinAccount = (accountsData.items ?? []).find(
      (a) => a.type?.toLowerCase() === 'linkedin',
    )
    if (!linkedinAccount) {
      yield { type: 'error', message: 'No LinkedIn account connected in Unipile.' }
      return
    }
    const accountId = linkedinAccount.id

    // ── Step 2: Resolve post via Unipile service ──────────────────────────
    yield { type: 'progress', message: 'Resolving post...', percent: 10 }

    const { unipileService } = await import('../../services/unipile')

    const activityMatch = url.match(/activity[/:-](\d+)/)
    const shareMatch = url.match(/share[/:-](\d+)/)
    const ugcMatch = url.match(/urn:li:ugcPost:(\d+)/)

    let post: Record<string, unknown>
    let socialId: string

    if (activityMatch) {
      // Direct activity ID — resolve via getPost
      const postId = activityMatch[1]
      try {
        post = (await unipileService.getPost(accountId, postId)) as Record<string, unknown>
      } catch (err) {
        yield { type: 'error', message: `Failed to resolve post: ${err instanceof Error ? err.message : err}` }
        return
      }
      socialId = String(post.social_id ?? post.id ?? postId)
    } else if (ugcMatch) {
      const postId = `urn:li:ugcPost:${ugcMatch[1]}`
      try {
        post = (await unipileService.getPost(accountId, postId)) as Record<string, unknown>
      } catch (err) {
        yield { type: 'error', message: `Failed to resolve post: ${err instanceof Error ? err.message : err}` }
        return
      }
      socialId = String(post.social_id ?? post.id ?? postId)
    } else if (shareMatch) {
      // Share URLs use a different ID than activity — must match via recent posts
      yield { type: 'progress', message: 'Share URL detected, scanning recent posts...', percent: 12 }

      // Extract the slug prefix from the URL (format: posts/username_slug-share-id-hash)
      const slugMatch = url.match(/posts\/[^_]+_(.+?)-(?:share|activity)-\d+/)
      const slug = slugMatch?.[1]?.toLowerCase() ?? ''

      const ownProviderId = 'ACoAADrBZegB0cqWsSrghWwl1nFOzsh_goKAL7w'
      const recentRes = (await unipileService.listUserPosts(accountId, ownProviderId, 10)) as Record<string, unknown>
      const recentPosts: Record<string, unknown>[] = (recentRes.posts as Record<string, unknown>[])
        ?? (recentRes.items as Record<string, unknown>[])
        ?? (Array.isArray(recentRes) ? recentRes : [])

      // Match by slug text in share_url or post text
      const matched = recentPosts.find((p) => {
        if (slug) {
          const shareUrl = String(p.share_url ?? '').toLowerCase()
          if (shareUrl.includes(slug)) return true
        }
        // Fallback: match first 50 chars of post text against slug words
        const postText = String(p.text ?? '').toLowerCase()
        const slugWords = slug.split('-').filter((w) => w.length > 3)
        return slugWords.length >= 3 && slugWords.every((w) => postText.includes(w))
      })

      if (!matched) {
        yield { type: 'error', message: `Could not find post matching slug "${slug}" in recent ${recentPosts.length} posts. Try using the activity URL format.` }
        return
      }

      post = matched
      socialId = String(post.social_id ?? post.id)
    } else {
      yield { type: 'error', message: `Cannot extract activity/share ID from URL: ${url}` }
      return
    }
    const postText = String(post.text ?? '').slice(0, 120)

    yield { type: 'progress', message: `Post: "${postText}..."`, percent: 15 }

    // ── Step 3: Fetch all comments via Unipile service (SDK) ────────────
    yield { type: 'progress', message: 'Fetching comments...', percent: 20 }

    const allComments = await unipileService.listPostComments(accountId, socialId, 20)

    // ── Step 4: Filter comments ───────────────────────────────────────────
    // Identify own comments (posted by connected account)
    const ownAuthorId = String(
      (post as Record<string, unknown>).author_id ??
      ((post as Record<string, unknown>).author as Record<string, unknown>)?.id ?? '',
    )

    const excludeLower = exclude.map((n) => n.toLowerCase())

    const targets: CommentTarget[] = []
    let skipped = 0

    for (const c of allComments) {
      const authorDetails = (c.author_details ?? {}) as Record<string, unknown>
      const authorId = String(authorDetails.id ?? '')
      const authorName = String(c.author ?? authorDetails.name ?? '')
      const commentId = String(c.id ?? '')
      const commentText = String(c.text ?? '')

      // Skip own comments
      if (authorId === ownAuthorId || authorName.toLowerCase().includes('othmane')) {
        skipped++
        continue
      }

      // Skip comments that already have replies (we likely already answered)
      const replyCount = Number(c.reply_counter ?? 0)
      if (replyCount > 0) {
        skipped++
        continue
      }

      // Skip excluded names
      if (excludeLower.some((ex) => authorName.toLowerCase().includes(ex))) {
        skipped++
        continue
      }

      // Skip comments that already contain our resource (already replied)
      if (commentText.includes('sdr-replacement-system')) {
        skipped++
        continue
      }

      // Keyword include filter: only reply to comments matching any keyword
      if (includeKeywords?.length) {
        const textLower = commentText.toLowerCase()
        if (!includeKeywords.some((kw) => textLower.includes(kw.toLowerCase()))) {
          skipped++
          continue
        }
      }

      // HARD REQUIREMENT: comment_id must exist
      if (!commentId || commentId === 'undefined' || commentId === 'null') {
        console.error(`[skip] No comment_id for ${authorName} — cannot thread reply`)
        skipped++
        continue
      }

      const firstName = authorName.split(' ')[0]
      // Rotate through templates round-robin
      const selectedTemplate = templateList[targets.length % templateList.length]
      const replyText = selectedTemplate.replace(/\{\{name\}\}/g, firstName)

      targets.push({ commentId, authorName, originalText: commentText, replyText })
    }

    const limited = targets.slice(0, maxReplies)

    yield {
      type: 'progress',
      message: `${allComments.length} comments found, ${limited.length} to reply, ${skipped} skipped`,
      percent: 40,
    }

    if (limited.length === 0) {
      yield { type: 'result', data: { sent: 0, failed: 0, skipped, replies: [] } }
      return
    }

    // ── Step 5: Send threaded replies ─────────────────────────────────────
    yield {
      type: 'progress',
      message: dryRun ? 'Dry run — previewing...' : `Sending ${limited.length} threaded replies...`,
      percent: 50,
    }

    let sent = 0
    let failed = 0
    const replies: CommentTarget[] = []

    for (const target of limited) {
      if (dryRun) {
        console.log(`[dry-run] Reply to ${target.authorName}: "${target.replyText}"`)
        sent++
        replies.push(target)
        continue
      }

      // ── CRITICAL: Always send with comment_id for threaded reply ──
      // Unipile API: POST /api/v1/posts/{social_id}/comments
      // Body: { account_id, text, comment_id }
      // comment_id = the comment we're replying TO (threads it underneath)
      // Without comment_id, it becomes a top-level comment (WRONG)
      const sendUrl = `${baseUrl}/api/v1/posts/${socialId}/comments`
      const body = {
        account_id: accountId,
        text: target.replyText,
        comment_id: target.commentId, // ← MUST be comment_id, NOT reply_to_comment_id
      }

      try {
        const res = await fetch(sendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const errText = await res.text()
          console.error(`[failed] ${target.authorName}: ${res.status} — ${errText}`)
          failed++
          continue
        }

        console.log(`[sent] Reply to ${target.authorName} (comment_id: ${target.commentId})`)
        sent++
        replies.push(target)

        // Rate limit: 2 seconds between sends
        await new Promise((r) => setTimeout(r, 2000))
      } catch (err) {
        console.error(`[failed] ${target.authorName}: ${err instanceof Error ? err.message : err}`)
        failed++
      }
    }

    yield {
      type: 'result',
      data: { sent, failed, skipped, replies },
    }

    yield {
      type: 'progress',
      message: `Done: ${sent} sent, ${failed} failed, ${skipped} skipped${dryRun ? ' (dry run)' : ''}`,
      percent: 100,
    }
  },
}
