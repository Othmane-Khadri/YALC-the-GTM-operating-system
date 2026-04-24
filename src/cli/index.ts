import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Load env from ~/.gtm-os/.env first (canonical), then .env.local in CWD
// (legacy) as a fallback. dotenv v16.4+ supports an array of paths; later
// entries do NOT override earlier ones, so the canonical location wins.
const globalEnvPath = join(homedir(), '.gtm-os', '.env')
const localEnvPath = join(process.cwd(), '.env.local')
const envPaths = [globalEnvPath, localEnvPath].filter(existsSync)
if (envPaths.length > 0) {
  loadEnv({ path: envPaths })
}

import { Command } from 'commander'
import { loadConfig } from '../lib/config/loader'
import { withDiagnostics } from '../lib/diagnostics/error-handler'
import { installGlobalErrorBoundary, setVerbose } from '../lib/cli/error-boundary'
import { resolveTenant, DEFAULT_TENANT } from '../lib/tenant/index.js'

// Install global error boundary to catch any uncaught errors
installGlobalErrorBoundary()

const program = new Command()

program
  .name('yalc-gtm')
  .description('YALC — open-source AI-native GTM operating system')
  .version('0.5.0')
  .option('-c, --config <path>', 'Path to config YAML', '~/.gtm-os/config.yaml')
  .option('-t, --tenant <slug>', 'Tenant slug (overrides GTM_OS_TENANT env and .gtm-os-tenant file)')
  .option('-v, --verbose', 'Enable verbose output with full stack traces')
  .hook('preAction', (thisCommand) => {
    // Resolve verbose flag first — affects error output globally
    const opts = thisCommand.opts()
    if (opts.verbose) {
      setVerbose(true)
      process.env.GTM_OS_VERBOSE = '1'
    }

    // Phase 1 / A3 — resolve once per invocation, cache on the program so
    // any command can read it via `getTenant()`. Precedence: --tenant flag
    // > GTM_OS_TENANT env > .gtm-os-tenant file > 'default'.
    const tenantId = resolveTenant({ cliFlag: opts.tenant })
    ;(program as any)._tenantId = tenantId
  })

/** Returns the resolved tenant for the current CLI invocation. */
export function getTenant(): string {
  return (program as any)._tenantId ?? DEFAULT_TENANT
}

// ─── campaign:track ─────────────────────────────────────────────────────────
program
  .command('campaign:track')
  .description('Run daily campaign tracker — poll Unipile, advance sequences, sync Notion')
  .option('--dry-run', 'Show what would happen without sending anything')
  .option('--campaign-id <id>', 'Track a specific campaign only')
  .action(withDiagnostics(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', homedir()))
    const { runTracker } = await import('../lib/campaign/tracker')
    await runTracker({
      config,
      tenantId: getTenant(),
      dryRun: opts.dryRun ?? false,
      campaignId: opts.campaignId,
    })
  }))

// ─── campaign:create ────────────────────────────────────────────────────────
program
  .command('campaign:create')
  .description('Create a new campaign with variant testing')
  .option('--leads-filter <filter>', 'Filter leads from Unified Leads DB (JSON)')
  .option('--title <title>', 'Campaign title')
  .option('--hypothesis <hypothesis>', 'Campaign hypothesis')
  .option('--auto-copy', 'Generate voice-aware copy via Claude instead of default templates')
  .option('--segment-id <id>', 'ICP segment ID for voice targeting')
  .option('--timezone <tz>', 'IANA timezone for send window (default: Europe/Paris)')
  .option('--start-at <date>', 'ISO date to auto-activate campaign (e.g. 2026-04-03)')
  .option('--send-window <range>', 'Send window HH:mm-HH:mm (default: 09:00-18:00)')
  .option('--active-days <days>', 'Active days 1=Mon..7=Sun comma-separated (default: 1,2,3,4,5)')
  .option('--delay-mode <mode>', 'Step delay counting: business or calendar (default: business)')
  .option('--dry-run', 'Preview campaign creation without writing to DB')
  .action(withDiagnostics(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', homedir()))
    const { runCreator } = await import('../lib/campaign/creator')
    const { buildScheduleFromOptions } = await import('../lib/campaign/schedule')

    const schedule = buildScheduleFromOptions({
      timezone: opts.timezone,
      startAt: opts.startAt,
      sendWindow: opts.sendWindow,
      activeDays: opts.activeDays,
      delayMode: opts.delayMode,
    })

    // If --start-at is set, campaign starts as 'scheduled' instead of 'active'
    const initialStatus = opts.startAt ? 'scheduled' : undefined

    await runCreator({
      config,
      tenantId: getTenant(),
      ...opts,
      autoCopy: opts.autoCopy,
      dryRun: opts.dryRun ?? false,
      schedule,
      initialStatus,
    })
  }))

// ─── campaign:schedule ──────────────────────────────────────────────────────
program
  .command('campaign:schedule')
  .description('Update schedule settings on an existing campaign')
  .requiredOption('--campaign-id <id>', 'Campaign ID to update')
  .option('--timezone <tz>', 'IANA timezone for send window')
  .option('--start-at <date>', 'ISO date to auto-activate (set "none" to clear)')
  .option('--send-window <range>', 'Send window HH:mm-HH:mm')
  .option('--active-days <days>', 'Active days 1=Mon..7=Sun comma-separated')
  .option('--delay-mode <mode>', 'Step delay counting: business or calendar')
  .option('--pace <seconds>', 'Seconds between sends')
  .action(async (opts) => {
    const { eq, and } = await import('drizzle-orm')
    const { db } = await import('../lib/db')
    const { campaigns } = await import('../lib/db/schema')
    const { parseSchedule, DEFAULT_SCHEDULE, buildScheduleFromOptions } = await import('../lib/campaign/schedule')

    const tenantId = getTenant()
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, opts.campaignId)))
    if (!campaign) {
      console.error(`Campaign not found: ${opts.campaignId}`)
      process.exit(1)
    }

    // Merge existing schedule with provided options
    const existing = parseSchedule(campaign.schedule) ?? { ...DEFAULT_SCHEDULE }
    const updated = buildScheduleFromOptions({
      timezone: opts.timezone ?? existing.timezone,
      startAt: opts.startAt === 'none' ? undefined : (opts.startAt ?? existing.startAt ?? undefined),
      sendWindow: opts.sendWindow ?? `${existing.sendWindow.start}-${existing.sendWindow.end}`,
      activeDays: opts.activeDays ?? existing.activeDays.join(','),
      delayMode: opts.delayMode ?? existing.delayMode,
      secondsBetweenSends: opts.pace ? parseInt(opts.pace, 10) : existing.sendingPace.secondsBetweenSends,
    })

    // If startAt was cleared, make sure it's null
    if (opts.startAt === 'none') updated.startAt = null

    await db.update(campaigns).set({
      schedule: updated as any,
      // If setting a future startAt and campaign is draft/active, switch to scheduled
      ...(updated.startAt && campaign.status === 'draft' ? { status: 'scheduled' } : {}),
      updatedAt: new Date().toISOString(),
    }).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, opts.campaignId)))

    console.log(`[schedule] Updated campaign "${campaign.title}"`)
    console.log(`  Timezone:      ${updated.timezone}`)
    console.log(`  Start at:      ${updated.startAt ?? 'immediate'}`)
    console.log(`  Send window:   ${updated.sendWindow.start}-${updated.sendWindow.end}`)
    console.log(`  Active days:   ${updated.activeDays.join(',')}`)
    console.log(`  Delay mode:    ${updated.delayMode}`)
    console.log(`  Pace:          ${updated.sendingPace.secondsBetweenSends}s between sends`)
  })

// ─── campaign:report ────────────────────────────────────────────────────────
program
  .command('campaign:report')
  .description('Generate weekly intelligence report')
  .option('--week <date>', 'Report week (ISO date, defaults to current)')
  .action(withDiagnostics(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', homedir()))
    const { runReport } = await import('../lib/campaign/intelligence-report')
    await runReport({ config, week: opts.week })
  }))

// ─── leads:scrape-post ──────────────────────────────────────────────────────
program
  .command('leads:scrape-post')
  .description('Scrape likers and/or commenters from a LinkedIn post URL')
  .requiredOption('--url <url>', 'LinkedIn post URL')
  .option('--type <type>', 'What to scrape: both, reactions, comments', 'both')
  .option('--max-pages <n>', 'Max pagination pages per endpoint', '10')
  .option('--output <path>', 'Custom output JSON path')
  .option('--account <name>', 'Unipile account name or ID to use for scraping')
  .action(withDiagnostics(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', homedir()))
    const { scrapePostEngagers } = await import('../lib/scraping/post-engagers')
    const result = await scrapePostEngagers({
      config,
      url: opts.url,
      type: opts.type as 'both' | 'reactions' | 'comments',
      maxPages: parseInt(opts.maxPages, 10),
      output: opts.output,
      account: opts.account,
    })
    console.log(`\n✓ Scraped ${result.totalEngagers} engagers (${result.reactorCount} reactors, ${result.commenterCount} commenters)`)
    console.log(`  Result set: ${result.resultSetId}`)
    console.log(`  Output: ${result.outputPath}`)
    console.log(`\nNext: npx tsx src/cli/index.ts leads:qualify --result-set ${result.resultSetId}`)
  }))

// ─── linkedin:answer-comments ───────────────────────────────────────────────
program
  .command('linkedin:answer-comments')
  .description('Reply to LinkedIn post comments (Lead Magnet or AI-personalized)')
  .requiredOption('--url <url>', 'LinkedIn post URL')
  .option('--mode <mode>', 'Reply mode: lead-magnet or general', 'general')
  .option('--template <text>', 'Reply template for lead-magnet mode')
  .option('--max <n>', 'Max replies', '50')
  .option('--dry-run', 'Preview without sending', true)
  .option('--send', 'Actually send replies (disables dry-run)')
  .option('--exclude <names...>', 'Author names to skip (partial match)')
  .action(async (opts) => {
    const { answerCommentsSkill } = await import('../lib/skills/builtin/answer-comments')
    const { getSkillRegistryReady } = await import('../lib/skills/registry')
    const registry = await getSkillRegistryReady()
    const skill = registry.get('answer-comments')!
    const dryRun = opts.send ? false : (opts.dryRun ?? true)

    const context = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => ({ id: 'mock', name: 'mock', execute: async function*() {} }) } as any,
      userId: 'default',
    }

    for await (const event of skill.execute({
      url: opts.url,
      mode: opts.mode,
      replyTemplate: opts.template,
      maxReplies: parseInt(opts.max, 10),
      dryRun,
      exclude: opts.exclude ?? [],
    }, context)) {
      if (event.type === 'progress') console.log(`[${event.percent}%] ${event.message}`)
      else if (event.type === 'error') console.error(`ERROR: ${event.message}`)
      else if (event.type === 'result') console.log('\nResult:', JSON.stringify(event.data, null, 2))
    }
  })

