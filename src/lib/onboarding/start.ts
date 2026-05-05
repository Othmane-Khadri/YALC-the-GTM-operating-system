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
import { isChannelOptedOut } from '../config/loader.js'
import {
  applyCollectedKeysToEnv,
  envTemplateInstructions,
  writeEnvTemplate,
  type WriteEnvTemplateOutcome,
} from './env-template.js'

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
  /** Flag-driven capture inputs (0.6.0). */
  companyName?: string
  website?: string
  linkedin?: string
  docs?: string | string[]
  icpSummary?: string
  voice?: string
  /** Bypass the local scrape cache for this run. */
  noCache?: boolean
  /** Preview lifecycle controls. */
  commitPreview?: boolean
  discardSections?: string[]
  regenerateSection?: string
  regenerateHint?: string
  discardPreview?: boolean
  forceOverwritePreview?: boolean
  /** Bypass the captured-input content validation before synthesis (#3). */
  forceSynthesis?: boolean
  /**
   * Re-run synthesis for every preview section whose confidence is below
   * `confidenceThreshold` (default 0.6). 0.8.F glue over the existing
   * `regenerateSection` plumbing — no new synthesis code path.
   */
  regenerateLowConfidence?: boolean
  /** Threshold used by `regenerateLowConfidence`. Defaults to 0.6. */
  confidenceThreshold?: number
  /**
   * Suppress the auto-open of /setup/review in the user's default browser
   * after a successful flag-driven capture. Set when `--no-open` is passed
   * or when the caller wants to drive review headlessly.
   */
  noOpen?: boolean
  /**
   * Walk preview sections directly in the terminal at the end of capture
   * (legacy chat-walk pattern). Mutually exclusive with the SPA review —
   * when set, the browser is not launched.
   */
  reviewInChat?: boolean
  /**
   * Server URL the SPA is served from. Defaults to http://localhost:3847.
   * Override for tests / non-default ports.
   */
  serverUrl?: string
  /**
   * Override the dashboard server port. Wired through `--port` on the
   * `start` command; falls back to 3847.
   */
  port?: number
  /**
   * Browser-open hook injected for tests. Production callers leave this
   * unset and the helper resolves to `openBrowser()`.
   */
  openHook?: (url: string) => { attempted: boolean; launched: boolean }
  /**
   * 0.9.F: confidence-banded auto-commit controls. When `noAutoCommit`
   * is true (CLI: `--no-auto-commit`), every section stays in the review
   * queue; otherwise sections with confidence ≥ `autoCommitThreshold`
   * (default 0.85, configurable via config.yaml) auto-commit and only
   * low-confidence sections appear in `/setup/review`.
   */
  noAutoCommit?: boolean
  autoCommitThreshold?: number
  /**
   * 0.9.1: suppress the auto-open of `~/.gtm-os/.env` in the user's default
   * editor after a fresh scaffold writes the template. Set this in CI / non-
   * TTY contexts where launching the desktop editor is undesirable.
   */
  noOpenEnv?: boolean
}

