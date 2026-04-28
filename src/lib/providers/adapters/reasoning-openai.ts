import type { CapabilityAdapter } from '../capabilities.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface ReasoningInput {
  prompt: string
  maxTokens?: number
  model?: string
}

const OPENAI_BASE_URL = process.env.OPENAI_API_BASE ?? 'https://api.openai.com'
const DEFAULT_MODEL = 'gpt-4o-mini'

/**
 * OpenAI reasoning adapter — talks to the Chat Completions endpoint
 * directly via fetch so we don't pull in another vendor SDK.
 */
export const reasoningOpenAIAdapter: CapabilityAdapter = {
  capabilityId: 'reasoning',
  providerId: 'openai',
  isAvailable: () => !!process.env.OPENAI_API_KEY,
  async execute(input) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new MissingApiKeyError('openai', 'OPENAI_API_KEY')
    }
    const { prompt, maxTokens, model } = (input ?? {}) as ReasoningInput
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new ProviderApiError('openai', 'reasoning input requires a non-empty `prompt` string')
    }
    let res: Response
    try {
      res = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model ?? DEFAULT_MODEL,
          max_tokens: maxTokens ?? 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('openai', `network error: ${message}`)
    }
    if (!res.ok) {
      const text = await res.text()
      throw new ProviderApiError('openai', `chat/completions failed: ${text}`, res.status)
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const text = data.choices?.[0]?.message?.content ?? ''
    return { text }
  },
}
