/**
 * Unified `start` command — the single onboarding entry point.
 *
 * Merges setup wizard (API keys) + interactive interview (company context) +
 * framework derivation (Claude synthesis) + skill configuration (goals,
 * qualification rules, outreach templates) into one guided flow.
 *
 * Progressive disclosure: only ANTHROPIC_API_KEY is required to begin.
 * Other keys unlock additional capabilities (enrichment, LinkedIn, scraping).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import yaml from 'js-yaml'
import { SIGNUP_URLS } from '../constants.js'
import { isClaudeCode } from '../env/claude-code.js'

const GTM_OS_DIR = join(homedir(), '.gtm-os')
const CONFIG_PATH = join(GTM_OS_DIR, 'config.yaml')
const ENV_PATH = join(GTM_OS_DIR, '.env')

// ─── Provider tiers ─────────────────────────────────────────────────────────
// Tier 1 = recommended for standalone use. Tier 2 = unlocks core features.
// Tier 3 = optional. NOTE: when running inside Claude Code, the parent session
// already provides LLM reasoning + WebFetch, so ANTHROPIC_API_KEY and
// FIRECRAWL_API_KEY become optional — onboarding completes without them.

interface ProviderKey {
  key: string
  label: string
  url: string
  /** Tracked signup URL (affiliate/UTM). Shown when user needs to create an account. */
  signupUrl?: string
  tier: 1 | 2 | 3
  capability: string
  /** Why this key may be skippable inside Claude Code. */
  claudeCodeNote?: string
}

const PROVIDER_KEYS: ProviderKey[] = [
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic (Claude)', url: 'https://console.anthropic.com/settings/keys', tier: 1, capability: 'AI reasoning — powers planning, qualification, personalization', claudeCodeNote: 'Claude Code provides LLM reasoning. Skip unless you also run YALC standalone, via cron, or as a launchd job.' },
  { key: 'FIRECRAWL_API_KEY', label: 'Firecrawl', url: 'https://firecrawl.dev/app/api-keys', tier: 2, capability: 'Web scraping — auto-learn from your website', claudeCodeNote: 'Claude Code\'s WebFetch tool covers single-URL scrapes. Add Firecrawl later if you need JS-rendered pages, multi-page crawls, or web search.' },
  { key: 'CRUSTDATA_API_KEY', label: 'Crustdata', url: 'https://crustdata.com/dashboard/api', tier: 2, capability: 'Company & people search — find leads at scale' },
  { key: 'UNIPILE_API_KEY', label: 'Unipile (LinkedIn)', url: 'https://app.unipile.com/settings/api', signupUrl: SIGNUP_URLS.unipile, tier: 2, capability: 'LinkedIn outreach — connect, DM, scrape' },
  { key: 'UNIPILE_DSN', label: 'Unipile DSN', url: 'https://app.unipile.com/settings/api', signupUrl: SIGNUP_URLS.unipile, tier: 2, capability: 'LinkedIn endpoint' },
  { key: 'NOTION_API_KEY', label: 'Notion', url: 'https://www.notion.so/my-integrations', tier: 2, capability: 'CRM sync — campaign & lead tracking' },
  { key: 'FULLENRICH_API_KEY', label: 'FullEnrich', url: 'https://app.fullenrich.com/settings', signupUrl: SIGNUP_URLS.fullenrich, tier: 3, capability: 'Email & phone enrichment' },
  { key: 'INSTANTLY_API_KEY', label: 'Instantly', url: 'https://instantly.ai/settings/api', signupUrl: SIGNUP_URLS.instantly, tier: 3, capability: 'Cold email sending' },
]

const DEFAULT_CONFIG = {
  notion: { campaigns_ds: '', leads_ds: '', variants_ds: '', parent_page: '' },
  unipile: {
    daily_connect_limit: 30,
    sequence_timing: { connect_to_dm1_days: 2, dm1_to_dm2_days: 3 },
    rate_limit_ms: 3000,
  },
  qualification: {
    rules_path: join(GTM_OS_DIR, 'qualification_rules.md'),
    exclusion_path: join(GTM_OS_DIR, 'exclusion_list.md'),
    disqualifiers_path: join(GTM_OS_DIR, 'company_disqualifiers.md'),
    cache_ttl_days: 30,
  },
  crustdata: { max_results_per_query: 50 },
  fullenrich: { poll_interval_ms: 2000, poll_timeout_ms: 300000 },
  email: { provider: 'instantly' },
  linkedin: { provider: 'unipile' },
}