export async function runStart(opts: StartOptions): Promise<void> {
  const { password, input, confirm, select } = await import('@inquirer/prompts')
  const { tenantId } = opts
  const inClaudeCode = isClaudeCode()

  // ─── Preview lifecycle short-circuits (0.6.0) ─────────────────────────────
  // These flags terminate the start invocation early — they do not run
  // capture or synthesis themselves.
  const tenantCtx = { tenantId }
  const {
    previewExists,
    commitPreview,
    discardPreview,
    previewCapturedAt,
    previewRoot,
    refreshLiveIndex,
    SECTION_NAMES,
  } = await import('./preview.js')
  type Section = typeof SECTION_NAMES[number]

  if (opts.discardPreview) {
    if (!previewExists(tenantCtx)) {
      console.log('  No preview to discard.')
      return
    }
    discardPreview(tenantCtx)
    console.log(`  ✓ Discarded preview at ${previewRoot(tenantCtx)}`)
    return
  }

  if (opts.commitPreview) {
    if (!previewExists(tenantCtx)) {
      console.error('  No preview to commit. Run `yalc-gtm start --non-interactive` with capture flags first.')
      process.exitCode = 1
      return
    }
    const discardSections = (opts.discardSections ?? []).filter((s): s is Section =>
      (SECTION_NAMES as readonly string[]).includes(s),
    )
    const unknownDiscard = (opts.discardSections ?? []).filter(
      (s) => !(SECTION_NAMES as readonly string[]).includes(s),
    )
    if (unknownDiscard.length > 0) {
      console.error(`  Unknown --discard section(s): ${unknownDiscard.join(', ')}`)
      console.error(`  Valid sections: ${SECTION_NAMES.join(', ')}`)
      process.exitCode = 1
      return
    }
    const result = commitPreview({ tenant: tenantCtx, discardSections })
    await refreshLiveIndex(tenantCtx)
    await writeReviewCommittedSentinel(tenantCtx)
    console.log(`  ✓ Committed ${result.committed.length} path(s) to live`)
    if (result.discarded.length > 0) {
      console.log(`  ⊘ Left in preview (discarded): ${result.discarded.join(', ')}`)
    }
    return
  }

  if (opts.regenerateSection) {
    await runRegenerateSection({
      tenantId,
      section: opts.regenerateSection,
      hint: opts.regenerateHint,
    })
    return
  }

  if (opts.regenerateLowConfidence) {
    await runRegenerateLowConfidence({
      tenantId,
      threshold: opts.confidenceThreshold,
      hint: opts.regenerateHint,
    })
    return
  }

  // ─── Block on uncommitted preview (D2) ───────────────────────────────────
  // Flag-driven capture is what triggers a fresh write into _preview/. If a
  // preview already exists from a prior run, refuse to start unless the user
  // explicitly resolves it.
  const captureFlagsSet = !!(
    opts.companyName ||
    opts.website ||
    opts.linkedin ||
    opts.docs ||
    opts.icpSummary ||
    opts.voice
  )
  if (
    opts.nonInteractive &&
    captureFlagsSet &&
    previewExists(tenantCtx) &&
    !opts.forceOverwritePreview
  ) {
    const captured = previewCapturedAt(tenantCtx)
    const when = captured
      ? captured.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
      : 'unknown timestamp'
    console.error(
      `Uncommitted preview detected at ${previewRoot(tenantCtx)} (captured ${when}).`,
    )
    console.error('Resolve before running start again:')
    console.error('  yalc-gtm start --commit-preview               # ship as-is')
    console.error('  yalc-gtm start --regenerate <section>         # rerun synthesis on a section')
    console.error('  yalc-gtm start --discard-preview              # delete the preview entirely')
    console.error('  yalc-gtm start --force-overwrite-preview      # advance anyway (power-user override)')
    process.exitCode = 1
    return
  }

  // Bare scaffold-only mode (0.7.0) — `start --non-interactive` with no
  // capture flag set never invokes synthesis, regardless of Anthropic key
  // presence. We just lay down ~/.gtm-os/ + DB + default config and exit.
  // The user is told exactly which command to run next.
  const bareScaffoldOnly = !!opts.nonInteractive && !captureFlagsSet
  if (bareScaffoldOnly) {
    if (!existsSync(GTM_OS_DIR)) {
      mkdirSync(GTM_OS_DIR, { recursive: true })
      console.log(`  Created ${GTM_OS_DIR}`)
    }
    if (!existsSync(CONFIG_PATH)) {
      writeFileSync(CONFIG_PATH, yaml.dump(DEFAULT_CONFIG))
      console.log('  Created default config')
    }

    // Lay down the template `.env` with placeholders for every supported
    // provider. First boot writes the full template; re-runs delta-merge
    // any new placeholders that didn't exist in the previous version.
    const envOutcome = ensureEnvTemplate()
    printEnvOutcome(envOutcome)

    // 0.9.1: when we just wrote a fresh template, hand the file off to the
    // user's default editor so they can uncomment + paste keys in one pass.
    // This is the primary onboarding flow for filling provider keys —
    // `keys:connect <provider> --open` remains available for adding/rotating
    // a single key after onboarding, but the bulk-edit-the-.env flow is
    // dramatically faster when the user has multiple keys to enter.
    if (envOutcome.mode === 'created' && !opts.noOpenEnv) {
      const { openInEditor } = await import('../cli/open-browser.js')
      const r = openInEditor(envOutcome.envPath)
      console.log('')
      console.log('  Opening ~/.gtm-os/.env in your default editor.')
      console.log('  → Remove the leading "#" from the lines you want to enable')
      console.log('  → Paste your API key value after the "=" sign')
      console.log('  → Save the file')
      console.log('  Tell your assistant "keys done" when you have saved the file.')
      if (!r.launched) {
        console.log('')
        console.log(`  (Auto-open skipped — open ${envOutcome.envPath} manually.)`)
      }
    }

    await applyMigrations()
    console.log(
      '\nScaffold complete. Run `yalc-gtm start --non-interactive --website <url>` to capture context.',
    )
    return
  }

  // Apply DB migrations before anything else — fresh installs have no tables
  // yet, so the first query otherwise crashes with `SQLITE_ERROR: no such table`.
  // Idempotent: drizzle's migrator is a no-op when everything is current.
  await applyMigrations()

  console.log(`
  ╔══════════════════════════════════════╗
  ║         YALC — Getting Started       ║
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

  // Write canonical env file at ~/.gtm-os/.env. First boot lays down the
  // full template with commented placeholders for every supported provider;
  // re-runs preserve user lines and append placeholders for any new keys.
  const envOutcome = ensureEnvTemplate()
  printEnvOutcome(envOutcome)

  // Apply any keys collected through interactive prompts on top of the
  // template. We rewrite the file in-place: existing lines keep their order
  // and comments, but matching `# KEY=` / `KEY=` / `KEY=oldvalue` lines are
  // replaced by the live value, and unknown keys are appended at the bottom.
  applyCollectedKeysToEnv(ENV_PATH, collectedKeys)
  console.log(`  ✓ ${Object.keys(collectedKeys).length} key(s) saved to ${ENV_PATH}`)

  // ── Step 1b: Outbound Channel Selection ─────────────────────────────────
  // Pick the email provider so future `email:send` calls resolve through the
  // registry to the right channel. Defaults to Instantly (built-in).
  if (!opts.nonInteractive) {
    await pickOutboundProvider({ select })
  }

  // ── Step 2: Company Context ─────────────────────────────────────────────
  console.log('\n── Step 2/4 — Company Context ──\n')

  // 0.6.0: when running --non-interactive AND any capture flag is set, run
  // the flag-driven capture pipeline that writes into _preview/. This is the
  // path Claude Code uses to onboard without prompts. Falls through to the
  // legacy interview pipeline otherwise.
  const captureOpts = {
    tenantId,
    companyName: opts.companyName,
    website: opts.website,
    linkedin: opts.linkedin,
    docs: opts.docs,
    icpSummary: opts.icpSummary,
    voice: opts.voice,
    noCache: opts.noCache,
  }
  const { hasCaptureFlags, runFlagCapture, writeCapturedPreview, summarizeCapture } =
    await import('./flag-capture.js')
  const useFlagCapture = !!opts.nonInteractive && hasCaptureFlags(captureOpts)

  let flagCaptureSummary: string | null = null
  // Capture phase wall-clock — printed at the end of the flow so users can
  // see whether they're hitting the <60s target promised by the docs.
  const captureStartedAt = Date.now()
  if (useFlagCapture) {
    console.log('  Running flag-driven capture into _preview/')
    const result = await runFlagCapture(captureOpts)
    writeCapturedPreview(result, { tenantId })
    flagCaptureSummary = summarizeCapture(result)
    if (flagCaptureSummary) console.log(flagCaptureSummary)

    // Validate captured raw content before invoking synthesis. Without enough
    // signal (≥500ch website OR ≥200ch LinkedIn OR a docs file ≥200ch) the
    // model is just hallucinating. Bypass with --force-synthesis.
    const { validateCaptureForSynthesis } = await import('./flag-capture.js')
    const validation = validateCaptureForSynthesis({
      websiteContent: result.websiteContent,
      linkedinContent: result.linkedinContent,
      docsContent: result.docsContent,
      docsFiles: result.sourcesUsed.docs,
    })
    if (!validation.ok && !opts.forceSynthesis) {
      // Tailor the error message based on whether the website was the only
      // input the user gave us. With just `--website` and a thin scrape, the
      // most actionable suggestions are: add an ICP one-liner, point at
      // local docs, or force.
      const websiteOnly =
        !!opts.website &&
        !opts.linkedin &&
        !opts.docs &&
        !opts.icpSummary &&
        !opts.voice
      if (websiteOnly) {
        console.error(
          `\nWebsite fetch returned ${validation.websiteChars} chars (minimum 500).`,
        )
        console.error('Pass one of these to seed synthesis:')
        console.error('  --icp-summary "<one-liner describing your buyers>"')
        console.error('  --docs <path-or-url>   # additional context')
        console.error('  --force-synthesis      # proceed anyway with what we have')
      } else {
        console.error(
          `\nInsufficient source content. Got: website=${validation.websiteChars} chars, ` +
            `linkedin=${validation.linkedinChars} chars, docs=${validation.docsFiles} files.`,
        )
        console.error(
          'Need at least one of: website≥500ch, linkedin≥200ch, docs with ≥1 file ≥200ch.',
        )
        console.error(
          'Re-run with better inputs or pass --force-synthesis to proceed anyway.',
        )
      }
      process.exitCode = 1
      return
    }

    // Synthesize all sections into the preview tree. Stubs are emitted when
    // no Anthropic key is available so the folder layout is still correct.
    const { writeSynthesizedPreview } = await import('./synthesis.js')
    const synth = await writeSynthesizedPreview({
      context: result.context,
      rawSources: {
        website: result.websiteContent,
        linkedin: result.linkedinContent,
        docs: result.docsContent,
        voice: result.voiceContent,
      },
      hasMetadataAnchors: result.websiteHasMetadataAnchors,
      tenant: { tenantId },
    })
    console.log(
      `  ✓ Wrote ${synth.written.length} preview files (${synth.llmDriven ? 'LLM-derived' : 'stub'})`,
    )

    const elapsedMs = Date.now() - captureStartedAt
    const elapsedSec = Math.round(elapsedMs / 1000)
    console.log(
      `\n  Captured + synthesized in ${elapsedSec}s. Preview ready at ~/.gtm-os/_preview/`,
    )

    // 0.9.F: confidence-banded auto-commit. High-confidence sections
    // move straight to live; everything else stays in `_preview/` for
    // explicit review. Failures are non-fatal — the user can always
    // commit manually via the SPA.
    try {
      const { applyAutoCommit, resolveEffectiveThreshold } = await import('./auto-commit.js')
      const threshold = resolveEffectiveThreshold({
        threshold: opts.autoCommitThreshold,
        noAutoCommit: opts.noAutoCommit,
      })
      const ac = await applyAutoCommit({ tenantId }, {
        threshold: opts.autoCommitThreshold,
        noAutoCommit: opts.noAutoCommit,
      })
      if (ac.committed.length > 0) {
        console.log(
          `  ✓ Auto-committed ${ac.committed.length} high-confidence section(s) ` +
            `(threshold ${threshold.toFixed(2)}): ${ac.committed.join(', ')}`,
        )
      }
      if (ac.queued.length > 0) {
        console.log(
          `  ⊘ Queued ${ac.queued.length} section(s) for /setup/review: ${ac.queued.join(', ')}`,
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`  ! Auto-commit pass skipped: ${msg}`)
    }
    if (elapsedMs > 120_000) {
      console.warn(
        '  ⚠ Capture took longer than expected. Synthesis may be slow due to model load —',
      )
      console.warn(
        '    re-run with `yalc-gtm start --regenerate <section>` if any section is missing.',
      )
    }
    // Hand off to the SPA review surface (0.9.B). Three modes:
    //   1. --review-in-chat → terminal-driven section walk, then return.
    //   2. default → auto-spawn the dashboard server, auto-open the SPA at
    //      /setup/review, and return. The spawned server is detached so it
    //      survives this CLI exit until the user kills it.
    //   3. --no-open → just print the URL (server is NOT spawned; user
    //      presumably already has one running or wants to drive headlessly).
    // Browser-open failures fall back to the printed URL silently.
    const port = opts.port ?? 3847
    const reviewUrl = `${opts.serverUrl ?? `http://localhost:${port}`}/setup/review`

    if (opts.reviewInChat) {
      await runChatReviewWalk({ tenantId })
      return
    }

    // Always print the URL banner first so it's visible (and copy-pasteable)
    // regardless of whether the auto-open succeeds or we're in a context
    // where opening a browser doesn't make sense (SSH, CI, no TTY).
    console.log('')
    console.log('  ──────────────────────────────────────────')
    console.log(`    YALC setup ready: ${reviewUrl}`)
    console.log('  ──────────────────────────────────────────')
    console.log('')

    // Auto-open is suppressed when the user opted out, when running over
    // SSH, when YALC_NO_OPEN is set, or when stdout isn't a TTY (CI, pipes).
    // The URL banner above stays in place either way.
    const skipAutoOpen =
      !!opts.noOpen ||
      !!process.env.SSH_CONNECTION ||
      !!process.env.YALC_NO_OPEN ||
      !process.stdout.isTTY

    // 0.9.2: auto-spawn the dashboard server if the port isn't already in
    // use. Without this, the browser opens to a non-existent server.
    let spawnedPid: number | null = null
    if (!skipAutoOpen) {
      const inUse = await isPortListening(port).catch(() => false)
      if (!inUse) {
        spawnedPid = await spawnDashboardServer(port)
        if (spawnedPid) {
          console.log(
            `  Started review server on :${port} (pid: ${spawnedPid}). Stop later with: kill ${spawnedPid}`,
          )
          // Wait up to 10s for the server to start listening so the
          // browser-open below doesn't race against an empty port. If the
          // child died (e.g. EADDRINUSE from a race), surface a friendly
          // error so the user knows how to recover.
          let cameUp = false
          for (let i = 0; i < 20; i++) {
            if (await isPortListening(port).catch(() => false)) {
              cameUp = true
              break
            }
            await new Promise((r) => setTimeout(r, 500))
          }
          if (!cameUp) {
            console.error('')
            console.error(`  Port ${port} is already in use.`)
            console.error(`  Either stop the existing process (lsof -i :${port}) or run with a different port:`)
            console.error(`    yalc-gtm start --port ${port + 1}`)
            process.exitCode = 1
            return
          }
        } else {
          console.log(
            `  Could not auto-spawn the review server. In another terminal run:`,
          )
          console.log(`    yalc-gtm campaign:dashboard --port ${port}`)
        }
      }
    }

    let openResult: { attempted: boolean; launched: boolean } = {
      attempted: false,
      launched: false,
    }
    if (!skipAutoOpen) {
      if (opts.openHook) {
        openResult = opts.openHook(reviewUrl)
      } else {
        const { openBrowser } = await import('../cli/open-browser.js')
        const r = openBrowser(reviewUrl)
        openResult = { attempted: r.attempted, launched: r.launched }
      }
    }

    if (openResult.launched) {
      console.log(`  Opening ${reviewUrl} in your browser…`)
    } else if (skipAutoOpen) {
      const reason = opts.noOpen
        ? '--no-open'
        : process.env.SSH_CONNECTION
          ? 'SSH session detected'
          : process.env.YALC_NO_OPEN
            ? 'YALC_NO_OPEN set'
            : 'non-TTY context'
      console.log(`  Auto-open skipped (${reason}). Open the URL above to review and commit.`)
    } else {
      console.log(`  Open ${reviewUrl} to review and commit.`)
    }
    console.log('  CLI alternative: yalc-gtm start --commit-preview (or --review-in-chat).')
    return
  }

  const { runOnboarding } = await import('../context/onboarding.js')
  const { getWebFetchProvider } = await import('../env/claude-code.js')
  // Enable the website step whenever some fetch backend is available —
  // Firecrawl directly, or a Claude Code parent that emits WebFetch
  // handoffs. The ingestor itself decides what to do.
  const canFetch = getWebFetchProvider() !== 'none'
  const report = useFlagCapture
    ? { interviewAnswers: 0, websiteChunks: 0, uploadChunks: 0, configWritten: null, tenantId }
    : await runOnboarding({
        tenantId,
        scrapeWebsite: canFetch,
        nonInteractive: opts.nonInteractive,
      })

  if (!useFlagCapture) {
    console.log(`\n  ✓ Captured ${report.interviewAnswers} answers`)
    if (report.websiteChunks > 0) console.log(`  ✓ Scraped ${report.websiteChunks} website sections`)
    if (report.uploadChunks > 0) console.log(`  ✓ Ingested ${report.uploadChunks} file chunks`)
  }

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
    console.log('      1. Add ANTHROPIC_API_KEY to ~/.gtm-os/.env (or .env.local in your project)')
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
    await configureSkills(fw, goals, { tenant: tenantCtx })
  }

  // ── File Structure Map ─────────────────────────────────────────────────
  printFileStructure()

  // ── Readiness Report ────────────────────────────────────────────────────
  printReadinessReport(collectedKeys, { frameworkDerived, inClaudeCode })
}

/**
 * Render or delta-merge the template `.env`. Returns the outcome so the
 * caller can decide what to print. The template is the source of truth for
 * the structured "for-humans" portion; runtime-collected key values are
 * splattered on top by `applyCollectedKeysToEnv()`.
 */
function ensureEnvTemplate(): WriteEnvTemplateOutcome {
  return writeEnvTemplate({
    envPath: ENV_PATH,
    autoKeys: {
      ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      DATABASE_URL: `file:${join(GTM_OS_DIR, 'gtm-os.db')}`,
    },
  })
}

function printEnvOutcome(outcome: WriteEnvTemplateOutcome): void {
  if (outcome.mode === 'created') {
    console.log('')
    console.log(envTemplateInstructions(outcome.envPath))
  } else if (outcome.mode === 'merged') {
    console.log(
      `  ✓ Added ${outcome.added.length} new placeholder(s) to ${outcome.envPath}`,
    )
  }
  // 'unchanged' is silent — the file is already up-to-date.
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
      { name: 'None / decide later', value: 'none', description: 'Skip email entirely — no validation, no nags.' },
    ],
  })

  console.log('\n  Which LinkedIn provider do you want to use?')
  const linkedinChoice = await select({
    message: 'LinkedIn provider',
    default: existingLinkedIn,
    choices: [
      { name: 'Unipile (built-in)', value: 'unipile', description: 'LinkedIn search, DMs, scraping.' },
      { name: 'None / decide later', value: 'none', description: 'Skip LinkedIn entirely — no validation, no nags.' },
    ],
  })

  // Persist both choices, including the explicit 'none' opt-out sentinel.
  const merged: Record<string, unknown> = { ...existing }
  merged.email = { provider: emailChoice }
  merged.linkedin = { provider: linkedinChoice }
  writeFileSync(CONFIG_PATH, yaml.dump(merged))

  if (emailChoice === 'none') {
    console.log('  ⊘ Email provider opted out. Doctor and setup will skip email checks.')
  } else if (emailChoice === 'instantly') {
    console.log('  ✓ Email provider set to instantly (built-in).')
  } else {
    console.log(`  ✓ Email provider set to ${emailChoice}.`)
    console.log(`    Run: yalc-gtm provider:add --mcp ${emailChoice}`)
  }

  if (linkedinChoice === 'none') {
    console.log('  ⊘ LinkedIn provider opted out. Doctor and setup will skip LinkedIn checks.')
  } else {
    console.log('  ✓ LinkedIn provider set to unipile (built-in).')
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

  // Suggest a first command that will actually succeed in the user's
  // current state. Decision tree (first match wins): explore-providers →
  // research → scrape-post → browse-skills. We re-read the persisted
  // email/linkedin opt-out state so we never suggest a LinkedIn command
  // when `linkedin.provider: none` was just selected.
  const linkedinOptedOut = isChannelOptedOut('linkedin')

  let firstCommand: string
  if (!hasAnthropic && state.inClaudeCode) {
    firstCommand = 'yalc-gtm provider:list'
  } else if (hasAnthropic && has('CRUSTDATA_API_KEY')) {
    firstCommand = 'yalc-gtm research --question "what does <my-target-company> do" --target acme.com'
  } else if (has('UNIPILE_API_KEY') && !linkedinOptedOut) {
    firstCommand = 'yalc-gtm leads:scrape-post --url <linkedin-post-url>'
  } else {
    firstCommand = 'yalc-gtm skills:browse --installed'
  }
  console.log(`  Try this first:
    ${firstCommand}
`)

  if (!state.frameworkDerived) {
    console.log('  Pending: GTM framework not yet derived (needs ANTHROPIC_API_KEY).')
  }
  console.log('  Run "yalc-gtm doctor" anytime to check your setup health.')
  console.log('  Run "yalc-gtm start" again to reconfigure.\n')
}

