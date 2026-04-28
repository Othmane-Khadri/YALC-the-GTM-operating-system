import type { CapabilityAdapter } from '../capabilities.js'
import { MissingApiKeyError, ProviderApiError } from './index.js'

interface ReasoningInput {
  prompt: string
  maxTokens?: number
  model?: string
}

export const reasoningAnthropicAdapter: CapabilityAdapter = {
  capabilityId: 'reasoning',
  providerId: 'anthropic',
  isAvailable: () => !!process.env.ANTHROPIC_API_KEY,
  async execute(input) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new MissingApiKeyError('anthropic', 'ANTHROPIC_API_KEY')
    }
    const { prompt, maxTokens, model } = (input ?? {}) as ReasoningInput
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new ProviderApiError('anthropic', 'reasoning input requires a non-empty `prompt` string')
    }
    const { getAnthropicClient, PLANNER_MODEL } = await import('../../ai/client.js')
    const client = getAnthropicClient()
    try {
      const res = await client.messages.create({
        model: model ?? PLANNER_MODEL,
        max_tokens: maxTokens ?? 4096,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = res.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('')
      return { text }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('anthropic', message)
    }
  },
}