// ─── linkedin:reply-to-comments ─────────────────────────────────────────────
program
  .command('linkedin:reply-to-comments')
  .description('Send threaded replies under LinkedIn post comments (never top-level)')
  .requiredOption('--url <url>', 'LinkedIn post URL')
  .option('--template <text>', 'Reply text (use {{name}} for first name)')
  .option('--templates <texts...>', 'Multiple reply templates to rotate through')
  .option('--include-keywords <words...>', 'Only reply to comments containing these keywords')
  .option('--max <n>', 'Max replies', '100')
  .option('--dry-run', 'Preview without sending', true)
  .option('--send', 'Actually send replies (disables dry-run)')
  .option('--exclude <names...>', 'Author names to skip (partial match)')
  .action(async (opts) => {
    const { replyToCommentsSkill } = await import('../lib/skills/builtin/reply-to-comments')
    const dryRun = opts.send ? false : (opts.dryRun ?? true)

    const context = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => ({ id: 'mock', name: 'mock', execute: async function*() {} }) } as any,
      userId: 'default',
    }

    for await (const event of replyToCommentsSkill.execute({
      url: opts.url,
      template: opts.template,
      templates: opts.templates,
      exclude: opts.exclude ?? [],
      includeKeywords: opts.includeKeywords,
      maxReplies: parseInt(opts.max, 10),
      dryRun,
    }, context)) {
      if (event.type === 'progress') console.log(`[${event.percent}%] ${event.message}`)
      else if (event.type === 'error') console.error(`ERROR: ${event.message}`)
      else if (event.type === 'result') console.log('\nResult:', JSON.stringify(event.data, null, 2))
    }
  })

// ─── email:create-sequence ──────────────────────────────────────────────────
program
  .command('email:create-sequence')
  .description('Generate an email drip sequence with AI + brand voice')
  .requiredOption('--type <type>', 'Sequence type: welcome, lead-nurture, re-engagement, onboarding')
  .requiredOption('--product <text>', 'Product/service description')
  .requiredOption('--audience <text>', 'Target audience description')
  .option('--segment-id <id>', 'ICP segment ID for voice targeting')
  .action(async (opts) => {
    const { emailSequenceSkill } = await import('../lib/skills/builtin/email-sequence')
    const context = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => ({ id: 'mock', name: 'mock', execute: async function*() {} }) } as any,
      userId: 'default',
    }
    for await (const event of emailSequenceSkill.execute({
      type: opts.type,
      segmentId: opts.segmentId,
      productContext: opts.product,
      audienceContext: opts.audience,
    }, context)) {
      if (event.type === 'progress') console.log(`[${event.percent}%] ${event.message}`)
      else if (event.type === 'error') console.error(`ERROR: ${event.message}`)
    }
  })

// ─── email:send ────────────────────────────────────────────────────────────
program
  .command('email:send')
  .description('Send cold email sequence via Instantly.ai')
  .requiredOption('--campaign-name <name>', 'Campaign name')
  .requiredOption('--source <path>', 'CSV/JSON file of qualified leads')
  .option('--sequence <path>', 'Sequence template YAML (or use --generate-from)')
  .option('--generate-from <url>', 'Generate sequence from target company URL (ColdIQ framework)')
  .option('--save-sequence <path>', 'Save generated sequence to YAML file')
  .option('--from <accountId>', 'Instantly email account ID')
  .option('--dry-run', 'Preview without sending', false)
  .action(async (opts) => {
    const { readFileSync, writeFileSync } = await import('fs')
    const yaml = (await import('js-yaml')).default

    if (!opts.sequence && !opts.generateFrom) {
      console.error('Error: provide --sequence <path> or --generate-from <url>')
      process.exit(1)
    }

    // Parse leads
    const leadsRaw = readFileSync(opts.source, 'utf-8')
    const leads = opts.source.endsWith('.json')
      ? JSON.parse(leadsRaw)
      : leadsRaw.split('\n').slice(1).filter(Boolean).map(line => {
          const cols = line.split(',')
          return { email: cols[0], first_name: cols[1], last_name: cols[2], company: cols[3] }
        })

    // Get sequence — either from YAML file or generate from URL
    let sequence: Array<{ subject?: string; body: string; delay_days?: number }>

    if (opts.generateFrom) {
      console.log(`\n[generate] Researching ${opts.generateFrom}...`)
      const { generateFromUrl } = await import('../lib/email/cold-email-generator')
      const result = await generateFromUrl(opts.generateFrom)

      console.log(`\n── Company Research ──`)
      console.log(`  Company:        ${result.research.name}`)
      console.log(`  Sells:          ${result.research.sells}`)
      console.log(`  ICP:            ${result.research.icp}`)
      console.log(`  Key Proof:      ${result.research.keyProof}`)
      console.log(`  Differentiator: ${result.research.differentiator}`)

      console.log(`\n── Generated Sequence (${result.steps.length} steps) ──`)
      for (const [i, step] of result.steps.entries()) {
        const words = step.body.split(/\s+/).length
        console.log(`  Step ${i + 1}: ${step.subject ?? '(threaded reply)'} — ${words} words, delay ${step.delay_days}d`)
      }

      sequence = result.steps

      // Optionally save to YAML
      if (opts.saveSequence) {
        writeFileSync(opts.saveSequence, yaml.dump({ steps: sequence }))
        console.log(`\n[generate] Sequence saved to ${opts.saveSequence}`)
      }
    } else {
      const sequenceRaw = readFileSync(opts.sequence, 'utf-8')
      const sequenceData = yaml.load(sequenceRaw) as { steps: Array<{ subject?: string; body: string; delay_days?: number }> }
      sequence = sequenceData.steps ?? sequenceData
    }

    const { sendEmailSequenceSkill } = await import('../lib/skills/builtin/send-email-sequence')
    const context = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => ({ id: 'mock', name: 'mock', execute: async function*() {} }) } as any,
      userId: 'default',
    }

    for await (const event of sendEmailSequenceSkill.execute({
      campaignName: opts.campaignName,
      leads,
      sequence,
      fromAccountId: opts.from,
      dryRun: opts.dryRun,
    }, context)) {
      if (event.type === 'progress') console.log(`[${event.percent}%] ${event.message}`)
      else if (event.type === 'error') console.error(`ERROR: ${event.message}`)
      else if (event.type === 'result') console.log('\nResult:', JSON.stringify(event.data, null, 2))
    }
  })

// ─── email:accounts ────────────────────────────────────────────────────────
program
  .command('email:accounts')
  .description('List Instantly email sending accounts')
  .action(async () => {
    const { instantlyService } = await import('../lib/services/instantly')
    if (!instantlyService.isAvailable()) {
      const { INSTANTLY_SIGNUP_URL } = await import('../lib/constants')
      console.error(`INSTANTLY_API_KEY not set. Get your key at ${INSTANTLY_SIGNUP_URL}`)
      process.exit(1)
    }
    const accounts = await instantlyService.listEmailAccounts()
    if (accounts.length === 0) {
      console.log('No email accounts found in Instantly.')
      return
    }
    console.log('\n── Instantly Email Accounts ──')
    for (const acc of accounts) {
      console.log(`  ${acc.id}  ${acc.email}  [${acc.status}]`)
    }
    console.log(`\nUse --from <id> with email:send to select a sending account.`)
  })

// ─── email:status ──────────────────────────────────────────────────────────
program
  .command('email:status')
  .description('Check Instantly campaign analytics')
  .requiredOption('--campaign-id <id>', 'Instantly campaign ID')
  .action(async (opts) => {
    const { instantlyService } = await import('../lib/services/instantly')
    if (!instantlyService.isAvailable()) {
      const { INSTANTLY_SIGNUP_URL } = await import('../lib/constants')
      console.error(`INSTANTLY_API_KEY not set. Get your key at ${INSTANTLY_SIGNUP_URL}`)
      process.exit(1)
    }
    const analytics = await instantlyService.getCampaignAnalytics(opts.campaignId)
    console.log('\n── Campaign Analytics ──')
    console.log(`  Total leads:  ${analytics.total_leads}`)
    console.log(`  Contacted:    ${analytics.contacted}`)
    console.log(`  Emails sent:  ${analytics.emails_sent}`)
    console.log(`  Opened:       ${analytics.emails_read}`)
    console.log(`  Replied:      ${analytics.replies}`)
    console.log(`  Bounced:      ${analytics.bounced}`)
  })

// ─── personalize ───────────────────────────────────────────────────────────
program
  .command('personalize')
  .description('Auto-personalize a message for a lead using LinkedIn, Firecrawl, Crustdata, and intelligence')
  .requiredOption('--template <text>', 'Message template to personalize')
  .requiredOption('--email <email>', 'Lead email')
  .option('--first-name <name>', 'Lead first name')
  .option('--last-name <name>', 'Lead last name')
  .option('--company <name>', 'Lead company name')
  .option('--linkedin-url <url>', 'Lead LinkedIn profile URL')
  .option('--linkedin-account <id>', 'Unipile account ID for LinkedIn lookups')
  .option('--channel <channel>', 'email | linkedin | any', 'email')
  .option('--enrich', 'Pull additional signals from Crustdata (costs credits)')
  .option('--segment-id <id>', 'ICP segment for intelligence matching')
  .option('--dry-run', 'Preview without side effects', true)
  .action(async (opts) => {
    const { personalizeSkill } = await import('../lib/skills/builtin/personalize')
    const context = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => ({ id: 'mock', name: 'mock', execute: async function*() {} }) } as any,
      userId: 'default',
    }
    for await (const event of personalizeSkill.execute({
      lead: {
        email: opts.email,
        firstName: opts.firstName,
        lastName: opts.lastName,
        company: opts.company,
        companyDomain: opts.email.split('@')[1],
        linkedinUrl: opts.linkedinUrl,
      },
      template: opts.template,
      channel: opts.channel,
      enrichWithCrustdata: opts.enrich ?? false,
      linkedinAccountId: opts.linkedinAccount,
      segmentId: opts.segmentId,
      dryRun: opts.dryRun ?? true,
    }, context)) {
      if (event.type === 'progress') console.log(`[${event.percent}%] ${event.message}`)
      else if (event.type === 'error') console.error(`ERROR: ${event.message}`)
      else if (event.type === 'result') {
        const data = event.data as { personalizedMessage: string; sourcesUsed: string[]; confidenceScore: number }
        console.log(`\nSources: ${data.sourcesUsed.join(', ')}`)
        console.log(`Confidence: ${data.confidenceScore}/100`)
      }
    }
  })

// ─── competitive-intel ─────────────────────────────────────────────────────
program
  .command('competitive-intel')
  .description('Research a competitor: scrape, enrich, analyze, output profile')
  .requiredOption('--competitor <url-or-name>', 'Competitor URL or company name')
  .option('--enrich', 'Pull company data from Crustdata')
  .action(async (opts) => {
    const { competitiveIntelSkill } = await import('../lib/skills/builtin/competitive-intel')
    const context = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => ({ id: 'mock', name: 'mock', execute: async function*() {} }) } as any,
      userId: 'default',
    }
    for await (const event of competitiveIntelSkill.execute({
      competitor: opts.competitor,
      enrichWithCrustdata: opts.enrich ?? false,
    }, context)) {
      if (event.type === 'progress') console.log(`[${event.percent}%] ${event.message}`)
      else if (event.type === 'error') console.error(`ERROR: ${event.message}`)
    }
  })

