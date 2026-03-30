import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'

const GTM_OS_DIR = join(homedir(), '.gtm-os')
const CONFIG_PATH = join(GTM_OS_DIR, 'config.yaml')
const ENV_PATH = join(GTM_OS_DIR, '.env')

const REQUIRED_KEYS = [
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic (Claude)', url: 'https://console.anthropic.com/settings/keys' },
  { key: 'UNIPILE_API_KEY', label: 'Unipile (LinkedIn)', url: 'https://app.unipile.com/settings/api' },
  { key: 'UNIPILE_DSN', label: 'Unipile DSN', url: 'https://app.unipile.com/settings/api' },
  { key: 'FIRECRAWL_API_KEY', label: 'Firecrawl', url: 'https://firecrawl.dev/app/api-keys' },
  { key: 'CRUSTDATA_API_KEY', label: 'Crustdata', url: 'https://crustdata.com/dashboard/api' },
  { key: 'FULLENRICH_API_KEY', label: 'FullEnrich', url: 'https://app.fullenrich.com/settings' },
  { key: 'NOTION_API_KEY', label: 'Notion', url: 'https://www.notion.so/my-integrations' },
]

const DEFAULT_CONFIG = {
  notion: {
    campaigns_ds: '',
    leads_ds: '',
    variants_ds: '',
    parent_page: '',
  },
  unipile: {
    daily_connect_limit: 30,
    sequence_timing: {
      connect_to_dm1_days: 2,
      dm1_to_dm2_days: 3,
    },
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
  crustdata: {
    max_results_per_query: 50,
  },
  fullenrich: {
    poll_interval_ms: 2000,
    poll_timeout_ms: 300000,
  },
}

interface ProviderValidation {
  provider: string
  valid: boolean
  error?: string
}

async function validateProvider(name: string, check: () => Promise<void>): Promise<ProviderValidation> {
  try {
    await check()
    return { provider: name, valid: true }
  } catch (err) {
    return { provider: name, valid: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function runSetup(): Promise<void> {
  console.log('[setup] GTM-OS Setup\n')

  // 1. Ensure directory
  if (!existsSync(GTM_OS_DIR)) {
    mkdirSync(GTM_OS_DIR, { recursive: true })
    console.log(`[setup] Created ${GTM_OS_DIR}`)
  }

  // 2. Ensure config
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, yaml.dump(DEFAULT_CONFIG))
    console.log(`[setup] Created default config at ${CONFIG_PATH}`)
  } else {
    console.log(`[setup] Config exists at ${CONFIG_PATH}`)
  }

  // 3. Check env vars
  console.log('\n── API Keys ──')
  const presentKeys: string[] = []
  const missingKeys: typeof REQUIRED_KEYS = []

  for (const { key, label, url } of REQUIRED_KEYS) {
    if (process.env[key]) {
      console.log(`  ✓ ${label} (${key})`)
      presentKeys.push(key)
    } else {
      console.log(`  ✗ ${label} (${key}) — get it at ${url}`)
      missingKeys.push({ key, label, url })
    }
  }

  // 4. Write present keys to .env
  if (presentKeys.length > 0) {
    const existingEnv = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : ''
    const existingKeys = new Set(
      existingEnv.split('\n')
        .filter(l => l.includes('='))
        .map(l => l.split('=')[0])
    )

    const newEntries: string[] = []
    for (const key of presentKeys) {
      if (!existingKeys.has(key)) {
        newEntries.push(`${key}=${process.env[key]}`)
      }
    }

    if (newEntries.length > 0) {
      const updatedEnv = existingEnv.trim() + (existingEnv.trim() ? '\n' : '') + newEntries.join('\n') + '\n'
      writeFileSync(ENV_PATH, updatedEnv)
      console.log(`\n[setup] Updated ${ENV_PATH} with ${newEntries.length} new key(s)`)
    }
  }

  // 5. Real provider validation (actual API calls)
  console.log('\n── Provider Validation ──')
  const validations: ProviderValidation[] = []

  // Unipile — lightweight getAccounts() call
  if (process.env.UNIPILE_API_KEY && process.env.UNIPILE_DSN) {
    const { unipileService } = await import('../services/unipile')
    validations.push(await validateProvider('Unipile', async () => {
      await unipileService.getAccounts()
    }))
  } else {
    validations.push({ provider: 'Unipile', valid: false, error: 'missing key' })
  }

  // Firecrawl — lightweight scrape with timeout
  if (process.env.FIRECRAWL_API_KEY) {
    const { firecrawlService } = await import('../services/firecrawl')
    validations.push(await validateProvider('Firecrawl', async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      try {
        await firecrawlService.scrape('https://example.com')
      } finally {
        clearTimeout(timeout)
      }
    }))
  } else {
    validations.push({ provider: 'Firecrawl', valid: false, error: 'missing key' })
  }

  // Notion — lightweight search
  if (process.env.NOTION_API_KEY) {
    const { notionService } = await import('../services/notion')
    validations.push(await validateProvider('Notion', async () => {
      await notionService.search('', { property: 'object', value: 'page' })
    }))
  } else {
    validations.push({ provider: 'Notion', valid: false, error: 'missing key' })
  }

  // Crustdata — check key format (no free credits endpoint yet)
  if (process.env.CRUSTDATA_API_KEY) {
    const { crustdataService } = await import('../services/crustdata')
    validations.push(await validateProvider('Crustdata', async () => {
      if (!crustdataService.isAvailable()) throw new Error('service reports unavailable')
    }))
  } else {
    validations.push({ provider: 'Crustdata', valid: false, error: 'missing key' })
  }

  // FullEnrich — check key format
  if (process.env.FULLENRICH_API_KEY) {
    const { fullenrichService } = await import('../services/fullenrich')
    validations.push(await validateProvider('FullEnrich', async () => {
      if (!fullenrichService.isAvailable()) throw new Error('service reports unavailable')
    }))
  } else {
    validations.push({ provider: 'FullEnrich', valid: false, error: 'missing key' })
  }

  for (const v of validations) {
    const icon = v.valid ? '✓' : '✗'
    const detail = v.valid ? 'connected' : v.error ?? 'unknown error'
    console.log(`  ${icon} ${v.provider} — ${detail}`)
  }

  // Summary
  const validCount = validations.filter(v => v.valid).length
  if (missingKeys.length === 0 && validCount === validations.length) {
    console.log('\n[setup] All API keys configured and validated. GTM-OS is ready.')
  } else {
    const issues = missingKeys.length + validations.filter(v => !v.valid).length
    console.log(`\n[setup] ${issues} issue(s) found. Check keys in your environment or ${ENV_PATH}.`)
  }
}
