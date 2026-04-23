/**
 * CLI Error Boundary
 *
 * A universal error handler for CLI commands that catches unhandled errors
 * and outputs user-friendly messages instead of stack traces.
 *
 * Uses the existing error classification from diagnostics/error-handler.ts
 * to provide contextual error messages and fix suggestions.
 */

import { classifyError } from '../diagnostics/error-handler'

// ─── Verbose Mode ─────────────────────────────────────────────────────────────

let _verbose = false

export function setVerbose(value: boolean): void {
  _verbose = value
}

export function isVerbose(): boolean {
  return _verbose || !!process.env.DEBUG || !!process.env.GTM_OS_DEBUG
}

// ─── Provider Error Formatting ────────────────────────────────────────────────

const PROVIDER_ERROR_PATTERNS: Array<{
  test: (msg: string) => boolean
  format: (msg: string) => string
}> = [
  {
    test: (msg) => msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND'),
    format: (msg) => {
      const host = msg.match(/(?:ECONNREFUSED|ENOTFOUND)\s+(\S+)/)?.[1] ?? 'unknown'
      const provider = identifyProvider(msg)
      return `${provider}: unreachable (${host}). Check API key or network.`
    },
  },
  {
    test: (msg) => msg.includes('ETIMEDOUT') || msg.includes('timeout'),
    format: (msg) => {
      const provider = identifyProvider(msg)
      return `${provider}: request timed out. Retry or check network.`
    },
  },
  {
    test: (msg) => /\b401\b/.test(msg) || msg.includes('Unauthorized'),
    format: (msg) => {
      const provider = identifyProvider(msg)
      return `${provider}: authentication failed (401). Check your API key.`
    },
  },
  {
    test: (msg) => /\b403\b/.test(msg) || msg.includes('Forbidden'),
    format: (msg) => {
      const provider = identifyProvider(msg)
      return `${provider}: access denied (403). Check permissions.`
    },
  },
  {
    test: (msg) => /\b429\b/.test(msg) || msg.includes('Rate limit'),
    format: (msg) => {
      const provider = identifyProvider(msg)
      return `${provider}: rate limited (429). Wait 60s and retry.`
    },
  },
]

function identifyProvider(msg: string): string {
  const lmsg = msg.toLowerCase()
  if (lmsg.includes('anthropic') || lmsg.includes('claude')) return 'Anthropic'
  if (lmsg.includes('unipile')) return 'Unipile'
  if (lmsg.includes('firecrawl')) return 'Firecrawl'
  if (lmsg.includes('notion')) return 'Notion'
  if (lmsg.includes('crustdata')) return 'Crustdata'
  if (lmsg.includes('fullenrich')) return 'FullEnrich'
  if (lmsg.includes('instantly')) return 'Instantly'
  // Try to extract from URL
  const urlMatch = msg.match(/https?:\/\/([^/\s:]+)/)
  if (urlMatch) return urlMatch[1].split('.')[0]
  return 'Provider'
}

// ─── Format Error ─────────────────────────────────────────────────────────────

export function formatError(error: Error): string {
  const msg = error.message + (error.stack ?? '')

  // Try classified diagnostic first
  const diagnostic = classifyError(error)
  if (diagnostic) {
    // The withDiagnostics handler already formats these; return null to let it through
    return ''
  }

  // Try provider-specific one-liner
  for (const pattern of PROVIDER_ERROR_PATTERNS) {
    if (pattern.test(msg)) {
      return `\n  \u2717 ${pattern.format(msg)}\n`
    }
  }

  // Generic one-liner
  return `\n  Error: ${error.message}\n`
}

// ─── Global Error Boundary ────────────────────────────────────────────────────

/**
 * Install a global uncaught exception + unhandled rejection handler
 * that formats errors cleanly. Call once at CLI startup.
 */
export function installGlobalErrorBoundary(): void {
  process.on('uncaughtException', (error) => {
    handleFatalError(error)
  })

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    handleFatalError(error)
  })
}

function handleFatalError(error: Error): void {
  // Claude Code redirects: print friendly guidance, exit 0 (not 1).
  if ((error as { isClaudeCodeRedirect?: boolean }).isClaudeCodeRedirect) {
    console.error('')
    console.error(`  ${error.message.replace(/\n/g, '\n  ')}`)
    console.error('')
    process.exit(0)
  }

  const formatted = formatError(error)

  if (formatted) {
    console.error(formatted)
  } else {
    // Falls through to the diagnostic handler's own formatting
    console.error(`\n  Error: ${error.message}\n`)
  }

  if (isVerbose()) {
    console.error('Stack trace:')
    console.error(error.stack)
  } else {
    console.error('  Tip: re-run with --verbose for full stack trace')
    console.error('  Or:  gtm-os doctor — for a full system health check\n')
  }

  process.exit(1)
}

/**
 * Wraps a Commander action handler with the error boundary.
 * This is a lighter-weight alternative to withDiagnostics that
 * doesn't do error classification — it just catches + formats.
 *
 * For commands that are already wrapped with withDiagnostics,
 * this is NOT needed. Use this for commands that currently have
 * bare async handlers.
 */
export function withErrorBoundary<T extends (...args: any[]) => Promise<void>>(
  action: T
): (...args: Parameters<T>) => Promise<void> {
  return async (...args: Parameters<T>) => {
    try {
      await action(...args)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      handleFatalError(err)
    }
  }
}
