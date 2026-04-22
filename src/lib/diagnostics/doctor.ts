/**
 * GTM-OS Doctor
 *
 * Proactive health check that runs through all 5 diagnostic layers.
 * Like `brew doctor` — users run `gtm-os doctor` to validate their setup
 * before anything breaks.
 *
 * Optionally generates a diagnostic report file for bug reports.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { execSync } from 'child_process'
import yaml from 'js-yaml'

// ─── Types ───────────────────────────────────────────────────────────────────

type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip'

interface CheckResult {
  name: string
  status: CheckStatus
  detail: string
}

interface LayerResult {
  layer: string
  checks: CheckResult[]
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const STATUS_ICON: Record<CheckStatus, string> = {
  pass: 'OK',
  fail: 'FAIL',
  warn: 'WARN',
  skip: 'SKIP',
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function printCheck(check: CheckResult): void {
  const icon = STATUS_ICON[check.status]
  const prefix = check.status === 'fail' ? '  ✗' : check.status === 'warn' ? '  !' : '  ✓'
  console.log(`${prefix} [${pad(icon, 4)}] ${check.name}`)
  if (check.status !== 'pass') {
    console.log(`           ${check.detail}`)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskEnvValue(value: string | undefined): string {
  if (!value) return '(not set)'
  if (value.length <= 8) return '***'
  return value.slice(0, 4) + '...' + value.slice(-3)
}

function readEnvFile(): Map<string, string> {
  const envMap = new Map<string, string>()
  const envPath = join(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return envMap
  const content = readFileSync(envPath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    envMap.set(trimmed.slice(0, eqIdx), trimmed.slice(eqIdx + 1))
  }
  return envMap
}

function getDbPath(): string {
  const envVars = readEnvFile()
  const dbUrl = envVars.get('DATABASE_URL') ?? process.env.DATABASE_URL ?? 'file:./gtm-os.db'
  let dbPath = dbUrl.replace(/^file:/, '').replace(/^\.\//, '')
  if (!dbPath.startsWith('/')) {
    dbPath = join(process.cwd(), dbPath)
  }
  return dbPath
}

function runSqlite(dbPath: string, query: string): string | null {
  try {
    return execSync(`sqlite3 "${dbPath}" "${query}"`, { encoding: 'utf-8', timeout: 5000 }).trim()
  } catch {
    return null
  }
}

// ─── Layer 1: Environment ────────────────────────────────────────────────────

function checkEnvironment(): LayerResult {
  const checks: CheckResult[] = []
  const envPath = join(process.cwd(), '.env.local')

  // .env.local exists
  if (!existsSync(envPath)) {
    checks.push({
      name: '.env.local file',
      status: 'fail',
      detail: 'File missing. Run: cp .env.example .env.local',
    })
    return { layer: 'Environment', checks }
  }
  checks.push({ name: '.env.local file', status: 'pass', detail: '' })

  const envVars = readEnvFile()

  // Required vars
  const required = ['ANTHROPIC_API_KEY']
  for (const key of required) {
    const val = envVars.get(key) ?? process.env[key]
    if (val && val.trim()) {
      checks.push({ name: key, status: 'pass', detail: '' })
    } else {
      checks.push({ name: key, status: 'fail', detail: `Missing. Required for AI operations.` })
    }
  }

  // Encryption key
  const encKey = envVars.get('ENCRYPTION_KEY') ?? process.env.ENCRYPTION_KEY
  if (encKey && encKey.trim()) {
    checks.push({ name: 'ENCRYPTION_KEY', status: 'pass', detail: '' })
  } else {
    checks.push({ name: 'ENCRYPTION_KEY', status: 'warn', detail: 'Missing. API key storage won\'t work. Generate: openssl rand -hex 32' })
  }

  // Unipile pair check
  const uKey = envVars.get('UNIPILE_API_KEY') ?? process.env.UNIPILE_API_KEY
  const uDsn = envVars.get('UNIPILE_DSN') ?? process.env.UNIPILE_DSN
  if (uKey && uDsn) {
    // Validate DSN format
    if (/^https:\/\/api\d+\.unipile\.com:\d+$/.test(uDsn)) {
      checks.push({ name: 'Unipile credentials', status: 'pass', detail: '' })
    } else {
      checks.push({
        name: 'Unipile DSN format',
        status: 'fail',
        detail: `Invalid format: ${maskEnvValue(uDsn)}. Expected: https://api{N}.unipile.com:{PORT}`,
      })
    }
  } else if (uKey && !uDsn) {
    checks.push({ name: 'Unipile credentials', status: 'fail', detail: 'UNIPILE_API_KEY set but UNIPILE_DSN missing. Both required.' })
  } else if (!uKey && uDsn) {
    checks.push({ name: 'Unipile credentials', status: 'fail', detail: 'UNIPILE_DSN set but UNIPILE_API_KEY missing. Both required.' })
  } else {
    checks.push({ name: 'Unipile credentials', status: 'skip', detail: 'Not configured (optional)' })
  }

  // Optional providers
  const optional = [
    { key: 'FIRECRAWL_API_KEY', label: 'Firecrawl' },
    { key: 'NOTION_API_KEY', label: 'Notion' },
    { key: 'CRUSTDATA_API_KEY', label: 'Crustdata' },
    { key: 'FULLENRICH_API_KEY', label: 'FullEnrich' },
    { key: 'INSTANTLY_API_KEY', label: 'Instantly' },
  ]
  for (const { key, label } of optional) {
    const val = envVars.get(key) ?? process.env[key]
    if (val && val.trim()) {
      checks.push({ name: `${label} (${key})`, status: 'pass', detail: '' })
    } else {
      checks.push({ name: `${label} (${key})`, status: 'skip', detail: 'Not configured (optional)' })
    }
  }

  // Common mistakes
  const envContent = readFileSync(envPath, 'utf-8')
  const quotedLines = envContent.split('\n').filter(l => /^[A-Z_]+=".*"/.test(l.trim()))
  if (quotedLines.length > 0) {
    checks.push({
      name: 'No quoted values',
      status: 'warn',
      detail: `${quotedLines.length} line(s) have quoted values. Remove the double quotes.`,
    })
  } else {
    checks.push({ name: 'No quoted values', status: 'pass', detail: '' })
  }

  const trailingWs = envContent.split('\n').filter(l => l.trim() && / +$/.test(l))
  if (trailingWs.length > 0) {
    checks.push({
      name: 'No trailing whitespace',
      status: 'warn',
      detail: `${trailingWs.length} line(s) have trailing spaces. This can cause auth failures.`,
    })
  } else {
    checks.push({ name: 'No trailing whitespace', status: 'pass', detail: '' })
  }

  return { layer: 'Environment', checks }
}

// ─── Layer 2: Database ───────────────────────────────────────────────────────

function checkDatabase(): LayerResult {
  const checks: CheckResult[] = []
  const dbPath = getDbPath()

  // File exists
  if (!existsSync(dbPath)) {
    checks.push({
      name: 'Database file',
      status: 'fail',
      detail: `Not found at ${dbPath}. Run: pnpm db:push`,
    })
    return { layer: 'Database', checks }
  }
  checks.push({ name: 'Database file', status: 'pass', detail: '' })

  // Core tables
  const tables = runSqlite(dbPath, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
  if (!tables) {
    checks.push({ name: 'Tables query', status: 'fail', detail: 'Cannot query database. File may be corrupt.' })
    return { layer: 'Database', checks }
  }

  const tableList = tables.split('\n').filter(Boolean)
  const coreTables = ['conversations', 'messages', 'workflows', 'workflow_steps', 'result_sets', 'result_rows', 'api_connections', 'frameworks', 'campaigns']
  const missingTables = coreTables.filter(t => !tableList.includes(t))

  if (missingTables.length === 0) {
    checks.push({ name: `Core tables (${coreTables.length}/${coreTables.length})`, status: 'pass', detail: '' })
  } else if (missingTables.length === coreTables.length) {
    checks.push({
      name: 'Core tables',
      status: 'fail',
      detail: `All core tables missing. Run: pnpm db:push`,
    })
  } else {
    checks.push({
      name: `Core tables (${coreTables.length - missingTables.length}/${coreTables.length})`,
      status: 'fail',
      detail: `Missing: ${missingTables.join(', ')}. Run: pnpm db:push`,
    })
  }

  // FTS5
  const fts = runSqlite(dbPath, "SELECT name FROM sqlite_master WHERE name='knowledge_fts';")
  if (fts === 'knowledge_fts') {
    checks.push({ name: 'FTS5 search index', status: 'pass', detail: '' })
  } else {
    checks.push({ name: 'FTS5 search index', status: 'warn', detail: 'Missing. Knowledge search won\'t work. Auto-creates on next startup.' })
  }

  // WAL mode
  const wal = runSqlite(dbPath, 'PRAGMA journal_mode;')
  if (wal === 'wal') {
    checks.push({ name: 'WAL mode', status: 'pass', detail: '' })
  } else {
    checks.push({ name: 'WAL mode', status: 'warn', detail: `Current: ${wal}. Recommended: wal (for concurrent access). Fix: sqlite3 gtm-os.db "PRAGMA journal_mode=WAL;"` })
  }

  // Foreign keys
  const fk = runSqlite(dbPath, 'PRAGMA foreign_keys;')
  if (fk === '1') {
    checks.push({ name: 'Foreign keys', status: 'pass', detail: '' })
  } else {
    checks.push({ name: 'Foreign keys', status: 'warn', detail: 'Disabled. Enabled at runtime by the app, but good to verify.' })
  }

  return { layer: 'Database', checks }
}

// ─── Layer 3: Configuration ──────────────────────────────────────────────────

function checkConfiguration(): LayerResult {
  const checks: CheckResult[] = []

  // gtm-os.yaml
  const frameworkPath = join(process.cwd(), 'gtm-os.yaml')
  if (!existsSync(frameworkPath)) {
    checks.push({
      name: 'GTM framework (gtm-os.yaml)',
      status: 'fail',
      detail: 'Missing. Run: gtm-os onboard',
    })
  } else {
    try {
      const framework = yaml.load(readFileSync(frameworkPath, 'utf-8')) as Record<string, any> | null
      if (framework?.onboarding_complete) {
        checks.push({ name: 'GTM framework (gtm-os.yaml)', status: 'pass', detail: '' })
        if (framework?.company?.name) {
          checks.push({ name: `Company: ${framework.company.name}`, status: 'pass', detail: '' })
        }
        const segCount = framework?.segments?.length ?? 0
        if (segCount > 0) {
          checks.push({ name: `ICP segments: ${segCount} defined`, status: 'pass', detail: '' })
        } else {
          checks.push({ name: 'ICP segments', status: 'warn', detail: 'No segments defined. Qualification will be generic.' })
        }
      } else {
        checks.push({
          name: 'GTM framework (gtm-os.yaml)',
          status: 'warn',
          detail: 'File exists but onboarding_complete is false. Run: gtm-os onboard',
        })
      }
    } catch (e) {
      checks.push({
        name: 'GTM framework (gtm-os.yaml)',
        status: 'fail',
        detail: `Invalid YAML: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  // User config
  const configPath = join(homedir(), '.gtm-os', 'config.yaml')
  if (!existsSync(configPath)) {
    checks.push({
      name: 'User config (~/.gtm-os/config.yaml)',
      status: 'warn',
      detail: 'Missing. Run: gtm-os setup — to create with defaults.',
    })
  } else {
    try {
      yaml.load(readFileSync(configPath, 'utf-8'))
      checks.push({ name: 'User config (~/.gtm-os/config.yaml)', status: 'pass', detail: '' })
    } catch (e) {
      checks.push({
        name: 'User config (~/.gtm-os/config.yaml)',
        status: 'fail',
        detail: `Invalid YAML: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  return { layer: 'Configuration', checks }
}

// ─── Layer 4: Provider Connectivity ──────────────────────────────────────────

async function checkProviders(): Promise<LayerResult> {
  const checks: CheckResult[] = []

  // Anthropic
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        signal: AbortSignal.timeout(10000),
      })
      if (resp.ok) {
        checks.push({ name: 'Anthropic API', status: 'pass', detail: '' })
      } else if (resp.status === 401) {
        checks.push({ name: 'Anthropic API', status: 'fail', detail: 'Invalid API key. Get a new one at https://console.anthropic.com/settings/keys' })
      } else if (resp.status === 429) {
        checks.push({ name: 'Anthropic API', status: 'warn', detail: 'Rate limited. Wait and retry.' })
      } else {
        checks.push({ name: 'Anthropic API', status: 'warn', detail: `HTTP ${resp.status}` })
      }
    } catch (e) {
      checks.push({ name: 'Anthropic API', status: 'fail', detail: `Connection failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  } else {
    checks.push({ name: 'Anthropic API', status: 'fail', detail: 'ANTHROPIC_API_KEY not set' })
  }

  // Unipile
  const uKey = process.env.UNIPILE_API_KEY
  const uDsn = process.env.UNIPILE_DSN
  if (uKey && uDsn) {
    try {
      const resp = await fetch(`${uDsn}/api/v1/accounts`, {
        headers: { 'X-API-KEY': uKey },
        signal: AbortSignal.timeout(10000),
      })
      if (resp.ok) {
        const body = await resp.json() as any
        const items = body.items ?? (Array.isArray(body) ? body : [])
        if (items.length > 0) {
          checks.push({ name: 'Unipile (LinkedIn)', status: 'pass', detail: `${items.length} account(s) connected` })
        } else {
          checks.push({ name: 'Unipile (LinkedIn)', status: 'warn', detail: 'Connected but no LinkedIn accounts. Add one in your Unipile dashboard.' })
        }
      } else if (resp.status === 401 || resp.status === 403) {
        checks.push({ name: 'Unipile (LinkedIn)', status: 'fail', detail: 'API key invalid or expired.' })
      } else {
        checks.push({ name: 'Unipile (LinkedIn)', status: 'fail', detail: `HTTP ${resp.status}` })
      }
    } catch (e) {
      checks.push({ name: 'Unipile (LinkedIn)', status: 'fail', detail: `Connection failed. DSN may have rotated. Check your dashboard.` })
    }
  } else {
    checks.push({ name: 'Unipile (LinkedIn)', status: 'skip', detail: 'Not configured' })
  }

  // Firecrawl
  if (process.env.FIRECRAWL_API_KEY) {
    try {
      const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'], timeout: 5000 }),
        signal: AbortSignal.timeout(10000),
      })
      if (resp.ok) {
        checks.push({ name: 'Firecrawl', status: 'pass', detail: '' })
      } else if (resp.status === 401) {
        checks.push({ name: 'Firecrawl', status: 'fail', detail: 'API key invalid. Get a new one at https://firecrawl.dev/app/api-keys' })
      } else if (resp.status === 402) {
        checks.push({ name: 'Firecrawl', status: 'fail', detail: 'Credits exhausted. Upgrade plan.' })
      } else {
        checks.push({ name: 'Firecrawl', status: 'warn', detail: `HTTP ${resp.status}` })
      }
    } catch (e) {
      checks.push({ name: 'Firecrawl', status: 'fail', detail: `Connection failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  } else {
    checks.push({ name: 'Firecrawl', status: 'skip', detail: 'Not configured' })
  }

  // Notion
  if (process.env.NOTION_API_KEY) {
    try {
      const resp = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 1 }),
        signal: AbortSignal.timeout(10000),
      })
      if (resp.ok) {
        checks.push({ name: 'Notion', status: 'pass', detail: '' })
      } else if (resp.status === 401) {
        checks.push({ name: 'Notion', status: 'fail', detail: 'Token invalid. Regenerate at https://www.notion.so/my-integrations' })
      } else {
        checks.push({ name: 'Notion', status: 'warn', detail: `HTTP ${resp.status}` })
      }
    } catch (e) {
      checks.push({ name: 'Notion', status: 'fail', detail: `Connection failed` })
    }
  } else {
    checks.push({ name: 'Notion', status: 'skip', detail: 'Not configured' })
  }

  // Crustdata
  if (process.env.CRUSTDATA_API_KEY) {
    try {
      const resp = await fetch('https://api.crustdata.com/screener/credit_check/', {
        method: 'GET',
        headers: {
          'Authorization': `Token ${process.env.CRUSTDATA_API_KEY}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      })
      if (resp.ok) {
        checks.push({ name: 'Crustdata', status: 'pass', detail: '' })
      } else if (resp.status === 401 || resp.status === 403) {
        checks.push({ name: 'Crustdata', status: 'fail', detail: 'API key invalid or expired.' })
      } else {
        checks.push({ name: 'Crustdata', status: 'warn', detail: `HTTP ${resp.status}` })
      }
    } catch (e) {
      checks.push({ name: 'Crustdata', status: 'fail', detail: `Connection failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  } else {
    checks.push({ name: 'Crustdata', status: 'skip', detail: 'Not configured' })
  }

  // Instantly
  if (process.env.INSTANTLY_API_KEY) {
    try {
      const resp = await fetch(`https://api.instantly.ai/api/v1/account/list?api_key=${process.env.INSTANTLY_API_KEY}&limit=1`, {
        signal: AbortSignal.timeout(10000),
      })
      if (resp.ok) {
        checks.push({ name: 'Instantly', status: 'pass', detail: '' })
      } else if (resp.status === 401 || resp.status === 403) {
        checks.push({ name: 'Instantly', status: 'fail', detail: 'API key invalid.' })
      } else {
        checks.push({ name: 'Instantly', status: 'warn', detail: `HTTP ${resp.status}` })
      }
    } catch (e) {
      checks.push({ name: 'Instantly', status: 'fail', detail: `Connection failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  } else {
    checks.push({ name: 'Instantly', status: 'skip', detail: 'Not configured' })
  }

  // FullEnrich
  if (process.env.FULLENRICH_API_KEY) {
    try {
      const resp = await fetch('https://api.fullenrich.com/v1/credits', {
        headers: {
          'Authorization': `Bearer ${process.env.FULLENRICH_API_KEY}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      })
      if (resp.ok) {
        checks.push({ name: 'FullEnrich', status: 'pass', detail: '' })
      } else if (resp.status === 401 || resp.status === 403) {
        checks.push({ name: 'FullEnrich', status: 'fail', detail: 'API key invalid.' })
      } else {
        // Some endpoints may return 404 but auth works — treat as warn
        checks.push({ name: 'FullEnrich', status: 'warn', detail: `HTTP ${resp.status} (auth check inconclusive)` })
      }
    } catch (e) {
      checks.push({ name: 'FullEnrich', status: 'fail', detail: `Connection failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  } else {
    checks.push({ name: 'FullEnrich', status: 'skip', detail: 'Not configured' })
  }

  // MCP Providers
  try {
    const { getMcpConfigDir } = await import('../providers/mcp-loader')
    const { readdirSync, readFileSync } = await import('fs')
    const mcpDir = getMcpConfigDir()
    if (existsSync(mcpDir)) {
      const configs = readdirSync(mcpDir).filter(f => f.endsWith('.json'))
      if (configs.length > 0) {
        const { getRegistryReady } = await import('../providers/registry')
        const registry = await getRegistryReady()
        const allProviders = registry.getAll()
        const mcpProviders = allProviders.filter(p => p.type === 'mcp')

        for (const p of mcpProviders) {
          if (p.status === 'active') {
            checks.push({ name: `MCP: ${p.name}`, status: 'pass', detail: `${p.capabilities.join(', ')}` })
          } else {
            checks.push({ name: `MCP: ${p.name}`, status: 'warn', detail: 'Unavailable — check config and env vars' })
          }
        }

        // Report configs that failed to load
        const loadedNames = new Set(mcpProviders.map(p => p.id.replace('mcp:', '')))
        for (const file of configs) {
          try {
            const raw = JSON.parse(readFileSync(join(mcpDir, file), 'utf-8'))
            const name = raw.name
            if (name && !loadedNames.has(name)) {
              checks.push({ name: `MCP: ${file}`, status: 'fail', detail: 'Config exists but provider failed to register — check JSON schema' })
            }
          } catch {
            checks.push({ name: `MCP: ${file}`, status: 'fail', detail: 'Invalid JSON' })
          }
        }
      }
    }
  } catch {
    // MCP check is best-effort
  }

  return { layer: 'Provider Connectivity', checks }
}

// ─── Layer 5: Rate Limits & Runtime State ────────────────────────────────────

function checkRuntimeState(): LayerResult {
  const checks: CheckResult[] = []
  const dbPath = getDbPath()

  if (!existsSync(dbPath)) {
    checks.push({ name: 'Runtime state', status: 'skip', detail: 'Database not available' })
    return { layer: 'Runtime State', checks }
  }

  // Rate limit buckets
  const exhausted = runSqlite(dbPath, "SELECT COUNT(*) FROM rate_limit_buckets WHERE tokens_remaining <= 0;")
  if (exhausted === null) {
    checks.push({ name: 'Rate limit buckets', status: 'skip', detail: 'Table may not exist yet (created on first use)' })
  } else if (exhausted === '0') {
    checks.push({ name: 'Rate limit buckets', status: 'pass', detail: 'All buckets have tokens' })
  } else {
    const details = runSqlite(dbPath, "SELECT provider || ': ' || tokens_remaining || '/' || max_tokens FROM rate_limit_buckets WHERE tokens_remaining <= 0;")
    checks.push({ name: 'Rate limit buckets', status: 'warn', detail: `${exhausted} bucket(s) exhausted: ${details}` })
  }

  // API connections
  const connCount = runSqlite(dbPath, "SELECT COUNT(*) FROM api_connections;")
  if (connCount === null) {
    checks.push({ name: 'Stored API connections', status: 'skip', detail: 'Table not available' })
  } else {
    checks.push({ name: `Stored API connections: ${connCount}`, status: 'pass', detail: '' })
  }

  // Data directories
  const dataDirs = ['data/leads', 'data/intelligence', 'data/campaigns', 'data/content']
  for (const dir of dataDirs) {
    const fullPath = join(process.cwd(), dir)
    if (existsSync(fullPath)) {
      checks.push({ name: `${dir}/`, status: 'pass', detail: '' })
    } else {
      checks.push({ name: `${dir}/`, status: 'warn', detail: 'Will be created on first use' })
    }
  }

  return { layer: 'Runtime State', checks }
}

// ─── Generate Diagnostic Report ──────────────────────────────────────────────

function generateReport(layers: LayerResult[]): string {
  const lines: string[] = []
  lines.push('# GTM-OS Diagnostic Report')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')

  // System info
  lines.push('## System')
  lines.push(`- OS: ${process.platform} ${process.arch}`)
  try {
    lines.push(`- Node: ${process.version}`)
  } catch { /* ignore */ }
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'))
    lines.push(`- GTM-OS: v${pkg.version}`)
  } catch { /* ignore */ }
  lines.push('')

  // Env vars (names only, never values)
  lines.push('## Environment Variables')
  const envKeys = ['ANTHROPIC_API_KEY', 'DATABASE_URL', 'ENCRYPTION_KEY', 'UNIPILE_API_KEY', 'UNIPILE_DSN', 'FIRECRAWL_API_KEY', 'NOTION_API_KEY', 'CRUSTDATA_API_KEY', 'FULLENRICH_API_KEY', 'INSTANTLY_API_KEY']
  for (const key of envKeys) {
    lines.push(`- ${key}: ${process.env[key] ? 'SET' : 'NOT SET'}`)
  }
  lines.push('')

  // Layer results
  for (const layer of layers) {
    lines.push(`## ${layer.layer}`)
    for (const check of layer.checks) {
      lines.push(`- [${STATUS_ICON[check.status]}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ─── Main: runDoctor ─────────────────────────────────────────────────────────

export async function runDoctor(opts: { report?: boolean } = {}): Promise<void> {
  console.log('\n  GTM-OS Doctor — System Health Check\n')

  const layers: LayerResult[] = []

  // Layer 1
  console.log('── Environment ──')
  const envResult = checkEnvironment()
  layers.push(envResult)
  for (const check of envResult.checks) printCheck(check)

  // Layer 2
  console.log('\n── Database ──')
  const dbResult = checkDatabase()
  layers.push(dbResult)
  for (const check of dbResult.checks) printCheck(check)

  // Layer 3
  console.log('\n── Configuration ──')
  const cfgResult = checkConfiguration()
  layers.push(cfgResult)
  for (const check of cfgResult.checks) printCheck(check)

  // Layer 4
  console.log('\n── Provider Connectivity ──')
  const provResult = await checkProviders()
  layers.push(provResult)
  for (const check of provResult.checks) printCheck(check)

  // Layer 5
  console.log('\n── Runtime State ──')
  const rtResult = checkRuntimeState()
  layers.push(rtResult)
  for (const check of rtResult.checks) printCheck(check)

  // Summary
  const allChecks = layers.flatMap(l => l.checks)
  const passCount = allChecks.filter(c => c.status === 'pass').length
  const failCount = allChecks.filter(c => c.status === 'fail').length
  const warnCount = allChecks.filter(c => c.status === 'warn').length
  const skipCount = allChecks.filter(c => c.status === 'skip').length

  console.log('\n── Summary ──')
  console.log(`  ${passCount} passed, ${failCount} failed, ${warnCount} warnings, ${skipCount} skipped`)

  if (failCount === 0 && warnCount === 0) {
    console.log('\n  GTM-OS is healthy. All systems operational.\n')
  } else if (failCount === 0) {
    console.log('\n  GTM-OS is operational with minor warnings.\n')
  } else {
    console.log(`\n  ${failCount} issue(s) need attention. See FAIL items above.\n`)
  }

  // Optional report
  if (opts.report) {
    const report = generateReport(layers)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const reportPath = join(process.cwd(), `debug-report-${timestamp}.md`)
    writeFileSync(reportPath, report)
    console.log(`  Diagnostic report saved to: ${reportPath}`)
    console.log('  (Contains no secrets — safe to share in bug reports)\n')
  }
}
