/**
 * Detection helpers for running inside a parent Claude Code session.
 *
 * When YALC is invoked from Claude Code, the parent already provides LLM
 * reasoning and a built-in WebFetch tool, so prompting for ANTHROPIC_API_KEY
 * or FIRECRAWL_API_KEY in onboarding adds friction with no payoff.
 *
 * These env markers are set by Claude Code itself when it spawns child
 * processes; we never set them ourselves.
 */

export const CLAUDE_CODE_ENV_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
] as const

export function isClaudeCode(): boolean {
  for (const marker of CLAUDE_CODE_ENV_MARKERS) {
    if (process.env[marker]) return true
  }
  return false
}

export type WebFetchProvider = 'firecrawl' | 'claude-code' | 'none'

/**
 * Resolve the effective web-fetch provider based on env + WEB_FETCH_PROVIDER.
 *
 * - `firecrawl`: Firecrawl key present (whether explicitly chosen or auto-detected).
 * - `claude-code`: running inside CC and no Firecrawl key — single-URL scrapes
 *   should be delegated to the parent's WebFetch tool with a `--input <file>`
 *   handoff.
 * - `none`: no web-fetch capability available.
 */
export function getWebFetchProvider(): WebFetchProvider {
  const choice = (process.env.WEB_FETCH_PROVIDER ?? 'auto').toLowerCase()
  const hasFirecrawl = !!process.env.FIRECRAWL_API_KEY

  if (choice === 'firecrawl') return hasFirecrawl ? 'firecrawl' : 'none'
  if (choice === 'claude-code') return isClaudeCode() ? 'claude-code' : 'none'

  // auto
  if (hasFirecrawl) return 'firecrawl'
  if (isClaudeCode()) return 'claude-code'
  return 'none'
}
