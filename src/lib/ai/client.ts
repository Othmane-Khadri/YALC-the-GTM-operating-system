import Anthropic from '@anthropic-ai/sdk'

// Singleton Anthropic client — reused across requests
let _client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Add it to your .env.local file.'
      )
    }
    _client = new Anthropic({ apiKey })
  }
  return _client
}

// Model to use for workflow planning — fast and capable
export const PLANNER_MODEL = 'claude-sonnet-4-6'
// Model to use for deep qualification reasoning
export const QUALIFIER_MODEL = 'claude-opus-4-6'