// ─── campaign:create-sequence ───────────────────────────────────────────────
program
  .command('campaign:create-sequence')
  .description('Execute a multi-channel sequence (LinkedIn + email) from YAML')
  .requiredOption('--sequence <path>', 'Path to multi-channel sequence YAML')
  .requiredOption('--source <path>', 'CSV/JSON file of leads')
  .option('--linkedin-account <id>', 'Unipile LinkedIn account ID')
  .option('--dry-run', 'Preview actions without sending', false)
  .action(async (opts) => {
    const { readFileSync } = await import('fs')

    // Parse leads
    const leadsRaw = readFileSync(opts.source, 'utf-8')
    let leads: Array<Record<string, unknown>>
    if (opts.source.endsWith('.json')) {
      leads = JSON.parse(leadsRaw)
    } else {
      const lines = leadsRaw.split('\n').filter(Boolean)
      const headers = lines[0].split(',').map(h => h.trim())
      leads = lines.slice(1).map((line, idx) => {
        const cols = line.split(',')
        const obj: Record<string, unknown> = { id: `lead-${idx}` }
        for (let i = 0; i < headers.length; i++) {
          const key = headers[i]
            .replace(/\s+/g, '_')
            .replace(/([A-Z])/g, '_$1')
            .toLowerCase()
            .replace(/^_/, '')
          obj[key] = cols[i]?.trim() ?? ''
        }
        return obj
      })
    }

    const { multiChannelCampaignSkill } = await import('../lib/skills/builtin/multi-channel-campaign')
    const context = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => ({ id: 'mock', name: 'mock', execute: async function*() {} }) } as any,
      userId: 'default',
    }

    for await (const event of multiChannelCampaignSkill.execute({
      sequencePath: opts.sequence,
      leads,
      linkedinAccountId: opts.linkedinAccount,
      dryRun: opts.dryRun,
    }, context)) {
      if (event.type === 'progress') console.log(`[${event.percent}%] ${event.message}`)
      else if (event.type === 'error') console.error(`ERROR: ${event.message}`)
      else if (event.type === 'result') {
        const data = event.data as { processed: number; total: number; actions: unknown[] }
        console.log(`\nProcessed: ${data.processed}/${data.total}`)
      }
    }
  })

// ─── crm:setup ──────────────────────────────────────────────────────────────
program
  .command('crm:setup')
  .description('Interactive setup wizard for CRM integration via MCP')
  .requiredOption('--provider <name>', 'CRM provider name (e.g., hubspot, salesforce, pipedrive)')
  .option('--non-interactive', 'Skip prompts and auto-accept all mappings')
  .action(withDiagnostics(async (opts) => {
    const { runCrmSetupWizard } = await import('../lib/crm/setup-wizard')
    const result = await runCrmSetupWizard({
      provider: opts.provider,
      nonInteractive: opts.nonInteractive ?? false,
    })
    if (!result.success) {
      console.error(`\nSetup failed: ${result.message}`)
      process.exit(1)
    }
    console.log(`\n${result.message}`)
  }))

// ─── crm:import ─────────────────────────────────────────────────────────────
program
  .command('crm:import')
  .description('Import contacts from a CRM into SQLite')
  .requiredOption('--provider <name>', 'CRM provider name')
  .option('--dry-run', 'Preview import without writing to DB')
  .action(withDiagnostics(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', homedir()))
    const { runImport } = await import('../lib/qualification/importers')
    await runImport({
      config,
      source: opts.provider,
      input: opts.provider,
      dryRun: opts.dryRun ?? false,
    })
  }))

// ─── crm:push ───────────────────────────────────────────────────────────────
program
  .command('crm:push')
  .description('Push enriched leads from a result set to CRM')
  .requiredOption('--provider <name>', 'CRM provider name')
  .requiredOption('--result-set <id>', 'Result set ID to push')
  .option('--dry-run', 'Preview without writing to CRM')
  .action(withDiagnostics(async (opts) => {
    const { loadCrmConfig } = await import('../lib/crm/config-store')
    const { McpCrmAdapter } = await import('../lib/crm/mcp-crm-adapter')
    const { db } = await import('../lib/db')
    const { resultRows } = await import('../lib/db/schema')
    const { eq } = await import('drizzle-orm')
    const { existsSync, readFileSync } = await import('fs')
    const { join } = await import('path')
    const { homedir } = await import('os')
    const { validateMcpConfig, expandEnvVars } = await import('../lib/providers/mcp-loader')

    const crmConfig = loadCrmConfig(opts.provider)
    if (!crmConfig) {
      console.error(`No CRM config for "${opts.provider}". Run crm:setup first.`)
      process.exit(1)
    }

    // Load MCP config
    const mcpPaths = [
      join(homedir(), '.gtm-os', 'mcp', `${crmConfig.mcpServer}.json`),
      join(process.cwd(), 'configs', 'mcp', `${crmConfig.mcpServer}.json`),
    ]
    let mcpConfig = null
    for (const p of mcpPaths) {
      if (existsSync(p)) {
        try {
          const raw = JSON.parse(readFileSync(p, 'utf-8'))
          const v = validateMcpConfig(raw, `${crmConfig.mcpServer}.json`)
          if (v.valid) { mcpConfig = expandEnvVars(raw).result; break }
        } catch { continue }
      }
    }
    if (!mcpConfig) { console.error('MCP config not found'); process.exit(1) }

    // Load leads from result set
    const rows = await db
      .select()
      .from(resultRows)
      .where(eq(resultRows.resultSetId, opts.resultSet))

    if (rows.length === 0) {
      console.error(`No rows found in result set ${opts.resultSet}`)
      process.exit(1)
    }

    const leads = rows.map(r => JSON.parse(r.data as string) as Record<string, unknown>)
    console.log(`[crm:push] Pushing ${leads.length} leads to ${opts.provider}`)

    if (opts.dryRun) {
      console.log(`[crm:push] Dry run — would push ${leads.length} records`)
      return
    }

    const contactsMapping = crmConfig.objects['contacts']
    if (!contactsMapping) {
      console.error('No contacts mapping configured. Run crm:setup.')
      process.exit(1)
    }

    const adapter = new McpCrmAdapter(mcpConfig as any, crmConfig)
    try {
      await adapter.connect()
      const result = await adapter.pushContacts(leads, contactsMapping.fieldMapping)
      console.log(`\n  Created: ${result.created}`)
      console.log(`  Updated: ${result.updated}`)
      console.log(`  Skipped: ${result.skipped}`)
      if (result.errors.length > 0) {
        console.log(`  Errors:  ${result.errors.length}`)
        for (const err of result.errors.slice(0, 5)) {
          console.log(`    ${err.record}: ${err.message}`)
        }
      }
    } finally {
      await adapter.disconnect()
    }
  }))

// ─── crm:sync ───────────────────────────────────────────────────────────────
program
  .command('crm:sync')
  .description('Bidirectional sync between GTM-OS and CRM')
  .requiredOption('--provider <name>', 'CRM provider name')
  .option('--direction <dir>', 'push | pull | bidirectional', 'bidirectional')
  .option('--dry-run', 'Preview without writing')
  .action(withDiagnostics(async (opts) => {
    const { loadCrmConfig } = await import('../lib/crm/config-store')
    const { McpCrmAdapter } = await import('../lib/crm/mcp-crm-adapter')
    const { existsSync, readFileSync } = await import('fs')
    const { join } = await import('path')
    const { homedir } = await import('os')
    const { validateMcpConfig, expandEnvVars } = await import('../lib/providers/mcp-loader')

    const crmConfig = loadCrmConfig(opts.provider)
    if (!crmConfig) {
      console.error(`No CRM config for "${opts.provider}". Run crm:setup first.`)
      process.exit(1)
    }

    const mcpPaths = [
      join(homedir(), '.gtm-os', 'mcp', `${crmConfig.mcpServer}.json`),
      join(process.cwd(), 'configs', 'mcp', `${crmConfig.mcpServer}.json`),
    ]
    let mcpConfig = null
    for (const p of mcpPaths) {
      if (existsSync(p)) {
        try {
          const raw = JSON.parse(readFileSync(p, 'utf-8'))
          const v = validateMcpConfig(raw, `${crmConfig.mcpServer}.json`)
          if (v.valid) { mcpConfig = expandEnvVars(raw).result; break }
        } catch { continue }
      }
    }
    if (!mcpConfig) { console.error('MCP config not found'); process.exit(1) }

    if (opts.dryRun) {
      console.log(`[crm:sync] Dry run — would sync ${opts.direction} with ${opts.provider}`)
      return
    }

    const adapter = new McpCrmAdapter(mcpConfig as any, crmConfig)
    try {
      await adapter.connect()
      const result = await adapter.syncBidirectional!({
        direction: opts.direction,
        conflictResolution: 'newest_wins',
      })
      console.log(`\n  Pulled: ${result.pulled}`)
      console.log(`  Pushed: ${result.pushed}`)
      console.log(`  Conflicts: ${result.conflicts}`)
      if (result.errors.length > 0) {
        console.log(`  Errors: ${result.errors.length}`)
      }
    } finally {
      await adapter.disconnect()
    }
  }))

// ─── crm:status ─────────────────────────────────────────────────────────────
program
  .command('crm:status')
  .description('Show current CRM mapping and last sync time')
  .requiredOption('--provider <name>', 'CRM provider name')
  .action(async (opts) => {
    const { loadCrmConfig } = await import('../lib/crm/config-store')
    const crmConfig = loadCrmConfig(opts.provider)
    if (!crmConfig) {
      console.error(`No CRM config for "${opts.provider}". Run crm:setup first.`)
      process.exit(1)
    }

    console.log(`\n── CRM Status: ${crmConfig.provider} ──`)
    console.log(`  MCP server:  ${crmConfig.mcpServer}`)
    console.log(`  Last setup:  ${crmConfig.lastSetup}`)
    console.log(`  Last sync:   ${crmConfig.lastSync ?? 'never'}`)
    console.log(`  Version:     ${crmConfig.version}`)

    for (const [objName, objMapping] of Object.entries(crmConfig.objects)) {
      const fieldCount = Object.keys(objMapping.fieldMapping.gtmToCrm).length
      console.log(`\n  ${objName}:`)
      console.log(`    List tool:   ${objMapping.listTool}`)
      console.log(`    Create tool: ${objMapping.createTool}`)
      console.log(`    Fields:      ${fieldCount} mapped`)

      for (const [gtm, crm] of Object.entries(objMapping.fieldMapping.gtmToCrm)) {
        console.log(`      ${gtm.padEnd(20)} -> ${crm}`)
      }
    }
  })

// ─── crm:verify ─────────────────────────────────────────────────────────────
program
  .command('crm:verify')
  .description('Detect schema drift between saved CRM mapping and live MCP tools')
  .requiredOption('--provider <name>', 'CRM provider name')
  .action(withDiagnostics(async (opts) => {
    const { loadCrmConfig } = await import('../lib/crm/config-store')
    const { McpCrmAdapter } = await import('../lib/crm/mcp-crm-adapter')
    const { existsSync, readFileSync } = await import('fs')
    const { join } = await import('path')
    const { homedir } = await import('os')
    const { validateMcpConfig, expandEnvVars } = await import('../lib/providers/mcp-loader')

    const crmConfig = loadCrmConfig(opts.provider)
    if (!crmConfig) {
      console.error(`No CRM config for "${opts.provider}". Run crm:setup first.`)
      process.exit(1)
    }

    const mcpPaths = [
      join(homedir(), '.gtm-os', 'mcp', `${crmConfig.mcpServer}.json`),
      join(process.cwd(), 'configs', 'mcp', `${crmConfig.mcpServer}.json`),
    ]
    let mcpConfig = null
    for (const p of mcpPaths) {
      if (existsSync(p)) {
        try {
          const raw = JSON.parse(readFileSync(p, 'utf-8'))
          const v = validateMcpConfig(raw, `${crmConfig.mcpServer}.json`)
          if (v.valid) { mcpConfig = expandEnvVars(raw).result; break }
        } catch { continue }
      }
    }
    if (!mcpConfig) { console.error('MCP config not found'); process.exit(1) }

    console.log(`[crm:verify] Connecting to ${opts.provider}...`)
    const adapter = new McpCrmAdapter(mcpConfig as any, crmConfig)

    try {
      await adapter.connect()
      const drift = await adapter.detectDrift()

      if (drift.ok) {
        console.log(`\n  Schema is in sync.`)
        if (drift.missingInMapping.length > 0) {
          console.log(`  New CRM fields available: ${drift.missingInMapping.join(', ')}`)
          console.log(`  Run crm:setup --provider ${opts.provider} to add them.`)
        }
      } else {
        console.log(`\n  Schema drift detected:`)
        if (drift.missingInCrm.length > 0) {
          console.log(`  Missing in CRM: ${drift.missingInCrm.join(', ')}`)
        }
        if (drift.typeChanges.length > 0) {
          for (const tc of drift.typeChanges) {
            console.log(`  Type changed: ${tc.field} (${tc.expected} -> ${tc.actual})`)
          }
        }
        console.log(`\n  Run crm:setup --provider ${opts.provider} to re-map.`)
      }
    } finally {
      await adapter.disconnect()
    }
  }))

