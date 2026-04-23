/**
 * GTM-OS CLI Error Handler
 *
 * Wraps CLI command actions with structured error catching.
 * When a command fails, classifies the error by layer and prints
 * a human-readable diagnostic with a suggested fix.
 *
 * Works without Claude Code — any user running the CLI directly gets
 * actionable error messages instead of raw stack traces.
 */

import { existsSync } from 'fs'

// ─── Error Classification ────────────────────────────────────────────────────

type DiagnosticLayer = 'environment' | 'database' | 'configuration' | 'provider' | 'runtime'

interface Diagnostic {
  layer: DiagnosticLayer
  code: string
  title: string
  cause: string
  fix: string
  docs?: string
}

// ─── Error Pattern Matchers ──────────────────────────────────────────────────

const ERROR_PATTERNS: Array<{
  test: (msg: string, err: Error) => boolean
  diagnostic: () => Diagnostic
}> = [
  // Layer 1: Environment
  {
    test: (msg) => msg.includes('ANTHROPIC_API_KEY') && (msg.includes('must be set') || msg.includes('401')),
    diagnostic: () => ({
      layer: 'environment',
      code: 'ENV_001',
      title: 'Missing Anthropic API key',
      cause: 'ANTHROPIC_API_KEY is not set in your .env.local file.',
      fix: '1. Get your key at https://console.anthropic.com/settings/keys\n   2. Add it to .env.local: ANTHROPIC_API_KEY=sk-ant-...',
    }),
  },
  {
    test: (msg) => msg.includes('UNIPILE_DSN') && msg.includes('UNIPILE_API_KEY'),
    diagnostic: () => ({
      layer: 'environment',
      code: 'ENV_002',
      title: 'Missing Unipile credentials',
      cause: 'Both UNIPILE_API_KEY and UNIPILE_DSN are required for LinkedIn operations.',
      fix: '1. Get both values from your Unipile dashboard\n   2. Add to .env.local:\n      UNIPILE_API_KEY=your-key\n      UNIPILE_DSN=https://api{N}.unipile.com:{PORT}',
    }),
  },
  {
    test: (msg) => (msg.includes('ECONNREFUSED') || msg.includes('getaddrinfo ENOTFOUND')) && (msg.includes('unipile') || !!process.env.UNIPILE_DSN),
    diagnostic: () => ({
      layer: 'environment',
      code: 'ENV_003',
      title: 'Invalid Unipile DSN',
      cause: `The Unipile DSN is unreachable. Current value: ${maskValue(process.env.UNIPILE_DSN)}`,
      fix: 'Unipile DSNs can rotate. Check your Unipile dashboard for the current DSN.\n   Format: https://api{N}.unipile.com:{PORT} (no trailing slash)',
    }),
  },
  {
    test: (msg) => msg.includes('ENCRYPTION_KEY') && msg.includes('must be set'),
    diagnostic: () => ({
      layer: 'environment',
      code: 'ENV_004',
      title: 'Missing encryption key',
      cause: 'ENCRYPTION_KEY is required to store and retrieve API connections securely.',
      fix: '1. Generate a key: openssl rand -hex 32\n   2. Add to .env.local: ENCRYPTION_KEY=your-generated-key',
    }),
  },
  {
    test: (msg) => msg.includes('ENOENT') && msg.includes('.env.local'),
    diagnostic: () => ({
      layer: 'environment',
      code: 'ENV_005',
      title: 'Missing .env.local file',
      cause: 'No .env.local file found. This file holds your API keys.',
      fix: '1. Copy the example: cp .env.example .env.local\n   2. Fill in your API keys\n   3. Run: gtm-os setup',
    }),
  },

  // Layer 2: Database
  {
    test: (msg) => msg.includes('SQLITE_CANTOPEN') || (msg.includes('unable to open') && msg.includes('database')),
    diagnostic: () => ({
      layer: 'database',
      code: 'DB_001',
      title: 'Database file not found',
      cause: 'The SQLite database file doesn\'t exist or the path is not writable.',
      fix: 'Run: pnpm db:push\n   This creates the database and applies the schema.',
    }),
  },
  {
    test: (msg) => msg.includes('SQLITE_ERROR') && msg.includes('no such table'),
    diagnostic: () => {
      const tableMatch = msg.match(/no such table:\s*(\w+)/)
      const table = tableMatch?.[1] ?? 'unknown'
      return {
        layer: 'database',
        code: 'DB_002',
        title: `Missing database table: ${table}`,
        cause: 'The database exists but is missing tables. Migrations may not have been applied.',
        fix: 'Run: pnpm db:push\n   This applies the full schema without losing existing data.',
      }
    },
  },
  {
    test: (msg) => msg.includes('SQLITE_BUSY') || msg.includes('database is locked'),
    diagnostic: () => ({
      layer: 'database',
      code: 'DB_006',
      title: 'Database locked',
      cause: 'Another process is holding a write lock on the database.',
      fix: '1. Close other GTM-OS processes (check: lsof gtm-os.db)\n   2. If no other process, enable WAL mode:\n      sqlite3 gtm-os.db "PRAGMA journal_mode=WAL;"',
    }),
  },

  // Layer 3: Configuration
  {
    test: (msg) => msg.includes('No framework found') || (msg.includes('ENOENT') && msg.includes('gtm-os.yaml')),
    diagnostic: () => ({
      layer: 'configuration',
      code: 'CFG_001',
      title: 'Missing GTM framework',
      cause: 'gtm-os.yaml not found. This file defines your company identity, ICP, and messaging.',
      fix: 'Run: gtm-os onboard\n   This walks you through 5 questions to set up your framework.',
    }),
  },
  {
    test: (msg) => msg.includes('YAMLException'),
    diagnostic: () => ({
      layer: 'configuration',
      code: 'CFG_002',
      title: 'Invalid YAML syntax',
      cause: 'Your configuration file has a YAML syntax error.',
      fix: 'Check the error location above. Common issues:\n   - Incorrect indentation (use spaces, not tabs)\n   - Missing colon after key names\n   - Unquoted special characters',
    }),
  },
  {
    test: (msg) => msg.includes('Config not loaded') || (msg.includes('ENOENT') && msg.includes('config.yaml')),
    diagnostic: () => ({
      layer: 'configuration',
      code: 'CFG_004',
      title: 'Missing user config',
      cause: 'No config file found at ~/.gtm-os/config.yaml',
      fix: 'Run: gtm-os setup\n   This creates the config file with sensible defaults.',
    }),
  },

  // Layer 4: Provider
  {
    test: (msg) => msg.includes('No LinkedIn account connected') || msg.includes('account not found'),
    diagnostic: () => ({
      layer: 'provider',
      code: 'PRV_001',
      title: 'No LinkedIn account in Unipile',
      cause: 'Unipile API is working but no LinkedIn account has been connected.',
      fix: 'Go to your Unipile dashboard and connect your LinkedIn account.',
    }),
  },
  {
    test: (msg) => (msg.includes('401') || msg.includes('Unauthorized')) && msg.includes('firecrawl'),
    diagnostic: () => ({
      layer: 'provider',
      code: 'PRV_003',
      title: 'Firecrawl API key invalid',
      cause: 'The Firecrawl API returned 401 Unauthorized. Your key may be expired.',
      fix: 'Get a new key at https://firecrawl.dev/app/api-keys and update FIRECRAWL_API_KEY in .env.local',
    }),
  },
  {
    test: (msg) => msg.includes('Insufficient permissions') && msg.includes('notion'),
    diagnostic: () => ({
      layer: 'provider',
      code: 'PRV_004',
      title: 'Notion permissions issue',
      cause: 'Your Notion integration doesn\'t have access to the target database.',
      fix: 'Open the Notion database → click "..." → "Add connections" → select your GTM-OS integration.',
    }),
  },
  {
    test: (msg) => msg.includes('ProviderNotFoundError'),
    diagnostic: () => ({
      layer: 'provider',
      code: 'PRV_006',
      title: 'Unknown provider',
      cause: 'The workflow referenced a provider that doesn\'t exist.',
      fix: 'Check the error message for suggestions. Available providers: mock, qualify, firecrawl, unipile, notion, crustdata, fullenrich, instantly, orthogonal.\n   Fallback: re-run with --provider orthogonal --api <slug> --path <endpoint> to route via the Orthogonal universal gateway (pay-per-call). Requires ORTHOGONAL_API_KEY.',
    }),
  },
  {
    test: (msg) => msg.includes('Rate limit exceeded') || msg.includes('429'),
    diagnostic: () => ({
      layer: 'provider',
      code: 'PRV_007',
      title: 'Rate limit exceeded',
      cause: 'You\'ve hit the API rate limit for this provider.',
      fix: 'Wait 60 seconds and try again. Rate limits reset daily.\n   Check current state: gtm-os doctor',
    }),
  },

  // Layer 5: Runtime
  {
    test: (msg) => msg.includes('body is too large') || msg.includes('Request body too large'),
    diagnostic: () => ({
      layer: 'runtime',
      code: 'RT_001',
      title: 'Notion batch too large',
      cause: 'Notion rejects batches larger than 40 pages per request.',
      fix: 'If this is a custom operation, reduce your batch size to 40 pages maximum.',
    }),
  },
  {
    test: (msg) => msg.includes('Invalid encrypted format') || msg.includes('bad decrypt'),
    diagnostic: () => ({
      layer: 'runtime',
      code: 'RT_002',
      title: 'Encryption key mismatch',
      cause: 'The ENCRYPTION_KEY doesn\'t match the one used to encrypt stored API connections.',
      fix: '1. If you have the original key, restore it in .env.local\n   2. Otherwise, clear stored connections and re-add them:\n      sqlite3 gtm-os.db "DELETE FROM api_connections;"',
    }),
  },
  {
    test: (msg) => msg.includes('SQLITE_CONSTRAINT') && msg.includes('FOREIGN KEY'),
    diagnostic: () => ({
      layer: 'database',
      code: 'DB_005',
      title: 'Foreign key constraint violation',
      cause: 'Attempted to reference a record that doesn\'t exist.',
      fix: 'This usually means stale data. Re-run the parent operation first.\n   Run: gtm-os doctor — to check database integrity.',
    }),
  },
]