/**
 * Re-run synthesis for one preview section, reading the captured
 * `company_context.yaml` as input. Honors `--hint <text>`. LLM-derived
 * sections require an Anthropic key — without one, we emit the same
 * "needs an LLM" handoff used elsewhere in the CLI.
 */
/**
 * Public wrapper around `runRegenerateSection` for the API surface (0.9.B).
 *
 * Throws on validation errors (unknown section, missing preview, missing key)
 * instead of setting `process.exitCode`, so HTTP handlers can map to a 4xx.
 * Returns the list of files synthesis wrote.
 */
export async function regeneratePreviewSection(args: {
  tenantId: string
  section: string
  hint?: string
}): Promise<{ section: string; written: string[] }> {
  const tenant = { tenantId: args.tenantId }
  const { previewExists, previewPath } = await import('./preview.js')
  const { ALL_SECTION_IDS, writeSynthesizedPreview } = await import('./synthesis.js')

  if (!previewExists(tenant)) {
    throw new Error('No preview to regenerate. Run capture first.')
  }
  if (!ALL_SECTION_IDS.includes(args.section as (typeof ALL_SECTION_IDS)[number])) {
    throw new Error(
      `Unknown section "${args.section}". Valid: ${ALL_SECTION_IDS.join(', ')}`,
    )
  }
  const ctxPath = previewPath('company_context.yaml', tenant)
  if (!existsSync(ctxPath)) {
    throw new Error(`Missing ${ctxPath}. Re-run start with capture flags first.`)
  }
  const yamlMod = (await import('js-yaml')).default
  const ctx = yamlMod.load(readFileSync(ctxPath, 'utf-8')) as
    | import('../framework/context-types.js').CompanyContext
    | null
  if (!ctx) throw new Error('Could not parse company_context.yaml.')

  const inCC = isClaudeCode()
  if (!process.env.ANTHROPIC_API_KEY && !inCC) {
    throw new Error('--regenerate needs an Anthropic key (or run inside Claude Code).')
  }
  const result = await writeSynthesizedPreview({
    context: ctx,
    tenant,
    only: [args.section as (typeof ALL_SECTION_IDS)[number]],
    hint: args.hint,
  })
  return { section: args.section, written: result.written }
}

