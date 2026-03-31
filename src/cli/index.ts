#!/usr/bin/env npx tsx
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { Command } from 'commander'
import { loadConfig } from '../lib/config/loader'

const program = new Command()

program
  .name('gtm-os')
  .description('Open-source AI-native GTM engine')
  .version('0.3.0')
  .option('-c, --config <path>', 'Path to config YAML', '~/.gtm-os/config.yaml')

// ─── campaign:track ─────────────────────────────────────────────────────────
program
  .command('campaign:track')
  .description('Run daily campaign tracker — poll Unipile, advance sequences, sync Notion')
  .option('--dry-run', 'Show what would happen without sending anything')
  .option('--campaign-id <id>', 'Track a specific campaign only')
  .action(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
    const { runTracker } = await import('../lib/campaign/tracker')
    await runTracker({
      config,
      dryRun: opts.dryRun ?? false,
      campaignId: opts.campaignId,
    })
  })

// ─── campaign:create ────────────────────────────────────────────────────────
program
  .command('campaign:create')
  .description('Create a new campaign with variant testing')
  .option('--leads-filter <filter>', 'Filter leads from Unified Leads DB (JSON)')
  .option('--title <title>', 'Campaign title')
  .option('--hypothesis <hypothesis>', 'Campaign hypothesis')
  .option('--auto-copy', 'Generate voice-aware copy via Claude instead of default templates')
  .option('--segment-id <id>', 'ICP segment ID for voice targeting')
  .option('--dry-run', 'Preview campaign creation without writing to DB')
  .action(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
    const { runCreator } = await import('../lib/campaign/creator')
    await runCreator({ config, ...opts, autoCopy: opts.autoCopy, dryRun: opts.dryRun ?? false })
  })

// ─── campaign:report ────────────────────────────────────────────────────────
program
  .command('campaign:report')
  .description('Generate weekly intelligence report')
  .option('--week <date>', 'Report week (ISO date, defaults to current)')
  .action(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
    const { runReport } = await import('../lib/campaign/intelligence-report')
    await runReport({ config, week: opts.week })
  })

// ─── leads:scrape-post ──────────────────────────────────────────────────────
program
  .command('leads:scrape-post')
  .description('Scrape likers and/or commenters from a LinkedIn post URL')
  .requiredOption('--url <url>', 'LinkedIn post URL')
  .option('--type <type>', 'What to scrape: both, reactions, comments', 'both')
  .option('--max-pages <n>', 'Max pagination pages per endpoint', '10')
  .option('--output <path>', 'Custom output JSON path')
  .option('--account <name>', 'Unipile account name or ID to use for scraping')
  .action(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
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
  })

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

// ─── leads:qualify ──────────────────────────────────────────────────────────
program
  .command('leads:qualify')
  .description('Run 7-gate lead qualification pipeline')
  .option('--source <type>', 'Input source: csv, json, notion, visitors, engagers')
  .option('--input <path>', 'Path to input file or Notion DB ID')
  .option('--result-set <id>', 'Existing result set ID to qualify')
  .option('--dry-run', 'Preview qualification without writing results')
  .action(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
    const { runQualify } = await import('../lib/qualification/pipeline')
    await runQualify({ config, source: opts.source, input: opts.input, resultSetId: opts.resultSet, dryRun: opts.dryRun ?? false })
  })

// ─── leads:import ───────────────────────────────────────────────────────────
program
  .command('leads:import')
  .description('Import leads into SQLite from external sources')
  .requiredOption('--source <type>', 'Source type: csv, json, notion, visitors')
  .requiredOption('--input <path>', 'Path to input file')
  .option('--dry-run', 'Preview import without writing to DB')
  .action(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
    const { runImport } = await import('../lib/qualification/importers')
    await runImport({ config, source: opts.source, input: opts.input, dryRun: opts.dryRun ?? false })
  })

// ─── notion:sync ────────────────────────────────────────────────────────────
program
  .command('notion:sync')
  .description('Bidirectional sync between SQLite and Notion')
  .option('--direction <dir>', 'push | pull | both', 'both')
  .option('--dry-run', 'Preview sync without writing')
  .action(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
    const { runSync } = await import('../lib/notion/sync')
    await runSync({ config, direction: opts.direction, dryRun: opts.dryRun ?? false })
  })

