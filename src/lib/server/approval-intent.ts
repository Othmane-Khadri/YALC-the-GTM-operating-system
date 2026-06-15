/**
 * Approval intent classifier (S3 extension).
 *
 * Classifies a short Slack thread reply as `approve`, `reject`, or `unknown`.
 * Two classifiers ship out of the box:
 *
 *   - `makeRuleBasedClassifier()` runs a small regex pass and returns instantly.
 *     It also matches the legacy `/yalc approve` and `/yalc cancel` commands so
 *     the fast path still covers literal operator syntax.
 *   - `makeLlmClassifier(client)` asks Claude Haiku to produce a single word
 *     verdict. Used as a fallback when rules cannot decide.
 *
 * `makeChainedClassifier(...)` runs classifiers in order, returning the first
 * non-`unknown` verdict. This lets the resolver consult the LLM only when the
 * rule pass is ambiguous, keeping the common case (literal commands, "yes",
 * "go", "cancel") free of network calls.
 */

import type Anthropic from '@anthropic-ai/sdk'

export type ApprovalIntent = 'approve' | 'reject' | 'unknown'

export interface IntentClassifierInput {
  text: string
  runId?: string
}

export interface IntentClassifier {
  classify(input: IntentClassifierInput): Promise<ApprovalIntent>
}

const APPROVE_RE =
  /\b(approve|approved|ship|go|yes|yep|yeah|lgtm|sounds good|looks good|perfect|fire away|let'?s do it|do it|send it|push it)\b/i
const REJECT_RE =
  /\b(cancel|cancelled|canceled|abort|no thanks|nope|let'?s not|hold off|stop|don'?t|skip)\b/i

const LITERAL_APPROVE_RE = /^\s*\/yalc\s+approve(?:\s+\S+)?\s*$/i
const LITERAL_CANCEL_RE = /^\s*\/yalc\s+cancel(?:\s+\S+)?\s*$/i

/** Fast regex pass. Returns `unknown` when neither pattern matches. */
export function makeRuleBasedClassifier(): IntentClassifier {
  return {
    async classify({ text }) {
      if (LITERAL_APPROVE_RE.test(text)) return 'approve'
      if (LITERAL_CANCEL_RE.test(text)) return 'reject'

      const approveHit = APPROVE_RE.test(text)
      const rejectHit = REJECT_RE.test(text)

      // A reply that hits both signals (e.g. "ship it but cancel the email")
      // is treated as ambiguous so the LLM can break the tie.
      if (approveHit && rejectHit) return 'unknown'
      if (approveHit) return 'approve'
      if (rejectHit) return 'reject'
      return 'unknown'
    },
  }
}

const LLM_SYSTEM_PROMPT =
  'You are an intent classifier for Slack thread replies on a pending approval. ' +
  'Read the reply and decide whether the operator is approving the action, rejecting it, ' +
  'or being unclear. Reply with exactly one lowercase word: approve, reject, or unknown. ' +
  'Do not add punctuation or extra words.'

const LLM_MODEL = 'claude-haiku-4-5'

/** Anthropic-backed classifier. Uses Haiku-class model with a tiny prompt. */
export function makeLlmClassifier(client: Anthropic): IntentClassifier {
  return {
    async classify({ text }) {
      try {
        const response = await client.messages.create({
          model: LLM_MODEL,
          max_tokens: 4,
          system: LLM_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: text }],
        })
        const block = response.content[0]
        if (!block || block.type !== 'text') return 'unknown'
        const verdict = block.text.trim().toLowerCase()
        if (verdict.startsWith('approve')) return 'approve'
        if (verdict.startsWith('reject')) return 'reject'
        return 'unknown'
      } catch {
        // LLM is best-effort. Network failure must not break approval flow.
        return 'unknown'
      }
    },
  }
}

/**
 * Run classifiers in order. Return the first non-`unknown` verdict; otherwise
 * `unknown`. Empty input always classifies as `unknown` without calling any
 * inner classifier.
 */
export function makeChainedClassifier(...classifiers: IntentClassifier[]): IntentClassifier {
  return {
    async classify(input) {
      if (!input.text || !input.text.trim()) return 'unknown'
      for (const c of classifiers) {
        const verdict = await c.classify(input)
        if (verdict !== 'unknown') return verdict
      }
      return 'unknown'
    },
  }
}