async function runRegenerateSection(args: {
  tenantId: string
  section: string
  hint?: string
}): Promise<void> {
  const tenant = { tenantId: args.tenantId }
  const { previewExists, previewPath } = await import('./preview.js')
  const { ALL_SECTION_IDS, writeSynthesizedPreview } = await import('./synthesis.js')

  if (!previewExists(tenant)) {
    console.error('  No preview to regenerate. Run capture first: yalc-gtm start --non-interactive --website ...')
    process.exitCode = 1
    return
  }

  if (!ALL_SECTION_IDS.includes(args.section as (typeof ALL_SECTION_IDS)[number])) {
    console.error(`  Unknown section "${args.section}". Valid: ${ALL_SECTION_IDS.join(', ')}`)
    process.exitCode = 1
    return
  }

  const ctxPath = previewPath('company_context.yaml', tenant)
  if (!existsSync(ctxPath)) {
    console.error(`  Missing ${ctxPath}. Re-run start with capture flags first.`)
    process.exitCode = 1
    return
  }

  const yamlMod = (await import('js-yaml')).default
  const ctx = yamlMod.load(readFileSync(ctxPath, 'utf-8')) as
    | import('../framework/context-types.js').CompanyContext
    | null
  if (!ctx) {
    console.error('  Could not parse company_context.yaml.')
    process.exitCode = 1
    return
  }

  const inCC = isClaudeCode()
  if (!process.env.ANTHROPIC_API_KEY && !inCC) {
    console.error('  --regenerate needs an Anthropic key (or run inside Claude Code).')
    console.error('  Add ANTHROPIC_API_KEY to ~/.gtm-os/.env and retry.')
    process.exitCode = 1
    return
  }
  if (!process.env.ANTHROPIC_API_KEY && inCC) {
    console.log(
      `[start] Claude Code handoff: please synthesize the "${args.section}" section using ` +
        `${ctxPath} as input` +
        (args.hint ? ` (hint: ${args.hint})` : '') +
        '.',
    )
    return
  }

  const result = await writeSynthesizedPreview({
    context: ctx,
    tenant,
    only: [args.section as (typeof ALL_SECTION_IDS)[number]],
    hint: args.hint,
  })
  console.log(
    `  ✓ Regenerated ${result.written.length} file(s) for section "${args.section}"`,
  )
}