// ─── leads:qualify ──────────────────────────────────────────────────────────
program
  .command('leads:qualify')
  .description('Run 7-gate lead qualification pipeline')
  .option('--source <type>', 'Input source: csv, json, notion, visitors, engagers')
  .option('--input <path>', 'Path to input file or Notion DB ID')
  .option('--result-set <id>', 'Existing result set ID to qualify')
  .option('--dry-run', 'Preview qualification without writing results')
  .option('--no-dedup', 'Skip dedup gate entirely')
  .option('--slack-confirm', 'Enable Slack confirmation for ambiguous dedup matches')
  .action(withDiagnostics(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', homedir()))
    const { runQualify } = await import('../lib/qualification/pipeline')
    await runQualify({
      config,
      source: opts.source,
      input: opts.input,
      resultSetId: opts.resultSet,
      dryRun: opts.dryRun ?? false,
      noDedup: opts.noDedup === true || opts.dedup === false,
      slackConfirm: opts.slackConfirm ?? false,
    })
  }))

// ─── leads:import ───────────────────────────────────────────────────────────
program
  .command('leads:import')
  .description('Import leads into SQLite from external sources')
  .requiredOption('--source <type>', 'Source type: csv, json, notion, visitors')
  .requiredOption('--input <path>', 'Path to input file')
  .option('--dry-run', 'Preview import without writing to DB')
  .action(withDiagnostics(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', homedir()))
    const { runImport } = await import('../lib/qualification/importers')
    await runImport({ config, source: opts.source, input: opts.input, dryRun: opts.dryRun ?? false })
  }))

// ─── leads:dedup ────────────────────────────────────────────────────────────
program
  .command('leads:dedup')
  .description('Deduplicate a result set against campaigns, CRM, replied leads, and blocklist')
  .requiredOption('--result-set <id>', 'Result set ID to deduplicate')
  .option('--strategy <type>', 'Matcher strategy: exact, fuzzy, or all', 'all')
  .option('--slack-confirm', 'Send Slack confirmations for ambiguous matches')
  .action(withDiagnostics(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', homedir()))
    const { DedupEngine } = await import('../lib/dedup/engine')
    const { buildSuppressionSet } = await import('../lib/dedup/live-sync')
    const { sendConfirmation } = await import('../lib/dedup/slack-confirm')
    const { resultRows } = await import('../lib/db/schema')
    const { db } = await import('../lib/db')
    const { eq } = await import('drizzle-orm')

    const rows = await db.select().from(resultRows).where(eq(resultRows.resultSetId, opts.resultSet))
    const leads = rows.map(r => {
      const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
      return { id: r.id, ...(data as Record<string, unknown>) }
    })

    console.log(`[dedup] Loaded ${leads.length} leads from result set ${opts.resultSet}`)

    const suppressionSet = await buildSuppressionSet({
      includeCampaigns: true,
      includeReplied: true,
      includeBlocklist: true,
    })

    const enabledMatchers = opts.strategy === 'exact'
      ? ['email' as const, 'linkedin' as const]
      : opts.strategy === 'fuzzy'
        ? ['fuzzy_name_company' as const, 'domain_title' as const]
        : ['email' as const, 'linkedin' as const, 'fuzzy_name_company' as const, 'domain_title' as const]

    const engine = new DedupEngine({ enabledMatchers })
    const result = engine.dedup(leads, suppressionSet)

    console.log(`\n--- Dedup Results ---`)
    console.log(`Unique:         ${result.unique.length}`)
    console.log(`Duplicates:     ${result.duplicates.length}`)
    console.log(`Pending review: ${result.pendingReview.length}`)

    if (result.duplicates.length > 0) {
      console.log(`\nDuplicates:`)
      for (const { lead, match } of result.duplicates) {
        console.log(`  ${lead.first_name ?? ''} ${lead.last_name ?? ''} (${match.confidence}%) via ${match.matcher} -> ${match.matchedSource}`)
      }
    }

    if (result.pendingReview.length > 0 && opts.slackConfirm && config.slack?.webhook_url) {
      console.log(`\nSending Slack confirmations for ${result.pendingReview.length} ambiguous matches...`)
      for (const { lead, match } of result.pendingReview) {
        await sendConfirmation(lead, match, { webhookUrl: config.slack.webhook_url })
      }
    }
  }))

// ─── leads:suppress ─────────────────────────────────────────────────────────
program
  .command('leads:suppress')
  .description('Load a suppression list from external source')
  .requiredOption('--source <type>', 'Source type: hubspot, notion, csv')
  .option('--file <path>', 'Path to CSV suppression file')
  .action(withDiagnostics(async (opts) => {
    const { db } = await import('../lib/db')
    const { leadBlocklist } = await import('../lib/db/schema')
    const { randomUUID } = await import('crypto')

    let entries: Array<{ email?: string; linkedin_url?: string; name?: string; company?: string }> = []

    if (opts.source === 'csv' && opts.file) {
      const { readFileSync } = await import('fs')
      const raw = readFileSync(opts.file, 'utf-8')
      const lines = raw.split('\n').filter(l => l.trim())
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase())

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim())
        const record: Record<string, string> = {}
        headers.forEach((h, idx) => { record[h] = values[idx] ?? '' })
        entries.push({
          email: record.email || undefined,
          linkedin_url: record.linkedin_url || record.linkedin || undefined,
          name: record.name || `${record.first_name ?? ''} ${record.last_name ?? ''}`.trim() || undefined,
          company: record.company || undefined,
        })
      }
    } else if (opts.source === 'notion') {
      console.log('[suppress] Notion suppression import — use leads:import --source notion instead')
      return
    } else if (['hubspot', 'salesforce', 'pipedrive'].includes(opts.source)) {
      console.log(`[suppress] CRM suppression — use crm:import --provider ${opts.source} for full import`)
      return
    }

    console.log(`[suppress] Importing ${entries.length} suppression entries...`)

    let inserted = 0
    for (const entry of entries) {
      if (!entry.email && !entry.linkedin_url) continue
      await db.insert(leadBlocklist).values({
        id: randomUUID(),
        providerId: entry.email ?? entry.linkedin_url ?? undefined,
        linkedinUrl: entry.linkedin_url ?? undefined,
        name: entry.name ?? undefined,
        company: entry.company ?? undefined,
        scope: 'permanent',
        reason: `Imported from ${opts.source}`,
      })
      inserted++
    }

    console.log(`[suppress] Inserted ${inserted} entries into lead blocklist`)
  }))

// ─── notion:sync ────────────────────────────────────────────────────────────
program
  .command('notion:sync')
  .description('Bidirectional sync between SQLite and Notion')
  .option('--direction <dir>', 'push | pull | both', 'both')
  .option('--dry-run', 'Preview sync without writing')
  .action(withDiagnostics(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', homedir()))
    const { runSync } = await import('../lib/notion/sync')
    await runSync({ config, direction: opts.direction, dryRun: opts.dryRun ?? false })
  }))

// ─── notion:bootstrap ───────────────────────────────────────────────────────
program
  .command('notion:bootstrap')
  .description('Import existing campaigns, leads, and variants from Notion into SQLite')
  .option('--dry-run', 'Preview bootstrap without writing to DB')
  .action(withDiagnostics(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', homedir()))
    const { runBootstrap } = await import('../lib/notion/bootstrap')
    await runBootstrap({ config, dryRun: opts.dryRun ?? false })
  }))

// ─── campaign:dashboard ──────────────────────────────────────────────────────
program
  .command('campaign:dashboard')
  .description('Open campaign visualization dashboard in browser')
  .option('--port <port>', 'Server port', '3847')
  .action(async (opts) => {
    const { startServer } = await import('../lib/server/index')
    const port = parseInt(opts.port, 10)
    startServer(port)
    const { execFile } = await import('child_process')
    execFile('open', [`http://localhost:${port}/campaigns`])
  })

// ─── campaign:monthly-report ────────────────────────────────────────────────
program
  .command('campaign:monthly-report')
  .description('Generate cross-campaign monthly report')
  .option('--month <month>', 'Month in YYYY-MM format')
  .option('--open', 'Open dashboard in browser')
  .action(async (opts) => {
    const month = opts.month ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
    const { monthlyCampaignReportSkill } = await import('../lib/skills/builtin/monthly-campaign-report')
    const context = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => ({ id: 'mock', name: 'mock', execute: async function*() {} }) } as any,
      userId: 'default',
    }
    for await (const event of monthlyCampaignReportSkill.execute({ month }, context)) {
      if (event.type === 'progress') console.log(`[${event.percent}%] ${event.message}`)
      else if (event.type === 'error') console.error(`ERROR: ${event.message}`)
    }
    if (opts.open) {
      const { startServer } = await import('../lib/server/index')
      startServer(3847)
      const { execFile } = await import('child_process')
      if (!/^\d{4}-\d{2}$/.test(month)) { console.error('Invalid month format. Use YYYY-MM.'); process.exit(1) }
      execFile('open', [`http://localhost:3847/monthly-report?month=${month}`])
    }
  })

// ─── orchestrate ────────────────────────────────────────────────────────────
program
  .command('orchestrate')
  .description('Decompose a natural language GTM request into phased skill execution')
  .argument('<query>', 'Natural language request')
  .option('--auto-approve', 'Skip approval gates')
  .option('--dry-run', 'Preview orchestration without executing skills')
  .action(withDiagnostics(async (query: string, opts: any) => {
    const { orchestrateSkill } = await import('../lib/skills/builtin/orchestrate')
    const context = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => ({ id: 'mock', name: 'mock', execute: async function*() {} }) } as any,
      userId: 'default',
    }
    for await (const event of orchestrateSkill.execute({
      query,
      autoApprove: opts.autoApprove ?? false,
      dryRun: opts.dryRun ?? false,
    }, context)) {
      if (event.type === 'progress') console.log(`[${event.percent}%] ${event.message}`)
      else if (event.type === 'approval_needed') {
        console.log(`\n--- ${event.title} ---`)
        console.log(event.description)
        console.log('---\n')
      }
      else if (event.type === 'error') console.error(`ERROR: ${event.message}`)
      else if (event.type === 'result') console.log('\nResult:', JSON.stringify(event.data, null, 2))
    }
  }))

// ─── start ──────────────────────────────────────────────────────────────────
program
  .command('start')
  .description('Guided onboarding — API keys, company context, framework, and goals in one flow')
  .option('--non-interactive', 'Skip prompts (use env vars and defaults)')
  .action(withDiagnostics(async (opts) => {
    const { runStart } = await import('../lib/onboarding/start')
    await runStart({
      tenantId: getTenant(),
      nonInteractive: opts.nonInteractive ?? false,
    })
  }))

// ─── setup ──────────────────────────────────────────────────────────────────
program
  .command('setup')
  .description('Check API keys and provider connectivity')
  .option('--wizard', 'Interactive guided setup for first-time users')
  .action(withDiagnostics(async (opts) => {
    if (opts.wizard) {
      const { runSetupWizard } = await import('../lib/config/setup')
      await runSetupWizard()
    } else {
      const { runSetup } = await import('../lib/config/setup')
      await runSetup()
    }
  }))