// ─── Message Formatting ──────────────────────────────────────────────────────

const LAYER_ICONS: Record<DiagnosticLayer, string> = {
  environment: 'ENV',
  database: 'DB',
  configuration: 'CFG',
  provider: 'API',
  runtime: 'RT',
}

function maskValue(value: string | undefined): string {
  if (!value) return '(not set)'
  if (value.length <= 8) return '***'
  return value.slice(0, 6) + '...' + value.slice(-4)
}

function formatDiagnostic(diagnostic: Diagnostic, originalError: string): string {
  const lines: string[] = []
  lines.push('')
  lines.push(`  ┌─ [${LAYER_ICONS[diagnostic.layer]}] ${diagnostic.code}: ${diagnostic.title}`)
  lines.push(`  │`)
  lines.push(`  │  Cause: ${diagnostic.cause}`)
  lines.push(`  │`)
  lines.push(`  │  Fix:`)
  for (const fixLine of diagnostic.fix.split('\n')) {
    lines.push(`  │    ${fixLine.trim()}`)
  }
  lines.push(`  │`)
  lines.push(`  │  For a full system check, run: gtm-os doctor`)
  lines.push(`  └──────────────────────────────────────────────`)
  lines.push('')
  return lines.join('\n')
}

// ─── Classify Error ──────────────────────────────────────────────────────────

