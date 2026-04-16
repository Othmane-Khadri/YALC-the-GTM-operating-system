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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import yaml from 'js-yaml'
import { SIGNUP_URLS } from '../constants.js'

const GTM_OS_DIR = join(homedir(), '.gtm-os')
const CONFIG_PATH = join(GTM_OS_DIR, 'config.yaml')

// ─── Provider tiers ─────────────────────────────────────────────────────────
// Tier 1 = required to start. Tier 2 = unlocks core features. Tier 3 = optional.

interface ProviderKey {
  key: string
  label: string
  url: string
  /** Tracked signup URL (affiliate/UTM). Shown when user needs to create an account. */
  signupUrl?: string
  tier: 1 | 2 | 3
  capability: string
}

const PROVIDER_KEYS: ProviderKey[] = [
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic (Claude)', url: 'https://console.anthropic.com/settings/keys', tier: 1, capability: 'AI reasoning — powers everything' },
  { key: 'FIRECRAWL_API_KEY', label: 'Firecrawl', url: 'https://firecrawl.dev/app/api-keys', tier: 2, capability: 'Web scraping — auto-learn from your website' },
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
  data: {
    leads_dir: './data/leads',
    intelligence_dir: './data/intelligence',
    campaigns_dir: './data/campaigns',
  },
  crustdata: { max_results_per_query: 50 },
  fullenrich: { poll_interval_ms: 2000, poll_timeout_ms: 300000 },
}

export interface StartOptions {
  tenantId: string
  /** Skip interactive prompts — use env vars as-is. */
  nonInteractive?: boolean
}