export interface StartOptions {
  tenantId: string
  /** Skip interactive prompts — use env vars as-is. */
  nonInteractive?: boolean
}

export async function runStart(opts: StartOptions): Promise<void> {
  const { password, input, confirm, select } = await import('@inquirer/prompts')
  const { tenantId } = opts
  const inClaudeCode = isClaudeCode()

  // Apply DB migrations before anything else — fresh installs have no tables
  // yet, so the first query otherwise crashes with `SQLITE_ERROR: no such table`.
  // Idempotent: drizzle's migrator is a no-op when everything is current.
  await applyMigrations()

  console.log(`
  ╔══════════════════════════════════════╗
  ║         GTM-OS — Getting Started     ║
  ╚══════════════════════════════════════╝
`)

  if (inClaudeCode) {
    console.log('  Detected: running inside Claude Code.')
    console.log('  LLM reasoning + single-URL web fetches come from your parent CC session,')
    console.log('  so Anthropic and Firecrawl keys are optional. You can complete setup')
    console.log('  without them and add them later for standalone / cron use.\n')
  }

  // ── Step 1: Environment ─────────────────────────────────────────────────
  console.log('── Step 1/4 — Environment ──\n')

  if (!existsSync(GTM_OS_DIR)) {
    mkdirSync(GTM_OS_DIR, { recursive: true })
    console.log(`  Created ${GTM_OS_DIR}`)
  }

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, yaml.dump(DEFAULT_CONFIG))
    console.log(`  Created default config`)
  }

  // Read existing env. Canonical location is ~/.gtm-os/.env. For back-compat
  // we also look at ./.env.local in the CWD — if only the legacy file exists,
  // migrate it to the canonical location and keep the original in place.
  const legacyEnvPath = join(process.cwd(), '.env.local')
  const hasGlobalEnv = existsSync(ENV_PATH)
  const hasLegacyEnv = existsSync(legacyEnvPath)

  if (!hasGlobalEnv && hasLegacyEnv) {
    copyFileSync(legacyEnvPath, ENV_PATH)
    console.log(`  Migrated ${legacyEnvPath} → ${ENV_PATH}`)
  }

  const envReadPath = existsSync(ENV_PATH) ? ENV_PATH : (hasLegacyEnv ? legacyEnvPath : null)
  const existingEnv: Record<string, string> = {}
  if (envReadPath) {
    const content = readFileSync(envReadPath, 'utf-8')
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.+)$/)
      if (match) existingEnv[match[1]] = match[2]
    }
  }

  const collectedKeys: Record<string, string> = { ...existingEnv }

  // Auto-generate infra keys
  if (!collectedKeys.ENCRYPTION_KEY) {
    collectedKeys.ENCRYPTION_KEY = randomBytes(32).toString('hex')
    console.log('  Generated ENCRYPTION_KEY')
  }
  if (!collectedKeys.DATABASE_URL) {
    collectedKeys.DATABASE_URL = `file:${join(GTM_OS_DIR, 'gtm-os.db')}`
    console.log('  Set DATABASE_URL (local SQLite)')
  }

  // Pick up anything already set in .env.local or process.env first.
  for (const p of PROVIDER_KEYS) {
    if (existingEnv[p.key]) {
      collectedKeys[p.key] = existingEnv[p.key]
      console.log(`  ✓ ${p.label} — already set in .env.local`)
    } else if (process.env[p.key]) {
      collectedKeys[p.key] = process.env[p.key]!
      console.log(`  ✓ ${p.label} — detected from environment`)
    }
  }

  // Prompt for any keys still missing. All keys are optional; setup never
  // blocks on a missing one. In CC mode the default is to skip; standalone,
  // the recommendation is to add at least Anthropic.
  if (!opts.nonInteractive) {
    // Inside Claude Code we drop Firecrawl from the prompt list entirely:
    // the parent session provides built-in WebFetch and WebSearch tools,
    // so the user shouldn't be asked for a key they don't need.
    const skipKeys = new Set<string>()
    if (inClaudeCode) {
      skipKeys.add('FIRECRAWL_API_KEY')
      console.log('  Web access: Claude Code (built-in WebFetch + WebSearch)')
    }

    const tier1 = PROVIDER_KEYS.filter(p => p.tier === 1 && !collectedKeys[p.key] && !skipKeys.has(p.key))
    const tier2 = PROVIDER_KEYS.filter(p => p.tier === 2 && !collectedKeys[p.key] && !skipKeys.has(p.key))
    const missing = [...tier1, ...tier2]

    if (missing.length > 0) {
      console.log('\n  The following provider keys unlock capabilities (all optional, press Enter to skip):')
      console.log('')
      for (const p of missing) {
        const signup = p.signupUrl ? ` — sign up: ${p.signupUrl}` : ''
        console.log(`    ${p.label}: ${p.capability}${signup}`)
        if (inClaudeCode && p.claudeCodeNote) {
          console.log(`      ↳ ${p.claudeCodeNote}`)
        }
      }
      console.log('')

      const want = await confirm({
        message: 'Add provider keys now?',
        default: !inClaudeCode,
      })

      if (want) {
        for (const p of missing) {
          const signupLine = p.signupUrl ? `\n  Sign up: ${p.signupUrl}` : ''
          const value = await password({
            message: `${p.label}${signupLine}\n  API key: ${p.url} (Enter to skip):`,
            mask: '*',
          })
          if (value.trim()) {
            collectedKeys[p.key] = value.trim()
            process.env[p.key] = value.trim()
          }
        }
      }
    }
  }

  // Validate Anthropic key only if one was supplied. Standalone users without
  // a key see a soft warning; CC users see nothing (key isn't expected).
  if (collectedKeys.ANTHROPIC_API_KEY) {
    console.log('\n  Validating Anthropic key...')
    try {
      const { getAnthropicClient } = await import('../ai/client.js')
      const client = getAnthropicClient()
      await Promise.race([
        client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ])
      console.log('  ✓ Anthropic key valid')
    } catch (err) {
      console.error(`  ✗ Anthropic key validation failed: ${err instanceof Error ? err.message : err}`)
      console.error('    Continuing setup anyway — fix the key in .env.local before running LLM commands.')
    }
  } else if (!inClaudeCode) {
    console.log('\n  ⚠ No ANTHROPIC_API_KEY set. LLM commands (orchestrate, leads:qualify,')
    console.log('    personalize, competitive-intel) will require one. Add it later to')
    console.log('    .env.local and re-run `yalc-gtm setup` to validate.')
  }

  // Write canonical env file at ~/.gtm-os/.env
  const envContent = Object.entries(collectedKeys)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n'
  writeFileSync(ENV_PATH, envContent)
  console.log(`\n  ✓ ${Object.keys(collectedKeys).length} keys saved to ${ENV_PATH}`)

  // ── Step 1b: Outbound Channel Selection ─────────────────────────────────
  // Pick the email provider so future `email:send` calls resolve through the
  // registry to the right channel. Defaults to Instantly (built-in).
  if (!opts.nonInteractive) {
    await pickOutboundProvider({ select })
  }

  // ── Step 2: Company Context ─────────────────────────────────────────────
  console.log('\n── Step 2/4 — Company Context ──\n')

  const { runOnboarding } = await import('../context/onboarding.js')
  const { getWebFetchProvider } = await import('../env/claude-code.js')
  // Enable the website step whenever some fetch backend is available —
  // Firecrawl directly, or a Claude Code parent that emits WebFetch
  // handoffs. The ingestor itself decides what to do.
  const canFetch = getWebFetchProvider() !== 'none'
  const report = await runOnboarding({
    tenantId,
    scrapeWebsite: canFetch,
    nonInteractive: opts.nonInteractive,
  })

  console.log(`\n  ✓ Captured ${report.interviewAnswers} answers`)
  if (report.websiteChunks > 0) console.log(`  ✓ Scraped ${report.websiteChunks} website sections`)
  if (report.uploadChunks > 0) console.log(`  ✓ Ingested ${report.uploadChunks} file chunks`)

  // ── Step 3: Framework Derivation ────────────────────────────────────────
  // Steps 3-4 require an Anthropic key (framework synthesis + goal/skill
  // configuration are LLM-driven). Without a key we skip them and tell the
  // user how to complete setup later — onboarding never blocks.
  const hasAnthropic = !!collectedKeys.ANTHROPIC_API_KEY
  let frameworkDerived = false

  if (!hasAnthropic) {
    console.log('\n── Step 3/4 — Building GTM Framework ──\n')
    console.log('  ⊘ Skipped — framework derivation needs an Anthropic key.')
    console.log('    Your company context is saved. To finish setup later:')
    console.log('      1. Add ANTHROPIC_API_KEY to .env.local')
    console.log('      2. Run: yalc-gtm onboard --linkedin <url> --website <url>')
    console.log('      3. Run: yalc-gtm configure')
    console.log('\n── Step 4/4 — Goals & Configuration ──\n')
    console.log('  ⊘ Skipped (depends on the framework above).')
  } else {
    console.log('\n── Step 3/4 — Building GTM Framework ──\n')
    console.log('  Claude is synthesizing your company context into a GTM framework...')

    const { deriveFramework, persistDerivedFramework } = await import('../framework/derive.js')
    const derivation = await deriveFramework({ tenantId, dryRun: true })
    let fw = derivation.framework

    // Show a structured summary so the user can sanity-check the synthesis
    // before it gets written to disk. Skipped under --non-interactive.
    if (!opts.nonInteractive) {
      printFrameworkSummary(fw, derivation.nodesConsidered)
      const accept = await confirm({
        message: 'Save this framework?',
        default: true,
      })
      if (!accept) {
        fw = await editFrameworkInEditor(fw)
      }
    }

    await persistDerivedFramework(fw, tenantId)
    frameworkDerived = true

    console.log(`\n  ✓ Framework saved (${derivation.nodesConsidered} data points considered)`)
    if (fw.company.name) console.log(`    Company:  ${fw.company.name}`)
    if (fw.positioning.valueProp) console.log(`    Value:    ${fw.positioning.valueProp}`)
    if (fw.segments.length > 0) console.log(`    Segments: ${fw.segments.map(s => s.name).join(', ')}`)

    // ── Step 4: Goals & Configuration ───────────────────────────────────
    console.log('\n── Step 4/4 — Goals & Configuration ──\n')

    const { setGoals } = await import('./goal-setter.js')
    const { configureSkills } = await import('./skill-configurator.js')
    const goals = await setGoals(fw)
    await configureSkills(fw, goals)
  }

  // ── File Structure Map ─────────────────────────────────────────────────
  printFileStructure()

  // ── Readiness Report ────────────────────────────────────────────────────
  printReadinessReport(collectedKeys, { frameworkDerived, inClaudeCode })
}

