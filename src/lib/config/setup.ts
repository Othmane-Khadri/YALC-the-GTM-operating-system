import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'
import { SIGNUP_URLS } from '../constants.js'

const GTM_OS_DIR = join(homedir(), '.gtm-os')
const CONFIG_PATH = join(GTM_OS_DIR, 'config.yaml')
const ENV_PATH = join(GTM_OS_DIR, '.env')

const REQUIRED_KEYS = [
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic (Claude)', url: 'https://console.anthropic.com/settings/keys', signupUrl: undefined },
  { key: 'UNIPILE_API_KEY', label: 'Unipile (LinkedIn)', url: 'https://app.unipile.com/settings/api', signupUrl: SIGNUP_URLS.unipile },
  { key: 'UNIPILE_DSN', label: 'Unipile DSN', url: 'https://app.unipile.com/settings/api', signupUrl: SIGNUP_URLS.unipile },
  { key: 'FIRECRAWL_API_KEY', label: 'Firecrawl', url: 'https://firecrawl.dev/app/api-keys', signupUrl: undefined },
  { key: 'CRUSTDATA_API_KEY', label: 'Crustdata', url: 'https://crustdata.com/dashboard/api', signupUrl: undefined },
  { key: 'FULLENRICH_API_KEY', label: 'FullEnrich', url: 'https://app.fullenrich.com/settings', signupUrl: SIGNUP_URLS.fullenrich },
  { key: 'NOTION_API_KEY', label: 'Notion', url: 'https://www.notion.so/my-integrations', signupUrl: undefined },
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

  for (const { key, label, url, signupUrl } of REQUIRED_KEYS) {
    if (process.env[key]) {
      console.log(`  ✓ ${label} (${key})`)
      presentKeys.push(key)
    } else {
      const signup = signupUrl ? ` | sign up: ${signupUrl}` : ''
      console.log(`  ✗ ${label} (${key}) — get it at ${url}${signup}`)
      missingKeys.push({ key, label, url, signupUrl })
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

  // Unipile — lightweight getAccounts() call with timeout
  if (process.env.UNIPILE_API_KEY && process.env.UNIPILE_DSN) {
    const { unipileService } = await import('../services/unipile')
    validations.push(await validateProvider('Unipile', async () => {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Unipile validation timed out after 5s')), 5000)
      )
      await Promise.race([unipileService.getAccounts(), timeoutPromise])
    }))
  } else {
    validations.push({ provider: 'Unipile', valid: false, error: 'missing key' })
  }

  // Firecrawl — lightweight scrape with timeout
  if (process.env.FIRECRAWL_API_KEY) {
    const { firecrawlService } = await import('../services/firecrawl')
    validations.push(await validateProvider('Firecrawl', async () => {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firecrawl validation timed out after 5s')), 5000)
      )
      await Promise.race([
        firecrawlService.scrape('https://example.com'),
        timeoutPromise,
      ])
    }))
  } else {
    validations.push({ provider: 'Firecrawl', valid: false, error: 'missing key' })
  }

  // Notion — lightweight search with timeout
  if (process.env.NOTION_API_KEY) {
    const { notionService } = await import('../services/notion')
    validations.push(await validateProvider('Notion', async () => {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Notion validation timed out after 5s')), 5000)
      )
      await Promise.race([
        notionService.search('', { property: 'object', value: 'page' }),
        timeoutPromise,
      ])
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

const OPTIONAL_KEYS = [
  { key: 'FULLENRICH_API_KEY', label: 'FullEnrich (email enrichment)', url: 'https://app.fullenrich.com/settings', signupUrl: SIGNUP_URLS.fullenrich },
  { key: 'INSTANTLY_API_KEY', label: 'Instantly (cold email)', url: 'https://instantly.ai/settings/api', signupUrl: SIGNUP_URLS.instantly },
  { key: 'ORTHOGONAL_API_KEY', label: 'Orthogonal (universal API gateway)', url: 'https://orthogonal.com/sign-up', signupUrl: SIGNUP_URLS.orthogonal },
]

export async function runSetupWizard(): Promise<void> {
  const { password, confirm, input } = await import('@inquirer/prompts')
  const { randomBytes } = await import('crypto')

  console.log('\n  GTM-OS Setup Wizard\n')

  // 1. Ensure directory
  if (!existsSync(GTM_OS_DIR)) {
    mkdirSync(GTM_OS_DIR, { recursive: true })
    console.log(`Created ${GTM_OS_DIR}`)
  }

  // 2. Ensure config
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, yaml.dump(DEFAULT_CONFIG))
    console.log(`Created default config at ${CONFIG_PATH}`)
  }

  // 3. Read existing .env.local
  const envLocalPath = join(process.cwd(), '.env.local')
  const existingEnv: Record<string, string> = {}
  if (existsSync(envLocalPath)) {
    const content = readFileSync(envLocalPath, 'utf-8')
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.+)$/)
      if (match) existingEnv[match[1]] = match[2]
    }
  }

  const alreadySet = Object.keys(existingEnv)
  if (alreadySet.length > 0) {
    console.log(`Found ${alreadySet.length} key(s) already in .env.local\n`)
  }

  const collectedKeys: Record<string, string> = { ...existingEnv }

  // 4. Required keys
  console.log('── Required Keys ──\n')

  for (const { key, label, url, signupUrl } of REQUIRED_KEYS) {
    if (existingEnv[key]) {
      console.log(`  ✓ ${label} (${key}) — already set`)
      continue
    }

    const signupLine = signupUrl ? `\n  Sign up:     ${signupUrl}` : ''
    const value = await password({
      message: `${label}${signupLine}\n  Get API key: ${url}\n  Paste your key:`,
      mask: '*',
    })

    if (!value) {
      console.log(`  Skipped ${key}`)
      continue
    }

    collectedKeys[key] = value

    // Live validate for known providers
    process.env[key] = value
    const validation = await validateProviderForKey(key)
    if (validation) {
      console.log(`  ${validation.valid ? '✓' : '✗'} ${validation.valid ? 'Valid' : validation.error}\n`)
    }
  }

  // 5. Auto-generate crypto keys
  console.log('\n── Auto-Generated Keys ──\n')

  if (!collectedKeys.ENCRYPTION_KEY) {
    collectedKeys.ENCRYPTION_KEY = randomBytes(32).toString('hex')
    console.log('  ✓ ENCRYPTION_KEY generated')
  } else {
    console.log('  ✓ ENCRYPTION_KEY already set')
  }

  if (!collectedKeys.DATABASE_URL) {
    collectedKeys.DATABASE_URL = 'file:./gtm-os.db'
    console.log('  ✓ DATABASE_URL set to local SQLite')
  }

  const wantApiToken = await confirm({
    message: 'Generate GTM_OS_API_TOKEN for /api/* route protection?',
    default: true,
  })
  if (wantApiToken && !collectedKeys.GTM_OS_API_TOKEN) {
    collectedKeys.GTM_OS_API_TOKEN = randomBytes(32).toString('hex')
    console.log('  ✓ GTM_OS_API_TOKEN generated')
  }

  // 6. Optional keys
  console.log('\n── Optional Keys (press Enter to skip) ──\n')

  for (const { key, label, url, signupUrl } of OPTIONAL_KEYS) {
    if (existingEnv[key]) {
      console.log(`  ✓ ${label} — already set`)
      continue
    }

    const signupLine = signupUrl ? `\n  Sign up: ${signupUrl}` : ''
    const value = await input({
      message: `${label}${signupLine}\n  API key: ${url}:`,
      default: '',
    })

    if (value) {
      collectedKeys[key] = value
    }
  }

  // 7. Write .env.local
  console.log('\n── Writing Configuration ──\n')

  const envContent = Object.entries(collectedKeys)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n'
  writeFileSync(envLocalPath, envContent)
  console.log(`  ✓ ${Object.keys(collectedKeys).length} keys written to .env.local`)

  // 8. Run regular setup (provider validation)
  console.log('')
  await runSetup()

  // 9. Next steps
  console.log('\n── Next Steps ──')
  console.log('  yalc-gtm onboard --linkedin <your-linkedin-url> --website <your-website-url>')
  console.log('  yalc-gtm doctor')
  console.log('')
}

async function validateProviderForKey(key: string): Promise<ProviderValidation | null> {
  try {
    switch (key) {
      case 'ANTHROPIC_API_KEY': {
        const { getAnthropicClient } = await import('../ai/client')
        const client = getAnthropicClient()
        await Promise.race([
          client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
        ])
        return { provider: 'Anthropic', valid: true }
      }
      case 'NOTION_API_KEY': {
        const { notionService } = await import('../services/notion')
        await Promise.race([
          notionService.search('', { property: 'object', value: 'page' }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
        ])
        return { provider: 'Notion', valid: true }
      }
      default:
        return null
    }
  } catch (err) {
    return { provider: key, valid: false, error: err instanceof Error ? err.message : String(err) }
  }
}