export async function runStart(opts: StartOptions): Promise<void> {
  const { password, input, confirm } = await import('@inquirer/prompts')
  const { tenantId } = opts

  console.log(`
  ╔══════════════════════════════════════╗
  ║         GTM-OS — Getting Started     ║
  ╚══════════════════════════════════════╝
`)

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

  // Read existing .env.local
  const envLocalPath = join(process.cwd(), '.env.local')
  const existingEnv: Record<string, string> = {}
  if (existsSync(envLocalPath)) {
    const content = readFileSync(envLocalPath, 'utf-8')
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
    collectedKeys.DATABASE_URL = 'file:./gtm-os.db'
    console.log('  Set DATABASE_URL (local SQLite)')
  }

  // Tier 1 — required
  const tier1 = PROVIDER_KEYS.filter(p => p.tier === 1)
  for (const p of tier1) {
    // Check .env.local first, then process.env (covers Claude Code sessions,
    // CI, and any parent process that already exports the key).
    if (existingEnv[p.key]) {
      console.log(`  ✓ ${p.label} — already set in .env.local`)
      continue
    }
    if (process.env[p.key]) {
      collectedKeys[p.key] = process.env[p.key]!
      console.log(`  ✓ ${p.label} — detected from environment`)
      continue
    }
    if (opts.nonInteractive) {
      console.error(`\n  ✗ ${p.label} is required. Set ${p.key} in .env.local or environment.`)
      process.exit(1)
    }
    const signupLine = p.signupUrl ? `\n  Sign up:     ${p.signupUrl}` : ''
    const value = await password({
      message: `${p.label} (${p.capability})${signupLine}\n  Get API key: ${p.url}\n  Paste your key:`,
      mask: '*',
    })
    if (!value.trim()) {
      console.error(`\n  ✗ ${p.label} is required to continue.`)
      process.exit(1)
    }
    collectedKeys[p.key] = value.trim()
    process.env[p.key] = value.trim()
  }

  // Validate Anthropic key
  console.log('  Validating Anthropic key...')
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
    console.log('  ✓ Anthropic key valid\n')
  } catch (err) {
    console.error(`  ✗ Anthropic key validation failed: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }

  // Tier 2 + 3 — pick up anything already in .env.local or process.env first
  for (const p of PROVIDER_KEYS.filter(pk => pk.tier >= 2)) {
    if (existingEnv[p.key]) {
      collectedKeys[p.key] = existingEnv[p.key]
      console.log(`  ✓ ${p.label} — already set`)
    } else if (process.env[p.key]) {
      collectedKeys[p.key] = process.env[p.key]!
      console.log(`  ✓ ${p.label} — detected from environment`)
    }
  }

  // Only prompt for missing tier 2 keys in interactive mode
  if (!opts.nonInteractive) {
    const tier2 = PROVIDER_KEYS.filter(p => p.tier === 2)
    const missingTier2 = tier2.filter(p => !collectedKeys[p.key])

    if (missingTier2.length > 0) {
      console.log('\n  The following keys unlock additional capabilities (press Enter to skip any):')
      console.log('')
      for (const p of missingTier2) {
        const signup = p.signupUrl ? ` — sign up: ${p.signupUrl}` : ''
        console.log(`    ${p.label}: ${p.capability}${signup}`)
      }
      console.log('')

      const wantTier2 = await confirm({
        message: 'Add optional provider keys now?',
        default: false,
      })

      if (wantTier2) {
        for (const p of missingTier2) {
          const signupLine = p.signupUrl ? `\n  Sign up: ${p.signupUrl}` : ''
          const value = await input({
            message: `${p.label}${signupLine}\n  API key: ${p.url}:`,
            default: '',
          })
          if (value.trim()) {
            collectedKeys[p.key] = value.trim()
            process.env[p.key] = value.trim()
          }
        }
      }
    }
  }

  // Write .env.local
  const envContent = Object.entries(collectedKeys)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n'
  writeFileSync(envLocalPath, envContent)
  console.log(`\n  ✓ ${Object.keys(collectedKeys).length} keys saved to .env.local`)

  // ── Step 2: Company Context ─────────────────────────────────────────────
  console.log('\n── Step 2/4 — Company Context ──\n')

  const { runOnboarding } = await import('../context/onboarding.js')
  const hasFirecrawl = !!collectedKeys.FIRECRAWL_API_KEY || !!process.env.FIRECRAWL_API_KEY
  const report = await runOnboarding({
    tenantId,
    scrapeWebsite: hasFirecrawl,
    nonInteractive: opts.nonInteractive,
  })

  console.log(`\n  ✓ Captured ${report.interviewAnswers} answers`)
  if (report.websiteChunks > 0) console.log(`  ✓ Scraped ${report.websiteChunks} website sections`)
  if (report.uploadChunks > 0) console.log(`  ✓ Ingested ${report.uploadChunks} file chunks`)

  // ── Step 3: Framework Derivation ────────────────────────────────────────
  console.log('\n── Step 3/4 — Building GTM Framework ──\n')
  console.log('  Claude is synthesizing your company context into a GTM framework...')

  const { deriveFramework } = await import('../framework/derive.js')
  const derivation = await deriveFramework(tenantId)
  const fw = derivation.framework

  console.log(`\n  ✓ Framework built from ${derivation.nodesConsidered} data points`)
  if (fw.company.name) console.log(`    Company:  ${fw.company.name}`)
  if (fw.positioning.valueProp) console.log(`    Value:    ${fw.positioning.valueProp}`)
  if (fw.segments.length > 0) console.log(`    Segments: ${fw.segments.map(s => s.name).join(', ')}`)

  // ── Step 4: Goals & Configuration ───────────────────────────────────────
  console.log('\n── Step 4/4 — Goals & Configuration ──\n')

  const { setGoals } = await import('./goal-setter.js')
  const { configureSkills } = await import('./skill-configurator.js')
  const goals = await setGoals(fw)
  await configureSkills(fw, goals)

  // ── File Structure Map ─────────────────────────────────────────────────
  printFileStructure()

  // ── Readiness Report ────────────────────────────────────────────────────
  printReadinessReport(collectedKeys)
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

function printReadinessReport(keys: Record<string, string>): void {
  const has = (k: string) => !!keys[k] || !!process.env[k]

  console.log(`
  ╔══════════════════════════════════════╗
  ║          You're ready to go!         ║
  ╚══════════════════════════════════════╝

  Available capabilities:
`)

  const capabilities: Array<{ check: boolean; label: string; command: string }> = [
    { check: true, label: 'AI-powered GTM planning', command: 'yalc-gtm orchestrate "find companies matching my ICP"' },
    { check: has('CRUSTDATA_API_KEY'), label: 'Lead qualification', command: 'yalc-gtm leads:qualify --source csv --input data/leads/sample.csv --dry-run' },
    { check: has('UNIPILE_API_KEY'), label: 'LinkedIn campaigns', command: 'yalc-gtm campaign:create --title "First Campaign"' },
    { check: has('NOTION_API_KEY'), label: 'Notion CRM sync', command: 'yalc-gtm notion:sync' },
    { check: has('FIRECRAWL_API_KEY'), label: 'Web intelligence', command: 'yalc-gtm orchestrate "research competitors"' },
  ]

  for (const cap of capabilities) {
    const icon = cap.check ? '✓' : '○'
    console.log(`    ${icon} ${cap.label}`)
  }

  // Suggest first action based on what's available
  const firstAction = capabilities.find(c => c.check)
  if (firstAction) {
    console.log(`
  Try this first:
    ${firstAction.command}
`)
  }

  console.log('  Run "yalc-gtm doctor" anytime to check your setup health.')
  console.log('  Run "yalc-gtm start" again to reconfigure.\n')
}