/**
 * Bring the database up to the current schema by replaying the checked-in
 * migration SQL files directly. Idempotent: skips on existing DBs that
 * already have the core tables.
 *
 * We don't rely on drizzle-kit at runtime because drizzle-kit's config
 * loader uses Node's built-in TypeScript stripper, which Node 22+ refuses
 * to run on files inside node_modules — globally-installed packages can't
 * shell out to drizzle-kit. Raw SQL replay sidesteps that entirely and
 * removes drizzle-kit from the runtime dependency surface.
 */
async function applyMigrations(): Promise<void> {
  const { readdir, readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { dirname, resolve } = await import('node:path')
  const { rawClient } = await import('../db/index.js')

  // Skip if the DB already has core tables — user bootstrapped previously.
  try {
    const r = await rawClient.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = 'campaigns' LIMIT 1"
    )
    if (r.rows.length > 0) return
  } catch {
    // DB file may not exist yet — fall through to bootstrap
  }

  const here = dirname(fileURLToPath(import.meta.url))
  const migrationsFolder = resolve(here, '../db/migrations')

  const files = (await readdir(migrationsFolder))
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const f of files) {
    const sql = await readFile(resolve(migrationsFolder, f), 'utf-8')
    const stmts = sql
      .split(/-->\s*statement-breakpoint/)
      .map((s) => s.trim())
      .filter(Boolean)
    for (const stmt of stmts) {
      try {
        await rawClient.execute(stmt)
      } catch (err) {
        const msg = String((err as { message?: string })?.message ?? '')
        if (!/(already exists|duplicate column)/i.test(msg)) throw err
      }
    }
  }

  console.log('  ✓ Database ready')
}

