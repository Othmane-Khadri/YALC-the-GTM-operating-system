import Anthropic from '@anthropic-ai/sdk'
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk'
import { isClaudeCode } from '../env/claude-code.js'

/**
 * Thrown when an LLM-heavy code path is reached without ANTHROPIC_API_KEY
 * AND the process is running inside a parent Claude Code session.
 *
 * The CLI error boundary catches this specifically and exits 0 with a
 * friendly message — no stack trace — so users can either set a key or
 * reformulate the request as a Claude Code prompt.
 */
export class ClaudeCodeRedirectError extends Error {
  readonly isClaudeCodeRedirect = true as const

  constructor(message: string) {
    super(message)
    this.name = 'ClaudeCodeRedirectError'
  }
}

// ponytail: Bedrock wins when its bearer token is present — avoids per-token
// Anthropic API billing when the user already has unmetered Bedrock access.
const USE_BEDROCK = !!process.env.AWS_BEARER_TOKEN_BEDROCK

// Singleton client — reused across requests
let _client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    if (USE_BEDROCK) {
      // ponytail: AnthropicBedrock is a runtime-compatible drop-in for the
      // same messages.create() surface — cast avoids fragmenting every call
      // site's type inference across two near-identical client unions.
      _client = new AnthropicBedrock() as unknown as Anthropic
      return _client
    }
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      if (isClaudeCode()) {
        throw new ClaudeCodeRedirectError(
          'This command needs an LLM. Two options:\n' +
          '  1. Add ANTHROPIC_API_KEY (or AWS_BEARER_TOKEN_BEDROCK) to ~/.gtm-os/.env (or .env.local in your project) and re-run.\n' +
          '  2. Reformulate this request as a prompt to your parent Claude Code session.\n' +
          '     Example: instead of `yalc-gtm orchestrate "..."`, ask Claude Code\n' +
          '     to plan the workflow and then run the deterministic CLI steps\n' +
          '     (leads:import, campaign:create --title/--hypothesis, notion:sync, ...).'
        )
      }
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Add it to your .env.local file (or set AWS_BEARER_TOKEN_BEDROCK to use Bedrock instead).'
      )
    }
    _client = new Anthropic({ apiKey })
  }
  return _client
}

// Model to use for workflow planning — fast and capable
export const PLANNER_MODEL = USE_BEDROCK ? 'us.anthropic.claude-sonnet-4-6' : 'claude-sonnet-4-6'
// Model to use for deep qualification reasoning
export const QUALIFIER_MODEL = USE_BEDROCK ? 'us.anthropic.claude-opus-4-6-v1' : 'claude-opus-4-6'
// Model to use for lightweight/cheap tasks (haiku)
export const FAST_MODEL = USE_BEDROCK ? 'us.anthropic.claude-haiku-4-5-20251001-v1:0' : 'claude-haiku-4-5-20251001'