// ─── notion:bootstrap ───────────────────────────────────────────────────────
program
  .command('notion:bootstrap')
  .description('Import existing campaigns, leads, and variants from Notion into SQLite')
  .option('--dry-run', 'Preview bootstrap without writing to DB')
  .action(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
    const { runBootstrap } = await import('../lib/notion/bootstrap')
    await runBootstrap({ config, dryRun: opts.dryRun ?? false })
  })

// ─── campaign:dashboard ──────────────────────────────────────────────────────
program
  .command('campaign:dashboard')
  .description('Open campaign visualization dashboard in browser')
  .option('--port <port>', 'Server port', '3847')
  .action(async (opts) => {
    const { startServer } = await import('../lib/server/index')
    const port = parseInt(opts.port, 10)
    startServer(port)
    const { exec } = await import('child_process')
    exec(`open http://localhost:${port}/campaigns`)
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
      const { exec } = await import('child_process')
      exec(`open http://localhost:3847/monthly-report?month=${month}`)
    }
  })

// ─── orchestrate ────────────────────────────────────────────────────────────
program
  .command('orchestrate')
  .description('Decompose a natural language GTM request into phased skill execution')
  .argument('<query>', 'Natural language request')
  .option('--auto-approve', 'Skip approval gates')
  .option('--dry-run', 'Preview orchestration without executing skills')
  .action(async (query, opts) => {
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
  })

// ─── setup ──────────────────────────────────────────────────────────────────
program
  .command('setup')
  .description('Check configuration, API keys, and provider connectivity')
  .action(async () => {
    const { runSetup } = await import('../lib/config/setup')
    await runSetup()
  })

// ─── onboard ────────────────────────────────────────────────────────────────
program
  .command('onboard')
  .description('Build GTM framework from LinkedIn profile, website, and docs')
  .option('--linkedin <url>', 'LinkedIn profile URL')
  .option('--website <url>', 'Company website URL')
  .option('--knowledge <paths...>', 'Paths to knowledge files (PDFs, docs)')
  .action(async (opts) => {
    const { buildProfile } = await import('../lib/onboarding/profile-builder')
    await buildProfile({ linkedin: opts.linkedin, website: opts.website, knowledge: opts.knowledge })
  })

// ─── configure ──────────────────────────────────────────────────────────────
program
  .command('configure')
  .description('Set GTM goals and configure skills based on your framework')
  .action(async () => {
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
  })

// ─── test-run ───────────────────────────────────────────────────────────────
program
  .command('test-run')
  .description('Run a test batch: find → enrich → qualify → review')
  .option('--count <n>', 'Number of test leads', '10')
  .action(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
    const { runTestBatch } = await import('../lib/execution/test-runner')
    await runTestBatch(config, parseInt(opts.count, 10))
  })

// ─── results:review ─────────────────────────────────────────────────────────
program
  .command('results:review')
  .description('Review and provide feedback on qualification results')
  .requiredOption('--result-set <id>', 'Result set ID to review')
  .action(async (opts) => {
    const { collectFeedback } = await import('../lib/execution/feedback-collector')
    await collectFeedback(opts.resultSet)
  })

// ─── agent:run ─────────────────────────────────────────────────────────────
program
  .command('agent:run')
  .description('Run a background agent immediately')
  .requiredOption('--agent <id>', 'Agent ID to run')
  .option('--post-url <url>', 'LinkedIn post URL (for linkedin scraper agent)')
  .action(async (opts) => {
    const { BackgroundAgent } = await import('../lib/agents/runner')

    let config
    if (opts.agent === 'daily-linkedin-scraper') {
      if (!opts.postUrl) {
        console.error('Error: --post-url required for daily-linkedin-scraper agent')
        process.exit(1)
      }
      const { createDailyLinkedinScraperConfig } = await import('../lib/agents/examples/daily-linkedin-scraper')
      config = createDailyLinkedinScraperConfig(opts.postUrl)
    } else {
      console.error(`Unknown agent: ${opts.agent}. Available: daily-linkedin-scraper`)
      process.exit(1)
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
      const output = execSync(`bash "${scriptPath}" "${opts.agent}" "${opts.hour}" "${opts.minute}"`, { encoding: 'utf-8' })
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
    const { AgentLogger } = await import('../lib/agents/logger')

    const logBase = join(process.cwd(), 'data', 'agent-logs')
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

program.parse()