// ─── onboard ────────────────────────────────────────────────────────────────
program
  .command('onboard')
  .description('Build GTM framework from LinkedIn profile, website, and docs')
  .option('--linkedin <url>', 'LinkedIn profile URL')
  .option('--website <url>', 'Company website URL')
  .option('--knowledge <paths...>', 'Paths to knowledge files (PDFs, docs)')
  .action(withDiagnostics(async (opts) => {
    const { buildProfile } = await import('../lib/onboarding/profile-builder')
    await buildProfile({ linkedin: opts.linkedin, website: opts.website, knowledge: opts.knowledge })
  }))

// ─── configure ──────────────────────────────────────────────────────────────
program
  .command('configure')
  .description('Set GTM goals and configure skills based on your framework')
  .action(withDiagnostics(async () => {
    const { loadFramework } = await import('../lib/framework/context')
    const { setGoals } = await import('../lib/onboarding/goal-setter')
    const { configureSkills } = await import('../lib/onboarding/skill-configurator')
    const framework = await loadFramework()
    if (!framework) {
      console.log('No framework found. Run "gtm-os onboard" first.')
      return
    }
    const goals = await setGoals(framework)
    await configureSkills(framework, goals)
  }))

// ─── test-run ───────────────────────────────────────────────────────────────
program
  .command('test-run')
  .description('Run a test batch: find → enrich → qualify → review')
  .option('--count <n>', 'Number of test leads', '10')
  .action(withDiagnostics(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', homedir()))
    const { runTestBatch } = await import('../lib/execution/test-runner')
    await runTestBatch(config, parseInt(opts.count, 10))
  }))

// ─── leads:find-linkedin ────────────────────────────────────────────────────
program
  .command('leads:find-linkedin')
  .description('Find LinkedIn profile URLs from a CSV of names + emails')
  .requiredOption('--input <path>', 'Path to CSV file (columns: email, first_name, last_name OR name)')
  .option('--output <path>', 'Output CSV path (default: prints to stdout)')
  .option('--dry-run', 'Show what would be searched without spending credits')
  .action(withDiagnostics(async (opts) => {
    const { readFileSync, writeFileSync } = await import('fs')
    const content = readFileSync(opts.input, 'utf-8')
    const lines = content.trim().split('\n')
    if (lines.length < 2) {
      console.error('CSV must have a header row and at least one data row.')
      process.exit(1)
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''))
    const leads = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/"/g, ''))
      const row: Record<string, string> = {}
      headers.forEach((h, i) => { row[h] = values[i] ?? '' })
      return row
    }).filter(r => r.email)

    console.log(`[find-linkedin] Parsed ${leads.length} leads from ${opts.input}`)

    if (opts.dryRun) {
      const domains = new Set(leads.map(l => l.email.split('@')[1]).filter(Boolean))
      console.log(`[find-linkedin] Would search ${domains.size} company domains`)
      console.log(`[find-linkedin] Estimated cost: ~${Math.max(3, domains.size * 3)} Crustdata credits`)
      return
    }

    const { findLinkedinSkill } = await import('../lib/skills/builtin/find-linkedin')
    const { ProviderRegistry } = await import('../lib/providers/registry')
    const registry = new ProviderRegistry()

    const context = {
      framework: null as unknown as import('../lib/framework/types').GTMFramework,
      intelligence: [],
      providers: registry,
      userId: 'cli',
    }

    const events = findLinkedinSkill.execute({ leads }, context)
    let result: { resolved: Array<Record<string, string>>; stats: Record<string, number> } | null = null

    for await (const event of events) {
      if (event.type === 'progress') {
        console.log(`[find-linkedin] ${event.message}`)
      } else if (event.type === 'error') {
        console.error(`[find-linkedin] ERROR: ${event.message}`)
        process.exit(1)
      } else if (event.type === 'result') {
        result = event.data as { resolved: Array<Record<string, string>>; stats: Record<string, number> }
      }
    }

    if (!result) {
      console.error('[find-linkedin] No results returned.')
      process.exit(1)
    }

    // Output
    const csvHeader = 'email,name,company,linkedin_url,confidence,match_reason'
    const csvRows = result.resolved.map((r: Record<string, string>) =>
      `"${r.email}","${r.name}","${r.company}","${r.linkedin_url}","${r.confidence}","${(r.match_reason ?? '').replace(/"/g, "'")}"`,
    )
    const csvOutput = [csvHeader, ...csvRows].join('\n')

    if (opts.output) {
      writeFileSync(opts.output, csvOutput + '\n')
      console.log(`[find-linkedin] Results written to ${opts.output}`)
    } else {
      console.log('\n' + csvOutput)
    }

    console.log(`\n[find-linkedin] Stats: ${JSON.stringify(result.stats)}`)
  }))

// ─── results:review ─────────────────────────────────────────────────────────
program
  .command('results:review')
  .description('Review and provide feedback on qualification results')
  .requiredOption('--result-set <id>', 'Result set ID to review')
  .action(async (opts) => {
    const { collectFeedback } = await import('../lib/execution/feedback-collector')
    await collectFeedback(opts.resultSet)
  })

// ─── agent:create ─────────────────────────────────────────────────────────
program
  .command('agent:create')
  .description('Interactively create a new background agent config')
  .action(async () => {
    const { runAgentCreate } = await import('./commands/agent-create')
    await runAgentCreate()
  })

// ─── agent:run ─────────────────────────────────────────────────────────────
program
  .command('agent:run')
  .description('Run a background agent immediately')
  .requiredOption('--agent <id>', 'Agent ID to run')
  .option('--post-url <url>', 'LinkedIn post URL (for linkedin scraper agent)')
  .action(async (opts) => {
    const { BackgroundAgent } = await import('../lib/agents/runner')
    const { loadAgentFromYaml } = await import('../lib/agents/yaml-loader')

    let config

    // Try built-in agents first
    if (opts.agent === 'daily-linkedin-scraper') {
      if (!opts.postUrl) {
        console.error('Error: --post-url required for daily-linkedin-scraper agent')
        process.exit(1)
      }
      const { createDailyLinkedinScraperConfig } = await import('../lib/agents/examples/daily-linkedin-scraper')
      config = createDailyLinkedinScraperConfig(opts.postUrl)
    } else {
      // Try YAML config
      config = loadAgentFromYaml(opts.agent)
      if (!config) {
        const { listYamlAgents } = await import('../lib/agents/yaml-loader')
        const available = ['daily-linkedin-scraper', ...listYamlAgents()]
        console.error(`Unknown agent: ${opts.agent}. Available: ${available.join(', ')}`)
        process.exit(1)
      }
    }

    const agent = new BackgroundAgent(config)
    const log = await agent.run()
    console.log(`\nAgent run complete: ${log.status}`)
    console.log(`  Steps: ${log.steps.length}`)
    console.log(`  Duration: ${new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()}ms`)
  })

// ─── agent:install ─────────────────────────────────────────────────────────
program
  .command('agent:install')
  .description('Install a background agent as a launchd service')
  .requiredOption('--agent <id>', 'Agent ID to install')
  .option('--hour <n>', 'Hour to run (0-23)', '8')
  .option('--minute <n>', 'Minute to run (0-59)', '0')
  .action(async (opts) => {
    const { execSync } = await import('child_process')
    const { join } = await import('path')
    const scriptPath = join(process.cwd(), 'scripts', 'install-agent.sh')
    try {
      const output = execSync(`bash "${scriptPath}" "${opts.agent.replace(/[^a-zA-Z0-9_-]/g, '')}" "${String(parseInt(opts.hour, 10))}" "${String(parseInt(opts.minute, 10))}"`, { encoding: 'utf-8' })
      console.log(output)
    } catch (err) {
      console.error('Installation failed:', err instanceof Error ? err.message : err)
    }
  })

