// ─── Comment Manager ─────────────────────────────────────────────────────────
// Fetch, draft, and send LinkedIn comment replies.

import { unipileService } from '../services/unipile'
import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'
import { validateAndFix } from '../outbound/validator'
import type { VoiceContext } from '../outbound/voice-injector'

export interface NormalizedComment {
  id: string
  text: string
  authorName: string
  authorHeadline: string
  authorProfileUrl: string
  date: string
  isOwnComment: boolean
  hasReply: boolean
  parentCommentId?: string
}

export interface ReplyDraft {
  commentId: string
  authorName: string
  originalText: string
  replyText: string
}

export class CommentManager {
  async getComments(accountId: string, postId: string): Promise<NormalizedComment[]> {
    const raw = await unipileService.listPostComments(accountId, postId, 5)

    // Get post to identify own author
    const post = await unipileService.getPost(accountId, postId) as Record<string, unknown>
    const ownAuthorId = String((post as Record<string, unknown>).author_id ?? '')

    return raw.map((c) => {
      const details = (c.author_details ?? {}) as Record<string, unknown>
      const authorId = String(details.id ?? '')
      const commentId = String(c.id ?? '')

      return {
        id: commentId,
        text: String(c.text ?? ''),
        authorName: typeof c.author === 'string' ? c.author : String(details.name ?? ''),
        authorHeadline: String(details.headline ?? ''),
        authorProfileUrl: String(details.profile_url ?? ''),
        date: String(c.date ?? ''),
        isOwnComment: authorId === ownAuthorId,
        hasReply: false, // simplified — would need nested comment check
        parentCommentId: c.parent_comment_id ? String(c.parent_comment_id) : undefined,
      }
    })
  }

  batchReplyDrafts(
    comments: NormalizedComment[],
    replyTemplate: string,
  ): ReplyDraft[] {
    const unreplied = comments.filter((c) => !c.isOwnComment && !c.hasReply)
    return unreplied.map((c) => ({
      commentId: c.id,
      authorName: c.authorName,
      originalText: c.text,
      replyText: replyTemplate.replace(/\{\{name\}\}/g, c.authorName.split(' ')[0]),
    }))
  }

  async personalizedReplyDrafts(
    comments: NormalizedComment[],
    postContext: string,
    voiceContext?: VoiceContext,
  ): Promise<ReplyDraft[]> {
    const unreplied = comments.filter((c) => !c.isOwnComment && !c.hasReply)
    if (unreplied.length === 0) return []

    const anthropic = getAnthropicClient()

    const voiceBlock = voiceContext
      ? `Tone: ${voiceContext.voice.tone}. Style: ${voiceContext.voice.style}.`
      : 'Be helpful, genuine, and conversational.'

    const prompt = `You are replying to LinkedIn comments on this post:
"${postContext}"

${voiceBlock}

Generate a personalized reply for each comment below. Be genuine, add value, and keep replies concise (1-3 sentences). Never be pushy or salesy.

Comments to reply to:
${unreplied.map((c, i) => `${i + 1}. ${c.authorName}: "${c.text}"`).join('\n')}

Return a JSON array:
[{ "index": 1, "reply": "..." }, ...]
Return ONLY the JSON array.`

    const response = await anthropic.messages.create({
      model: PLANNER_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')

    let replies: Array<{ index: number; reply: string }>
    try {
      const match = text.match(/\[[\s\S]*\]/)
      if (!match) throw new Error('No JSON array')
      replies = JSON.parse(match[0])
    } catch {
      return []
    }

    return replies
      .filter((r) => r.index > 0 && r.index <= unreplied.length)
      .map((r) => {
        const comment = unreplied[r.index - 1]
        const fixed = validateAndFix(r.reply)
        return {
          commentId: comment.id,
          authorName: comment.authorName,
          originalText: comment.text,
          replyText: fixed.text,
        }
      })
  }

  async sendReplies(
    accountId: string,
    postId: string,
    drafts: ReplyDraft[],
    dryRun: boolean,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0
    let failed = 0

    for (const draft of drafts) {
      if (dryRun) {
        console.log(`[dry-run] Reply to ${draft.authorName}: "${draft.replyText}"`)
        sent++
        continue
      }

      try {
        await unipileService.sendComment(accountId, postId, draft.replyText, draft.commentId)
        console.log(`[sent] Reply to ${draft.authorName}`)
        sent++
        // Pause between sends
        await new Promise((r) => setTimeout(r, 2000))
      } catch (err) {
        console.error(`[failed] Reply to ${draft.authorName}: ${err instanceof Error ? err.message : err}`)
        failed++
      }
    }

    return { sent, failed }
  }
}