let msg = '' // hoisted for closure access in pattern matchers

export function classifyError(error: Error): Diagnostic | null {
  msg = error.message + (error.stack ?? '')
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(msg, error)) {
      return pattern.diagnostic()
    }
  }
  return null
}

// ─── Public: Wrap CLI Action ─────────────────────────────────────────────────

/**
 * Wraps a Commander action handler with structured error diagnostics.
 * When the action throws, it classifies the error and prints a helpful message.
 *
 * Usage:
 *   .action(withDiagnostics(async (opts) => { ... }))
 */
export function withDiagnostics<T extends (...args: any[]) => Promise<void>>(
  action: T
): (...args: Parameters<T>) => Promise<void> {
  return async (...args: Parameters<T>) => {
    try {
      await action(...args)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      // Claude Code redirects are an expected, friendly exit — not a failure.
      // Print the message verbatim and exit 0 so parent CC sessions don't
      // treat the spawn as broken.
      if ((err as { isClaudeCodeRedirect?: boolean }).isClaudeCodeRedirect) {
        console.error('')
        console.error(`  ${err.message.replace(/\n/g, '\n  ')}`)
        console.error('')
        process.exit(0)
      }

      const diagnostic = classifyError(err)

      if (diagnostic) {
        // Structured diagnostic output
        console.error(formatDiagnostic(diagnostic, err.message))
      } else {
        // Unclassified error — show raw error with doctor suggestion
        console.error('')
        console.error(`  Error: ${err.message}`)
        console.error('')
        console.error(`  This error isn't in the known issues catalog.`)
        console.error(`  Try: gtm-os doctor — for a full system health check`)
        console.error(`  Or:  gtm-os doctor --report — to generate a diagnostic report`)
        console.error('')

        // Show stack trace in debug/verbose mode
        if (process.env.DEBUG || process.env.GTM_OS_DEBUG || process.env.GTM_OS_VERBOSE) {
          console.error('Stack trace:')
          console.error(err.stack)
        } else {
          console.error(`  Tip: re-run with --verbose for full stack trace`)
        }
      }

      process.exit(1)
    }
  }
}