type SelectFn = (args: {
  message: string
  choices: Array<{ name: string; value: string; description?: string }>
  default?: string
}) => Promise<string>

/**
 * Prompt the user to pick an email (and optionally LinkedIn) provider, then
 * persist the choice into ~/.gtm-os/config.yaml under `email.provider` and
 * `linkedin.provider`. Defaults preserve current behavior (Instantly + Unipile).
 *
 * Picking a non-built-in provider does not install anything inline — we just
 * print the follow-up `provider:add --mcp <name>` command.
 */
async function pickOutboundProvider(deps: { select: SelectFn }): Promise<void> {
  const { select } = deps

  // Read existing config if present so we can default to the current value.
  let existing: Record<string, unknown> = {}
  if (existsSync(CONFIG_PATH)) {
    try {
      existing = (yaml.load(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>) ?? {}
    } catch {
      existing = {}
    }
  }
  const existingEmail = ((existing.email as Record<string, unknown> | undefined)?.provider as string | undefined) ?? 'instantly'
  const existingLinkedIn = ((existing.linkedin as Record<string, unknown> | undefined)?.provider as string | undefined) ?? 'unipile'

  console.log('\n  Which email provider do you want to use?')
  const emailChoice = await select({
    message: 'Email provider',
    default: existingEmail,
    choices: [
      { name: 'Instantly (built-in)', value: 'instantly', description: 'Default cold email engine bundled with YALC.' },
      { name: 'Brevo (via MCP)', value: 'brevo', description: 'Adds Brevo through an MCP server template.' },
      { name: 'Mailgun (via MCP)', value: 'mailgun', description: 'Adds Mailgun through an MCP server template.' },
      { name: 'SendGrid (via MCP)', value: 'sendgrid', description: 'Adds SendGrid through an MCP server template.' },
      { name: 'None / decide later', value: 'none', description: 'Skip — pick later by editing ~/.gtm-os/config.yaml.' },
    ],
  })

  // Persist (skip the literal 'none' sentinel — leave config untouched).
  const merged: Record<string, unknown> = { ...existing }
  if (emailChoice !== 'none') {
    merged.email = { provider: emailChoice }
  }
  if (!merged.linkedin) {
    merged.linkedin = { provider: existingLinkedIn }
  }
  writeFileSync(CONFIG_PATH, yaml.dump(merged))

  if (emailChoice !== 'none' && emailChoice !== 'instantly') {
    console.log(`  ✓ Email provider set to ${emailChoice}.`)
    console.log(`    Run: yalc-gtm provider:add --mcp ${emailChoice}`)
  } else if (emailChoice === 'instantly') {
    console.log('  ✓ Email provider set to instantly (built-in).')
  } else {
    console.log('  ⊘ Email provider left unset. Configure later under email.provider in ~/.gtm-os/config.yaml.')
  }
}

/**
 * Print a structured one-screen summary of a derived framework so the user
 * can sanity-check Claude's output before persisting it.
 */
function printFrameworkSummary(
  fw: import('../framework/types.js').GTMFramework,
  nodesConsidered: number,
): void {
  const segments = fw.segments ?? []
  const signals = [
    ...(fw.signals?.buyingIntentSignals ?? []),
    ...(fw.signals?.triggerEvents ?? []),
    ...(fw.signals?.monitoringKeywords ?? []),
  ]
  const competitors = (fw.positioning?.competitors ?? []).map((c) => c.name).filter(Boolean)

  console.log(`\n  -- Derived Framework --`)
  console.log(`    Source:        ${nodesConsidered} memory nodes`)
  console.log(`    Company:       ${fw.company?.name ?? '(unset)'}`)
  console.log(`    Value prop:    ${fw.positioning?.valueProp ?? '(unset)'}`)
  console.log(`    Segments (${segments.length}):`)
  for (const s of segments) {
    const desc = s.description ? ` — ${s.description}` : ''
    console.log(`      - ${s.name}${desc}`)
  }
  console.log(`    Positioning:   ${fw.positioning?.category ?? '(unset)'}`)
  console.log(`    Competitors:   ${competitors.length > 0 ? competitors.join(', ') : '(none)'}`)
  console.log(`    Signals (${signals.length}):`)
  for (const sig of signals.slice(0, 8)) {
    console.log(`      - ${sig}`)
  }
  if (signals.length > 8) console.log(`      ... and ${signals.length - 8} more`)
  console.log('')
}

/**
 * Open $EDITOR with the framework as YAML so the user can hand-edit it
 * before saving. Re-prompts on parse errors. Returns the edited framework.
 */
async function editFrameworkInEditor(
  fw: import('../framework/types.js').GTMFramework,
): Promise<import('../framework/types.js').GTMFramework> {
  const { editor } = await import('@inquirer/prompts')
  let draft = yaml.dump(fw)
  for (;;) {
    const edited = await editor({
      message: 'Edit framework YAML (save and close to apply)',
      default: draft,
      postfix: '.yaml',
      waitForUserInput: false,
    })
    try {
      const parsed = yaml.load(edited) as import('../framework/types.js').GTMFramework
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('YAML must be a mapping')
      }
      return parsed
    } catch (err) {
      console.error(
        `  YAML parse failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      const retry = await (await import('@inquirer/prompts')).confirm({
        message: 'Re-open editor to fix?',
        default: true,
      })
      if (!retry) {
        console.log('  Discarding edits — keeping derived framework as-is.')
        return fw
      }
      draft = edited
    }
  }
}

function printFileStructure(): void {
  console.log(`
  ── Where Things Live ──

  YALC organizes your GTM data across two locations:

  ~/.gtm-os/                          Your GTM brain (persists across projects)
  ├── config.yaml                     Provider settings, Notion IDs, rate limits
  ├── framework.yaml                  GTM framework — ICP, positioning, signals
  ├── qualification_rules.md          Lead qualification patterns (auto-generated)
  ├── campaign_templates.yaml         Outreach copy templates (auto-generated)
  ├── search_queries.txt              Monitoring keywords (auto-generated)
  └── tenants/<slug>/                 Per-tenant overrides (multi-company mode)
      ├── onboarding.yaml
      └── framework.yaml

  ./data/                             Working data (in your project directory)
  ├── leads/                          CSV/JSON lead lists for qualification
  ├── intelligence/                   Campaign learnings and insights
  └── campaigns/                      Campaign exports and reports

  When talking to Claude Code, reference these locations directly:
    "Update my qualification rules"   → edits ~/.gtm-os/qualification_rules.md
    "Add a segment to my framework"   → edits ~/.gtm-os/framework.yaml
    "Qualify leads from this CSV"      → reads from ./data/leads/
    "Show my campaign learnings"       → reads from ./data/intelligence/
`)
}

function printReadinessReport(
  keys: Record<string, string>,
  state: { frameworkDerived: boolean; inClaudeCode: boolean }
): void {
  const has = (k: string) => !!keys[k] || !!process.env[k]
  const hasAnthropic = has('ANTHROPIC_API_KEY')

  console.log(`
  ╔══════════════════════════════════════╗
  ║          You're ready to go!         ║
  ╚══════════════════════════════════════╝

  Available capabilities:
`)

  const capabilities: Array<{ check: boolean; label: string; command: string }> = [
    { check: hasAnthropic, label: 'AI-powered GTM planning', command: 'yalc-gtm orchestrate "find companies matching my ICP"' },
    { check: hasAnthropic && has('CRUSTDATA_API_KEY'), label: 'Lead qualification', command: 'yalc-gtm leads:qualify --source csv --input ./your-leads.csv --dry-run' },
    { check: has('UNIPILE_API_KEY'), label: 'LinkedIn campaigns', command: 'yalc-gtm campaign:create --title "First Campaign"' },
    { check: has('NOTION_API_KEY'), label: 'Notion CRM sync', command: 'yalc-gtm notion:sync' },
    { check: has('FIRECRAWL_API_KEY') || state.inClaudeCode, label: 'Web intelligence', command: 'yalc-gtm orchestrate "research competitors"' },
  ]

  for (const cap of capabilities) {
    const icon = cap.check ? '✓' : '○'
    console.log(`    ${icon} ${cap.label}`)
  }

  if (state.inClaudeCode && !hasAnthropic) {
    console.log(`
  Claude Code mode:
    LLM-heavy commands (orchestrate, leads:qualify, personalize, competitive-intel)
    will print a redirect message instead of running. Reformulate those as prompts
    to your parent CC session, or add ANTHROPIC_API_KEY for direct execution.
`)
  }

  // Suggest first action based on what's available. Without an Anthropic key
  // we can only safely recommend pure-CRUD commands.
  const firstAction = hasAnthropic
    ? capabilities.find(c => c.check)
    : { command: 'yalc-gtm campaign:create --title "First Campaign" --hypothesis "test"' }
  if (firstAction) {
    console.log(`  Try this first:
    ${firstAction.command}
`)
  }

  if (!state.frameworkDerived) {
    console.log('  Pending: GTM framework not yet derived (needs ANTHROPIC_API_KEY).')
  }
  console.log('  Run "yalc-gtm doctor" anytime to check your setup health.')
  console.log('  Run "yalc-gtm start" again to reconfigure.\n')
}