/**
 * Re-run synthesis for every preview section whose confidence dipped below
 * `threshold` (default 0.6). Pure glue: scans `_preview/_meta.json`, then
 * defers to `runRegenerateSection()` per low-confidence section so the
 * regenerate plumbing stays the single source of truth.
 */
async function runRegenerateLowConfidence(args: {
  tenantId: string
  threshold?: number
  hint?: string
}): Promise<void> {
  const tenant = { tenantId: args.tenantId }
  const { previewExists, readPreviewMeta, previewRoot } = await import('./preview.js')
  const { ALL_SECTION_IDS } = await import('./synthesis.js')

  const threshold = args.threshold ?? 0.6
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    console.error(`  Invalid --confidence-threshold ${threshold}. Must be between 0 and 1.`)
    process.exitCode = 1
    return
  }

  if (!previewExists(tenant)) {
    console.error(
      '  No preview to scan. Run capture first: yalc-gtm start --non-interactive --website ...',
    )
    process.exitCode = 1
    return
  }

  const meta = readPreviewMeta(tenant)
  const sections = meta?.sections ?? {}
  const valid = new Set<string>(ALL_SECTION_IDS as readonly string[])
  // A section is eligible only if the writer for it knows how to
  // regenerate (i.e. it's in ALL_SECTION_IDS — `company_context` doesn't
  // run through synthesis so we skip it even if it's in the meta).
  const lowConfidence = Object.entries(sections)
    .filter(([name, entry]) => valid.has(name) && entry.confidence < threshold)
    .map(([name, entry]) => ({ name, confidence: entry.confidence }))
    .sort((a, b) => a.confidence - b.confidence)

  if (lowConfidence.length === 0) {
    console.log(
      `  ✓ No sections below threshold ${threshold.toFixed(2)} in ${previewRoot(tenant)}.`,
    )
    return
  }

  console.log(
    `  Regenerating ${lowConfidence.length} section(s) below threshold ${threshold.toFixed(2)}:`,
  )
  for (const { name, confidence } of lowConfidence) {
    console.log(`    - ${name} (confidence ${confidence.toFixed(2)})`)
  }

  for (const { name } of lowConfidence) {
    await runRegenerateSection({
      tenantId: args.tenantId,
      section: name,
      hint: args.hint,
    })
  }
}

