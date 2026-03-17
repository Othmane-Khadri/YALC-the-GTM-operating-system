#!/usr/bin/env npx tsx
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
  .action(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
    const { runCreator } = await import('../lib/campaign/creator')
    await runCreator({ config, ...opts })
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

// ─── leads:qualify ──────────────────────────────────────────────────────────
program
  .command('leads:qualify')
  .description('Run 7-gate lead qualification pipeline')
  .requiredOption('--source <type>', 'Input source: csv, json, notion, visitors, engagers')
  .requiredOption('--input <path>', 'Path to input file or Notion DB ID')
  .action(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
    const { runQualify } = await import('../lib/qualification/pipeline')
    await runQualify({ config, source: opts.source, input: opts.input })
  })

// ─── leads:import ───────────────────────────────────────────────────────────
program
  .command('leads:import')
  .description('Import leads into SQLite from external sources')
  .requiredOption('--source <type>', 'Source type: csv, json, notion, visitors')
  .requiredOption('--input <path>', 'Path to input file')
  .action(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
    const { runImport } = await import('../lib/qualification/importers')
    await runImport({ config, source: opts.source, input: opts.input })
  })

// ─── notion:sync ────────────────────────────────────────────────────────────
program
  .command('notion:sync')
  .description('Bidirectional sync between SQLite and Notion')
  .option('--direction <dir>', 'push | pull | both', 'both')
  .action(async (opts) => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
    const { runSync } = await import('../lib/notion/sync')
    await runSync({ config, direction: opts.direction })
  })

// ─── notion:bootstrap ───────────────────────────────────────────────────────
program
  .command('notion:bootstrap')
  .description('Import existing campaigns, leads, and variants from Notion into SQLite')
  .action(async () => {
    const config = loadConfig(program.opts().config.replace('~', process.env.HOME!))
    const { runBootstrap } = await import('../lib/notion/bootstrap')
    await runBootstrap({ config })
  })

program.parse()