// ─── agent:list ────────────────────────────────────────────────────────────
program
  .command('agent:list')
  .description('List installed background agents with last run status')
  .action(async () => {
    const { readdirSync, existsSync } = await import('fs')
    const { join } = await import('path')
    const { homedir } = await import('os')
    const { AgentLogger } = await import('../lib/agents/logger')

    const logBase = join(homedir(), '.gtm-os', 'logs', 'agents')
    if (!existsSync(logBase)) {
      console.log('No agents have been run yet.')
      return
    }

    const agents = readdirSync(logBase, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    if (agents.length === 0) {
      console.log('No agents found.')
      return
    }

    console.log('\n── Background Agents ──')
    for (const agentId of agents) {
      const lastRun = AgentLogger.getLastRun(agentId)
      if (lastRun) {
        const duration = new Date(lastRun.completedAt).getTime() - new Date(lastRun.startedAt).getTime()
        console.log(`  ${agentId.padEnd(30)} ${lastRun.status.padEnd(10)} ${lastRun.completedAt.slice(0, 16)} (${duration}ms)`)
      } else {
        console.log(`  ${agentId.padEnd(30)} never run`)
      }
    }
  })

// ─── update ─────────────────────────────────────────────────────────────────
program
  .command('update')
  .description('Pull latest YALC updates without breaking your config')
  .action(async () => {
    const { runUpdate } = await import('./commands/update')
    await runUpdate()
  })

// ─── doctor ────────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Run full system health check across all 5 diagnostic layers')
  .option('--report', 'Save a diagnostic report file (no secrets) for bug reports')
  .action(async (opts) => {
    const { runDoctor } = await import('../lib/diagnostics/doctor')
    await runDoctor({ report: opts.report })
  })

// ─── skills:browse ────────────────────────────────────────────────────────
program
  .command('skills:browse')
  .description('Browse available community skills from the marketplace')
  .option('--category <category>', 'Filter by category (research, content, outreach, analysis, data, integration)')
  .option('--installed', 'Show only locally installed skills')
  .action(withDiagnostics(async (opts) => {
    if (opts.installed) {
      const { loadCommunitySkills } = await import('../lib/marketplace/loader')
      const skills = await loadCommunitySkills()
      if (skills.length === 0) {
        console.log('No community skills installed. Run `gtm-os skills:search <query>` to find skills.')
        return
      }
      console.log(`\n── Installed Community Skills (${skills.length}) ──\n`)
      for (const s of skills) {
        console.log(`  ${s.id.padEnd(30)} ${s.version.padEnd(8)} ${s.category.padEnd(12)} ${s.description}`)
      }
      return
    }

    const { MarketplaceRegistry } = await import('../lib/marketplace/registry')
    const marketplace = new MarketplaceRegistry()
    const results = await marketplace.browse(opts.category)

    if (results.length === 0) {
      console.log('No skills found. Try a different category.')
      return
    }

    console.log(`\n── Marketplace Skills (${results.length}) ──\n`)
    for (const s of results) {
      const stars = s.downloads ? `★ ${s.downloads}` : ''
      console.log(`  ${s.id.padEnd(30)} ${s.author.padEnd(16)} ${stars.padEnd(8)} ${s.description.slice(0, 60)}`)
    }
    console.log(`\nInstall with: gtm-os skills:install --github <owner>/<repo>`)
  }))

// ─── skills:search ────────────────────────────────────────────────────────
program
  .command('skills:search <query>')
  .description('Search the marketplace for community skills')
  .action(withDiagnostics(async (query: string) => {
    const { MarketplaceRegistry } = await import('../lib/marketplace/registry')
    const marketplace = new MarketplaceRegistry()
    const results = await marketplace.search(query)

    if (results.length === 0) {
      console.log(`No skills found for "${query}".`)
      return
    }

    console.log(`\n── Search Results for "${query}" (${results.length}) ──\n`)
    for (const s of results) {
      const stars = s.downloads ? `★ ${s.downloads}` : ''
      console.log(`  ${s.id.padEnd(30)} ${s.author.padEnd(16)} ${stars.padEnd(8)} ${s.description.slice(0, 60)}`)
    }
    console.log(`\nInstall with: gtm-os skills:install --github <owner>/<repo>`)
  }))

// ─── skills:create ───────────────────────────────────────────────────────
program
  .command('skills:create')
  .description('Create a new skill interactively')
  .option('--format <format>', 'Skill format: markdown or typescript', 'markdown')
  .action(async (opts) => {
    if (opts.format === 'markdown') {
      const { runSkillsCreate } = await import('./commands/skills-create')
      await runSkillsCreate()
    } else {
      console.log('Only --format markdown is supported. TypeScript skills are created manually in src/lib/skills/builtin/.')
    }
  })

// ─── skills:install ───────────────────────────────────────────────────────
program
  .command('skills:install')
  .description('Install a community skill from GitHub or a local path')
  .option('--github <repo>', 'GitHub repo (e.g., user/gtm-os-skill-sdr-cadence)')
  .option('--local <path>', 'Local directory containing skill.json')
  .option('--ref <ref>', 'Git ref to install from (default: main)')
  .action(withDiagnostics(async (opts) => {
    if (!opts.github && !opts.local) {
      console.error('Specify --github <owner/repo> or --local <path>')
      process.exit(1)
    }

    const { MarketplaceRegistry } = await import('../lib/marketplace/registry')
    const marketplace = new MarketplaceRegistry()

    const source = opts.github
      ? { type: 'github' as const, repo: opts.github, ref: opts.ref }
      : { type: 'local' as const, path: opts.local }

    console.log(`Installing skill from ${opts.github ?? opts.local}...`)
    const result = await marketplace.install(source)

    if (result.success) {
      console.log(`\n✓ ${result.message}`)
      console.log(`  Path: ${result.installPath}`)
      console.log(`\nThe skill is now available. Run \`gtm-os skills:browse --installed\` to verify.`)
    } else {
      console.error(`\n✗ Installation failed: ${result.message}`)
      process.exit(1)
    }
  }))

// ─── skills:info ──────────────────────────────────────────────────────────
program
  .command('skills:info <skillId>')
  .description('Show detailed info about an installed or built-in skill')
  .action(withDiagnostics(async (skillId: string) => {
    const { getSkillRegistryReady } = await import('../lib/skills/registry')
    const registry = await getSkillRegistryReady()
    const skill = registry.get(skillId)

    if (!skill) {
      console.error(`Skill "${skillId}" not found. Run \`gtm-os skills:browse --installed\` to see installed skills.`)
      process.exit(1)
    }

    console.log(`\n── ${skill.name} ──`)
    console.log(`  ID:          ${skill.id}`)
    console.log(`  Version:     ${skill.version}`)
    console.log(`  Category:    ${skill.category}`)
    console.log(`  Description: ${skill.description}`)
    if (skill.requiredCapabilities.length > 0) {
      console.log(`  Requires:    ${skill.requiredCapabilities.join(', ')}`)
    }
    if (skill.estimatedCost) {
      console.log(`  Est. Cost:   ~$${skill.estimatedCost({})} per run`)
    }
    console.log(`\n  Input Schema:`)
    console.log(`  ${JSON.stringify(skill.inputSchema, null, 2).split('\n').join('\n  ')}`)
  }))

// ─── Phase 1 — memory + context commands ────────────────────────────────────

// tenant:onboard — multi-tenant native onboarding path (Phase 1 / D1).
// Kept separate from the legacy 'onboard' command so existing workflows
// that rely on profile-builder keep working.
program
  .command('tenant:onboard')
  .description('Onboard a tenant. Interactive interview + optional website scrape + file upload.')
  .option('--adapter <id>', 'Skip the interview and run a context adapter instead (e.g. markdown-folder)')
  .option('--no-scrape', 'Disable the automatic website scrape in interview mode')
  .option('--dry-run', 'Ingest and derive but do not write the framework YAML')
  .action(withDiagnostics(async (opts) => {
    const tenantId = getTenant()
    if (opts.adapter) {
      // Adapter-only path: run the specified adapter, then derive framework.
      await import('../lib/context/adapters/index.js') // bootstrap registry
      const { getAdapter } = await import('../lib/context/adapters/registry.js')
      const adapter = getAdapter(opts.adapter)
      if (!adapter) {
        console.error(`Adapter "${opts.adapter}" is not registered.`)
        process.exit(1)
      }
      if (!(await adapter.isAvailable(tenantId))) {
        console.error(
          `Adapter "${opts.adapter}" is not available for tenant "${tenantId}". ` +
            `Check ~/.gtm-os/tenants/${tenantId}/adapters.yaml.`,
        )
        process.exit(1)
      }
      console.log(`[onboard][${tenantId}] running adapter ${opts.adapter}`)
      const result = await adapter.sync(tenantId)
      console.log(
        `[onboard][${tenantId}] +${result.added} ~${result.updated} -${result.removed} =${result.unchanged}`,
      )
    } else {
      const { runOnboarding } = await import('../lib/context/onboarding.js')
      const report = await runOnboarding({
        tenantId,
        scrapeWebsite: opts.scrape !== false,
      })
      console.log(
        `[onboard][${tenantId}] interview=${report.interviewAnswers} website=${report.websiteChunks} uploads=${report.uploadChunks}`,
      )
    }

    // Derive framework as the final step (skipped with --dry-run).
    if (!opts.dryRun) {
      console.log(`[onboard][${tenantId}] deriving framework from memory…`)
      const { deriveFramework } = await import('../lib/framework/derive.js')
      const r = await deriveFramework(tenantId)
      console.log(
        `[onboard][${tenantId}] framework derived (nodes=${r.nodesConsidered}, interview=${r.interviewAnswersUsed})`,
      )
    }
  }))

// memory:retrieve
program
  .command('memory:retrieve')
  .description('Run the hybrid RRF retrieval pipeline against the tenant memory')
  .requiredOption('--query <text>', 'Natural-language query')
  .option('--top-k <n>', 'Top K results to return', '12')
  .option('--no-entity-extraction', 'Skip Claude entity extraction')
  .option('--no-embeddings', 'Keyword-only retrieval (skip embeddings)')
  .action(withDiagnostics(async (opts) => {
    const tenantId = getTenant()
    const { MemoryStore } = await import('../lib/memory/store.js')
    const { retrieve } = await import('../lib/memory/retrieve.js')
    const store = new MemoryStore(tenantId)
    const results = await retrieve(store, {
      query: opts.query,
      topK: parseInt(opts.topK, 10),
      skipEntityExtraction: opts.entityExtraction === false,
      skipEmbeddings: opts.embeddings === false,
    })
    if (results.length === 0) {
      console.log(`[memory:retrieve][${tenantId}] no relevant nodes`)
      return
    }
    for (const r of results) {
      console.log(
        `\n── score=${r.score.toFixed(4)} conf=${r.node.confidence} type=${r.node.type}`,
      )
      console.log(`   id: ${r.node.id}`)
      console.log(`   source: ${r.node.sourceRef}`)
      const preview =
        r.node.content.length > 200 ? `${r.node.content.slice(0, 200)}\u2026` : r.node.content
      console.log(`   content: ${preview.replace(/\n/g, ' ')}`)
    }
  }))

// memory:dream
program
  .command('memory:dream')
  .description('Run the memory lifecycle pass (generation, cluster, promote, archive, index)')
  .option('--incremental', 'Skip the Claude index rebuild')
  .option('--offline', 'Skip any external API call')
  .action(withDiagnostics(async (opts) => {
    const tenantId = getTenant()
    const { dream } = await import('../lib/memory/dream.js')
    const report = await dream(tenantId, {
      incremental: opts.incremental ?? false,
      offline: opts.offline ?? false,
    })
    console.log(JSON.stringify(report, null, 2))
  }))

// memory:index
program
  .command('memory:index')
  .description('Rebuild the MEMORY.md-style pointer index for the tenant')
  .action(withDiagnostics(async () => {
    const tenantId = getTenant()
    const { rebuildIndex } = await import('../lib/memory/index-builder.js')
    const entries = await rebuildIndex(tenantId)
    console.log(`[memory:index][${tenantId}] wrote ${entries.length} entries`)
  }))

// context:sync
program
  .command('context:sync')
  .description('Run all available context adapters for the tenant once')
  .option('--adapter <id>', 'Only run one specific adapter')
  .action(withDiagnostics(async (opts) => {
    const tenantId = getTenant()
    await import('../lib/context/adapters/index.js') // bootstrap registry
    const { listAvailableAdapters, getAdapter } = await import(
      '../lib/context/adapters/registry.js'
    )
    const list = opts.adapter
      ? ((): any[] => {
          const a = getAdapter(opts.adapter)
          return a ? [a] : []
        })()
      : await listAvailableAdapters(tenantId)
    if (list.length === 0) {
      console.log(`[context:sync][${tenantId}] no adapters available`)
      return
    }
    for (const adapter of list) {
      if (!(await adapter.isAvailable(tenantId))) {
        console.log(`[context:sync][${tenantId}][${adapter.id}] unavailable \u2014 skipping`)
        continue
      }
      const result = await adapter.sync(tenantId)
      console.log(
        `[context:sync][${tenantId}][${adapter.id}] +${result.added} ~${result.updated} -${result.removed} =${result.unchanged}`,
      )
    }
  }))

// context:watch
program
  .command('context:watch')
  .description('Run all tenant context adapters as a long-lived daemon (SIGINT to stop)')
  .action(withDiagnostics(async () => {
    const tenantId = getTenant()
    await import('../lib/context/adapters/index.js') // bootstrap registry
    const { runWatcherDaemon } = await import('../lib/context/watcher-daemon.js')
    await runWatcherDaemon({ tenantId })
  }))

// framework:derive
program
  .command('framework:derive')
  .description('Derive the tenant GTMFramework from current memory state')
  .action(withDiagnostics(async () => {
    const tenantId = getTenant()
    const { deriveFramework } = await import('../lib/framework/derive.js')
    const r = await deriveFramework(tenantId)
    console.log(
      `[framework:derive][${tenantId}] nodes=${r.nodesConsidered} interview=${r.interviewAnswersUsed} onboardingComplete=${r.framework.onboardingComplete}`,
    )
  }))

// ─── provider:list ─────────────────────────────────────────────────────────
program
  .command('provider:list')
  .description('List all providers (builtin + MCP) with status')
  .action(withDiagnostics(async () => {
    const { getRegistryReady } = await import('../lib/providers/registry')
    const registry = await getRegistryReady()
    const all = registry.getAll()

    if (all.length === 0) {
      console.log('No providers registered.')
      return
    }

    const builtins = all.filter(p => p.type !== 'mcp')
    const mcps = all.filter(p => p.type === 'mcp')

    console.log('\n── Builtin Providers ──\n')
    for (const p of builtins) {
      const statusTag = p.status === 'active' ? 'OK' : p.status.toUpperCase()
      console.log(`  ${p.id.padEnd(24)} [${statusTag.padEnd(12)}] ${p.capabilities.join(', ').padEnd(28)} ${p.description}`)
    }

    if (mcps.length > 0) {
      console.log('\n── MCP Providers ──\n')
      for (const p of mcps) {
        const statusTag = p.status === 'active' ? 'OK' : p.status.toUpperCase()
        console.log(`  ${p.id.padEnd(24)} [${statusTag.padEnd(12)}] ${p.capabilities.join(', ').padEnd(28)} ${p.name}`)
      }
    } else {
      console.log('\n  No MCP providers loaded. Drop configs into ~/.gtm-os/mcp/ or run: provider:add --mcp <name>')
    }

    console.log(`\n  Total: ${all.length} providers (${builtins.length} builtin, ${mcps.length} MCP)\n`)
  }))

// ─── provider:add ──────────────────────────────────────────────────────────
program
  .command('provider:add')
  .description('Add an MCP provider from a template config')
  .requiredOption('--mcp <name>', 'Template name (hubspot, apollo, peopledatalabs, zoominfo)')
  .action(withDiagnostics(async (opts) => {
    const { existsSync, copyFileSync, mkdirSync, readFileSync } = await import('fs')
    const { join } = await import('path')
    const { homedir } = await import('os')

    const templateDir = join(process.cwd(), 'configs', 'mcp')
    const targetDir = join(homedir(), '.gtm-os', 'mcp')

    const templatePath = join(templateDir, `${opts.mcp}.json`)
    const targetPath = join(targetDir, `${opts.mcp}.json`)

    if (!existsSync(templatePath)) {
      const { readdirSync } = await import('fs')
      const available = existsSync(templateDir)
        ? readdirSync(templateDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
        : []
      console.error(`Template "${opts.mcp}" not found. Available: ${available.join(', ') || 'none'}`)
      process.exit(1)
    }

    if (existsSync(targetPath)) {
      console.log(`Config already exists at ${targetPath}. Edit it directly or remove first.`)
      return
    }

    mkdirSync(targetDir, { recursive: true })
    copyFileSync(templatePath, targetPath)

    // Parse to show env vars that need to be set
    const config = JSON.parse(readFileSync(targetPath, 'utf-8'))
    const envVars: string[] = []
    const jsonStr = JSON.stringify(config)
    const matches = jsonStr.matchAll(/\$\{([^}]+)\}/g)
    for (const match of matches) {
      if (!envVars.includes(match[1])) envVars.push(match[1])
    }

    console.log(`\nCopied ${opts.mcp} config to ${targetPath}`)

    if (envVars.length > 0) {
      console.log('\nRequired environment variables:')
      for (const v of envVars) {
        const isSet = process.env[v] ? 'SET' : 'NOT SET'
        console.log(`  ${v}: ${isSet}`)
      }
      console.log('\nAdd them to your .env.local or export them before running GTM-OS.')
    }

    console.log('\nVerify with: npx tsx src/cli/index.ts provider:test ' + opts.mcp)
  }))

// ─── provider:test ─────────────────────────────────────────────────────────
program
  .command('provider:test <name>')
  .description('Run health check for a specific provider')
  .action(withDiagnostics(async (name: string) => {
    const { getRegistryReady } = await import('../lib/providers/registry')
    const registry = await getRegistryReady()
    const all = registry.getAll()

    // Find provider by id or name
    const match = all.find(p => p.id === name || p.id === `mcp:${name}` || p.name.toLowerCase() === name.toLowerCase())
    if (!match) {
      console.error(`Provider "${name}" not found. Run provider:list to see available providers.`)
      process.exit(1)
    }

    console.log(`\nTesting provider: ${match.name} (${match.id})`)
    console.log(`  Type:         ${match.type}`)
    console.log(`  Capabilities: ${match.capabilities.join(', ')}`)
    console.log(`  Status:       ${match.status}`)

    // Try to run healthCheck if available
    const step = { stepType: match.capabilities[0] ?? 'search', provider: match.id }
    try {
      const executor = registry.resolve(step)
      if (executor.healthCheck) {
        console.log('\n  Running health check...')
        const result = await executor.healthCheck()
        console.log(`  Result: ${result.ok ? 'PASS' : 'FAIL'} — ${result.message}`)

        // Show discovered tools for MCP providers
        if (match.type === 'mcp') {
          const { McpProviderAdapter } = await import('../lib/providers/mcp-adapter')
          if (executor instanceof McpProviderAdapter) {
            const tools = executor.getDiscoveredTools()
            if (tools.length > 0) {
              console.log(`\n  Discovered tools (${tools.length}):`)
              for (const t of tools.slice(0, 20)) {
                console.log(`    - ${t.name}${t.description ? `: ${t.description.slice(0, 60)}` : ''}`)
              }
              if (tools.length > 20) {
                console.log(`    ... and ${tools.length - 20} more`)
              }
            }
          }
        }
      } else {
        console.log(`\n  No health check defined. Provider is ${executor.isAvailable() ? 'available' : 'unavailable'}.`)
      }
    } catch (err) {
      console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}`)
    }

    console.log('')
  }))

// ─── provider:remove ───────────────────────────────────────────────────────
program
  .command('provider:remove <name>')
  .description('Remove an MCP provider config')
  .action(async (name: string) => {
    const { existsSync, unlinkSync } = await import('fs')
    const { join } = await import('path')
    const { homedir } = await import('os')

    const configPath = join(homedir(), '.gtm-os', 'mcp', `${name}.json`)

    if (!existsSync(configPath)) {
      console.error(`No MCP config found at ${configPath}`)
      process.exit(1)
    }

    unlinkSync(configPath)
    console.log(`Removed MCP provider config: ${configPath}`)
    console.log('The provider will not load on next CLI invocation.')
  })

// ─── pipeline:run ──────────────────────────────────────────────────────────
program
  .command('pipeline:run')
  .description('Execute a declarative YAML pipeline')
  .requiredOption('--file <path>', 'Path to pipeline YAML file')
  .option('--dry-run', 'Validate and show execution plan without running')
  .action(withDiagnostics(async (opts) => {
    const { executePipeline } = await import('../lib/orchestrator/chain')
    const context = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => ({ id: 'mock', name: 'mock', execute: async function*() {} }) } as any,
      userId: 'default',
    }

    for await (const event of executePipeline({ file: opts.file, dryRun: opts.dryRun ?? false }, context)) {
      if (event.type === 'progress') console.log(`[${event.percent}%] ${event.message}`)
      else if (event.type === 'error') console.error(`ERROR: ${event.message}`)
      else if (event.type === 'result') console.log('\nResult:', JSON.stringify(event.data, null, 2))
      else if (event.type === 'step_complete') {
        const step = (event as any).data
        if (step.status === 'skipped') console.log(`  -> skipped: ${step.skippedReason}`)
        else if (step.status === 'completed') console.log(`  -> completed in ${step.duration}ms`)
      }
    }
  }))

// ─── pipeline:list ─────────────────────────────────────────────────────────
program
  .command('pipeline:list')
  .description('List available pipelines from ~/.gtm-os/pipelines/ and configs/pipelines/')
  .action(async () => {
    const { listPipelines } = await import('../lib/orchestrator/chain')
    const pipelines = listPipelines()

    if (pipelines.length === 0) {
      console.log('No pipelines found. Create one with: pipeline:create')
      console.log('  Or add YAML files to ~/.gtm-os/pipelines/ or configs/pipelines/')
      return
    }

    console.log(`\n── Pipelines (${pipelines.length}) ──\n`)
    for (const p of pipelines) {
      console.log(`  ${p.name.padEnd(30)} ${String(p.steps).padEnd(4)} steps  ${p.description}`)
      console.log(`    ${p.file}`)
    }
  })

// ─── pipeline:resume ───────────────────────────────────────────────────────
program
  .command('pipeline:resume')
  .description('Resume a failed or interrupted pipeline from its last checkpoint')
  .requiredOption('--name <name>', 'Pipeline name to resume')
  .action(withDiagnostics(async (opts) => {
    const { loadCheckpoint, executePipeline } = await import('../lib/orchestrator/chain')
    const checkpoint = loadCheckpoint(opts.name)

    if (!checkpoint) {
      console.error(`No checkpoint found for pipeline "${opts.name}".`)
      console.error(`Run pipeline:status --name "${opts.name}" to check, or pipeline:run --file <yaml> to start fresh.`)
      process.exit(1)
    }

    if (checkpoint.status === 'completed') {
      console.log(`Pipeline "${opts.name}" already completed at ${checkpoint.updatedAt}.`)
      return
    }

    const resumeStep = checkpoint.currentStep
    console.log(`Resuming pipeline "${opts.name}" from step ${resumeStep}...`)

    const context = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => ({ id: 'mock', name: 'mock', execute: async function*() {} }) } as any,
      userId: 'default',
    }

    for await (const event of executePipeline({
      file: checkpoint.pipelineFile,
      resumeFrom: resumeStep,
    }, context)) {
      if (event.type === 'progress') console.log(`[${event.percent}%] ${event.message}`)
      else if (event.type === 'error') console.error(`ERROR: ${event.message}`)
      else if (event.type === 'result') console.log('\nResult:', JSON.stringify(event.data, null, 2))
      else if (event.type === 'step_complete') {
        const step = (event as any).data
        if (step.status === 'skipped') console.log(`  -> skipped: ${step.skippedReason}`)
        else if (step.status === 'completed') console.log(`  -> completed in ${step.duration}ms`)
      }
    }
  }))

// ─── pipeline:status ───────────────────────────────────────────────────────
program
  .command('pipeline:status')
  .description('Show current state of a running, failed, or completed pipeline')
  .requiredOption('--name <name>', 'Pipeline name')
  .action(async (opts) => {
    const { getPipelineStatus } = await import('../lib/orchestrator/chain')
    const status = getPipelineStatus(opts.name)

    if (!status) {
      console.log(`No state found for pipeline "${opts.name}".`)
      return
    }

    console.log(`\n── Pipeline: ${status.pipelineName} ──`)
    console.log(`  Status:     ${status.status}`)
    console.log(`  Started:    ${status.startedAt}`)
    console.log(`  Updated:    ${status.updatedAt}`)
    console.log(`  Current:    step ${status.currentStep}`)
    console.log(`  Completed:  [${status.completedSteps.join(', ')}]`)
    console.log(`  File:       ${status.pipelineFile}`)
    if (status.error) {
      console.log(`  Error:      ${status.error}`)
    }

    const resultKeys = Object.keys(status.stepResults)
    if (resultKeys.length > 0) {
      console.log(`\n  Step results: ${resultKeys.join(', ')}`)
    }

    if (status.status === 'failed') {
      console.log(`\n  Resume with: npx tsx src/cli/index.ts pipeline:resume --name "${status.pipelineName}"`)
    }
  })

// ─── pipeline:create ───────────────────────────────────────────────────────
program
  .command('pipeline:create')
  .description('Create a new pipeline YAML from a template')
  .requiredOption('--name <name>', 'Pipeline name')
  .option('--output <path>', 'Output path (default: ~/.gtm-os/pipelines/<name>.yaml)')
  .action(async (opts) => {
    const { existsSync, writeFileSync, mkdirSync } = await import('fs')
    const { join } = await import('path')
    const { homedir } = await import('os')
    const yaml = (await import('js-yaml')).default

    const pipelinesDir = join(homedir(), '.gtm-os', 'pipelines')
    mkdirSync(pipelinesDir, { recursive: true })

    const outputPath = opts.output ?? join(pipelinesDir, `${opts.name}.yaml`)
    if (existsSync(outputPath)) {
      console.error(`File already exists: ${outputPath}`)
      process.exit(1)
    }

    const template = {
      name: opts.name,
      description: 'TODO: describe this pipeline',
      version: '1.0',
      steps: [
        {
          skill: 'find-companies',
          input: { query: 'TODO: your search query' },
          output: 'companies',
        },
        {
          skill: 'enrich-leads',
          from: 'companies',
          condition: 'domain exists',
          output: 'enriched',
        },
      ],
    }

    writeFileSync(outputPath, yaml.dump(template, { lineWidth: 120 }))
    console.log(`Pipeline created: ${outputPath}`)
    console.log(`Edit the YAML, then run: npx tsx src/cli/index.ts pipeline:run --file "${outputPath}" --dry-run`)
  })

// ─── signals:watch ──────────────────────────────────────────────────────────
program
  .command('signals:watch')
  .description('Add companies or people to the signal watch list')
  .requiredOption('--companies <domains>', 'Comma-separated company domains')
  .option('--types <types>', 'Signal types to detect (default: all)', 'job-change,hiring-surge,funding,news')
  .option('--force', 'Skip credit budget warning')
  .action(withDiagnostics(async (opts) => {
    const { addWatch, listWatches, estimateDailyCreditCost, ALL_SIGNAL_TYPES } = await import('../lib/signals')
    const tenantId = getTenant()
    const domains = (opts.companies as string).split(',').map(d => d.trim()).filter(Boolean)
    const types = (opts.types as string).split(',').map(t => t.trim()) as import('../lib/signals').SignalType[]

    // Validate signal types
    for (const t of types) {
      if (!ALL_SIGNAL_TYPES.includes(t)) {
        console.error(`Invalid signal type: "${t}". Valid: ${ALL_SIGNAL_TYPES.join(', ')}`)
        process.exit(1)
      }
    }

    // Credit budget check
    const existingWatches = await listWatches(tenantId)
    const newWatches = domains.map(d => ({
      entityType: 'company' as const,
      entityId: d,
      entityName: d,
      signalTypes: types,
      baseline: {},
      tenantId,
    }))
    const projectedCost = estimateDailyCreditCost([
      ...existingWatches,
      ...newWatches.map(w => ({ ...w, id: '', createdAt: '', lastCheckedAt: '' })),
    ])

    if (projectedCost > 50 && !opts.force) {
      console.error(
        `[signals] Projected daily credit cost: ${projectedCost} credits.` +
        ` This exceeds the 50-credit warning threshold. Use --force to proceed.`
      )
      process.exit(1)
    }

    for (const domain of domains) {
      const watch = await addWatch({
        entityType: 'company',
        entityId: domain,
        entityName: domain,
        signalTypes: types,
        baseline: {},
        tenantId,
      })
      console.log(`[signals] Watching ${domain} for [${types.join(', ')}] (id: ${watch.id})`)
    }

    console.log(`\n[signals] Estimated daily credit cost: ${projectedCost} credits`)
    console.log(`[signals] Run detection: npx tsx src/cli/index.ts signals:detect`)
  }))

// ─── signals:detect ─────────────────────────────────────────────────────────
program
  .command('signals:detect')
  .description('Run signal detection now')
  .option('--type <type>', 'Only run a specific signal type')
  .option('--company <domain>', 'Only check a specific company')
  .action(withDiagnostics(async (opts) => {
    const { runDetection } = await import('../lib/signals')
    const tenantId = getTenant()

    console.log(`[signals] Running detection for tenant "${tenantId}"...`)
    const signals = await runDetection({
      tenantId,
      signalType: opts.type,
      entityId: opts.company,
    })

    if (signals.length === 0) {
      console.log('[signals] No new signals detected.')
      return
    }

    console.log(`\n[signals] Detected ${signals.length} signal(s):\n`)
    for (const s of signals) {
      console.log(`  ${s.signalType.padEnd(16)} ${s.entityName.padEnd(30)} ${s.summary}`)
    }
  }))

// ─── signals:list ───────────────────────────────────────────────────────────
program
  .command('signals:list')
  .description('Show all signal watches with last check time')
  .action(withDiagnostics(async () => {
    const { listWatches, estimateDailyCreditCost } = await import('../lib/signals')
    const tenantId = getTenant()
    const watches = await listWatches(tenantId)

    if (watches.length === 0) {
      console.log('[signals] No watches configured. Add with: signals:watch --companies <domains>')
      return
    }

    console.log(`\n── Signal Watches (${watches.length}) ──\n`)
    for (const w of watches) {
      console.log(
        `  ${w.entityId.padEnd(30)} ${w.entityType.padEnd(10)} [${w.signalTypes.join(', ')}]  last: ${w.lastCheckedAt?.slice(0, 16) ?? 'never'}`
      )
    }

    const dailyCost = estimateDailyCreditCost(watches)
    console.log(`\n  Daily credit cost: ~${dailyCost} credits\n`)
  }))

// ─── signals:triggers ───────────────────────────────────────────────────────
program
  .command('signals:triggers')
  .description('Manage signal trigger configurations')
  .argument('<action>', 'list | set')
  .option('--signal <type>', 'Signal type (for set)')
  .option('--action <action>', 'Trigger action: slack, enrich, qualify, campaign, intelligence (for set)')
  .option('--channel <channel>', 'Slack channel (for slack action)')
  .option('--template <text>', 'Message template (for slack action)')
  .action(withDiagnostics(async (action: string, opts) => {
    const { listTriggers, setTrigger, ALL_SIGNAL_TYPES } = await import('../lib/signals')
    const tenantId = getTenant()

    if (action === 'list') {
      const config = await listTriggers(tenantId)
      if (!config || Object.keys(config.triggers).length === 0) {
        console.log('[signals] No triggers configured.')
        console.log(`  Set with: signals:triggers set --signal <type> --action <action>`)
        return
      }

      console.log('\n── Signal Triggers ──\n')
      for (const [signalType, triggers] of Object.entries(config.triggers)) {
        if (!triggers || triggers.length === 0) continue
        console.log(`  ${signalType}:`)
        for (const t of triggers) {
          const details = t.channel ? ` (${t.channel})` : t.campaignId ? ` (campaign: ${t.campaignId})` : ''
          console.log(`    -> ${t.action}${details}`)
        }
      }
    } else if (action === 'set') {
      if (!opts.signal || !opts.action) {
        console.error('Both --signal and --action are required for "set"')
        process.exit(1)
      }
      if (!ALL_SIGNAL_TYPES.includes(opts.signal as any)) {
        console.error(`Invalid signal type: "${opts.signal}". Valid: ${ALL_SIGNAL_TYPES.join(', ')}`)
        process.exit(1)
      }

      await setTrigger(tenantId, opts.signal as any, {
        action: opts.action as any,
        channel: opts.channel,
        template: opts.template,
      })
      console.log(`[signals] Trigger set: ${opts.signal} -> ${opts.action}`)
    } else {
      console.error(`Unknown action: "${action}". Use "list" or "set".`)
      process.exit(1)
    }
  }))

// ─── leads:export ───────────────────────────────────────────────────────────
program
  .command('leads:export')
  .description('Export a result set to CSV, JSON, Google Sheets, webhook, or sequencer-formatted CSV')
  .requiredOption('--result-set <id>', 'Result set ID to export')
  .option('--destination <type>', 'Export destination: csv, json, google-sheets, webhook, lemlist, apollo, woodpecker', 'csv')
  .option('--output <path>', 'Output file path (for file-based exports)')
  .option('--fields <fields>', 'Comma-separated list of fields to include')
  .option('--url <url>', 'Webhook URL (required for webhook destination)')
  .option('--sheet-id <id>', 'Google Spreadsheet ID (required for google-sheets destination)')
  .option('--headers <json>', 'Custom headers as JSON (for webhook)')
  .action(withDiagnostics(async (opts) => {
    const { db } = await import('../lib/db')
    const { resultRows } = await import('../lib/db/schema')
    const { eq } = await import('drizzle-orm')
    const { createDefaultRegistry } = await import('../lib/export/registry')

    // Load rows from result set
    const rows = await db
      .select()
      .from(resultRows)
      .where(eq(resultRows.resultSetId, opts.resultSet))

    if (rows.length === 0) {
      console.error(`No rows found for result set: ${opts.resultSet}`)
      process.exit(1)
    }

    const data = rows.map(row => {
      const d = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? row)
      return d as Record<string, unknown>
    })

    console.log(`Loaded ${data.length} rows from result set ${opts.resultSet}`)

    // Resolve adapter
    const registry = createDefaultRegistry()
    const SEQUENCER_FORMATS = ['lemlist', 'apollo', 'woodpecker']
    const isSequencer = SEQUENCER_FORMATS.includes(opts.destination)
    const adapterId = isSequencer ? 'sequencer-csv' : opts.destination

    const adapter = registry.get(adapterId)
    if (!adapter) {
      console.error(`Unknown destination: ${opts.destination}. Available: csv, json, google-sheets, webhook, ${SEQUENCER_FORMATS.join(', ')}`)
      process.exit(1)
    }

    // Build options
    let destination = opts.output || ''
    if (opts.destination === 'webhook') {
      destination = opts.url || ''
      if (!destination) {
        console.error('--url is required for webhook destination')
        process.exit(1)
      }
    } else if (opts.destination === 'google-sheets') {
      destination = opts.sheetId || ''
      if (!destination) {
        console.error('--sheet-id is required for google-sheets destination')
        process.exit(1)
      }
    }

    const fields = opts.fields ? opts.fields.split(',').map((f: string) => f.trim()) : undefined
    const format = isSequencer ? opts.destination : (opts.headers || undefined)

    const result = await adapter.export(data, {
      destination,
      fields,
      format,
      tenantId: getTenant(),
    })

    if (result.success) {
      console.log(`Exported ${result.recordsExported} records to ${result.destination}`)
    } else {
      console.error(`Export failed: ${result.errors?.join('; ')}`)
      if (result.recordsExported > 0) {
        console.log(`  Partial export: ${result.recordsExported} records succeeded`)
      }
      process.exit(1)
    }
  }))

// ─── research ────────────────────────────────────────────────────────────────
program
  .command('research')
  .description('AI research agent — answer any question about a company, person, or topic with evidence')
  .requiredOption('--question <text>', 'Research question to answer')
  .requiredOption('--target <identifier>', 'Target identifier (domain, name, or topic)')
  .option('--target-type <type>', 'Target type: company, person, or topic', 'company')
  .option('--max-sources <n>', 'Maximum sources to scrape (1-10)', '5')
  .action(withDiagnostics(async (opts) => {
    const { runResearchAgent } = await import('../lib/scraping/research-agent')

    const finding = await runResearchAgent(
      {
        question: opts.question,
        target: opts.target,
        targetType: opts.targetType as 'company' | 'person' | 'topic',
        maxSources: parseInt(opts.maxSources, 10),
        tenantId: getTenant(),
      },
      {
        onProgress: (progress) => {
          console.log(`[${progress.percent}%] [${progress.phase}] ${progress.message}`)
        },
      },
    )

    console.log('\n── Research Finding ──')
    console.log(`  Question:   ${finding.question}`)
    console.log(`  Answer:     ${finding.answer}`)
    console.log(`  Confidence: ${finding.confidence}%`)
    console.log(`  Sources:    ${finding.evidence.length}`)

    if (finding.evidence.length > 0) {
      console.log('\n── Evidence Chain ──')
      for (const [i, e] of finding.evidence.entries()) {
        console.log(`  [${i + 1}] ${e.url}`)
        console.log(`      Relevance: ${e.relevanceScore}% | Scraped: ${e.scrapedAt}`)
        console.log(`      Text: ${e.extractedText.slice(0, 150)}${e.extractedText.length > 150 ? '...' : ''}`)
      }
    }

    if (Object.keys(finding.structuredData).length > 0) {
      console.log('\n── Structured Data ──')
      console.log(JSON.stringify(finding.structuredData, null, 2))
    }
  }))

program.parse()