// ─── 0.9.B: SPA handoff helpers ──────────────────────────────────────────────

/**
 * Write `<liveRoot>/_handoffs/setup/review.committed` so non-interactive
 * harnesses (Claude Code, CI) can detect that commit completed without
 * polling the preview directory. Best-effort.
 *
 * Async because the preview helpers ship as ESM and we can't `require()`
 * them. Callers can fire-and-forget — failures never propagate.
 */
export async function writeReviewCommittedSentinel(tenant: {
  tenantId: string
}): Promise<void> {
  try {
    const { liveRoot } = await import('./preview.js')
    const dir = join(liveRoot(tenant), '_handoffs', 'setup')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'review.committed'),
      JSON.stringify({ at: new Date().toISOString(), tenant: tenant.tenantId }) + '\n',
    )
  } catch {
    // Sentinel is advisory — never propagate.
  }
}

/**
 * Legacy-style chat-walk: enumerate every preview section, print a short
 * summary, and prompt for approve/regenerate/drop. Used only when
 * `--review-in-chat` is passed (no browser available, CI).
 *
 * The full per-section walk lives in the synthesis prompts; here we just
 * emit one summary line per section then immediately commit. Callers who
 * want fine-grained control should run `yalc-gtm start --regenerate
 * <section>` and `--commit-preview --discard <section>` directly.
 */
async function runChatReviewWalk(args: { tenantId: string }): Promise<void> {
  const tenant = { tenantId: args.tenantId }
  const { previewExists, previewPath, SECTION_NAMES, SECTION_PATHS, commitPreview, refreshLiveIndex } =
    await import('./preview.js')

  if (!previewExists(tenant)) {
    console.error('  No preview to review.')
    process.exitCode = 1
    return
  }

  console.log('\n  Preview sections:')
  for (const id of SECTION_NAMES) {
    for (const canonical of SECTION_PATHS[id]) {
      const abs = previewPath(canonical, tenant)
      if (!existsSync(abs)) continue
      console.log(`    - ${id} (${canonical})`)
    }
  }
  console.log(
    '\n  Review-in-chat mode: committing preview as-is. Re-run with --discard <section>',
  )
  console.log('  to drop sections, or --regenerate <section> to redo synthesis.\n')

  const result = commitPreview({ tenant })
  await refreshLiveIndex(tenant)
  await writeReviewCommittedSentinel(tenant)
  console.log(`  ✓ Committed ${result.committed.length} path(s) to live`)
}

/**
 * 0.9.2: detect whether something is already listening on the given port.
 * Used by the post-capture handoff to decide whether to spawn the dashboard
 * server. Best-effort — a transient AF_INET6 vs AF_INET mismatch could
 * report false negative; the worst case is a duplicate spawn which the
 * user can kill.
 */
async function isPortListening(port: number, host = '127.0.0.1'): Promise<boolean> {
  const { createConnection } = await import('node:net')
  return new Promise((resolve) => {
    const socket = createConnection({ port, host })
    let settled = false
    const done = (result: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    setTimeout(() => done(false), 1000)
  })
}

/**
 * 0.9.2: spawn the dashboard server as a detached child process so it
 * survives this CLI's exit. Uses the same node binary + the same CLI
 * entry point we're already running, so it works inside sandboxed installs
 * where `yalc-gtm` may not be on the PATH of the spawned shell.
 *
 * Returns the spawned PID on success, or null on failure.
 */
async function spawnDashboardServer(port: number): Promise<number | null> {
  try {
    const { spawn } = await import('node:child_process')
    const cliEntry = process.argv[1]
    if (!cliEntry) return null
    const child = spawn(
      process.execPath,
      [cliEntry, 'campaign:dashboard', '--port', String(port)],
      {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      },
    )
    if (typeof child.unref === 'function') child.unref()
    return child.pid ?? null
  } catch {
    return null
  }
}
