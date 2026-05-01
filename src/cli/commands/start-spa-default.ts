/**
 * `yalc-gtm start` (no flags) — SPA-as-default entry point (A1).
 *
 * Routes the no-flag `start` invocation through a single inquirer prompt
 * that asks ONLY for the company website URL, then delegates to the
 * existing flag-capture path in `runStart` by passing `nonInteractive: true`
 * + `website: <url>`. That path already auto-spawns the dashboard server
 * and opens /setup/review.
 *
 * The legacy 4-step terminal interview is reachable via
 * `yalc-gtm start --review-in-chat` (regression guard).
 *
 * This file owns ONLY the entry-point routing decision and the URL prompt
 * loop. It does NOT touch the internals of flag-capture or the SPA review
 * surface — those are owned by `src/lib/onboarding/start.ts` (A4).
 */

import type { StartOptions } from '../../lib/onboarding/start'

export interface StartCliFlags {
  /** All preview-lifecycle / capture / non-interactive flags forwarded
   *  from commander. The predicate below uses these to decide whether
   *  the no-flag SPA-default path applies. */
  nonInteractive?: boolean
  reviewInChat?: boolean
  companyName?: string
  website?: string
  linkedin?: string
  docs?: string | string[]
  icpSummary?: string
  voice?: string
  commitPreview?: boolean
  discardPreview?: boolean
  regenerateSection?: string
  regenerateLowConfidence?: boolean
}

/**
 * True when `start` was invoked with zero flags AND no opt-out flag.
 * The action handler routes to `runStartSpaDefault` in that case.
 */
export function shouldUseSpaDefault(flags: StartCliFlags): boolean {
  if (flags.nonInteractive) return false
  if (flags.reviewInChat) return false
  if (flags.commitPreview) return false
  if (flags.discardPreview) return false
  if (flags.regenerateSection) return false
  if (flags.regenerateLowConfidence) return false
  if (flags.companyName) return false
  if (flags.website) return false
  if (flags.linkedin) return false
  if (flags.icpSummary) return false
  if (flags.voice) return false
  if (flags.docs) {
    const docs = Array.isArray(flags.docs) ? flags.docs : [flags.docs]
    if (docs.length > 0) return false
  }
  return true
}

export interface RunStartSpaDefaultOptions {
  tenantId: string
  /**
   * Prompt hook — called once per attempt. Production wiring uses
   * @inquirer/prompts `input` with a validator; tests inject a fake.
   */
  promptUrl?: () => Promise<string>
  /**
   * Delegate to the canonical `runStart` from
   * `src/lib/onboarding/start.ts`. Default lazy-imports the real one.
   */
  runStart?: (opts: StartOptions) => Promise<void>
  /** Optional pass-throughs (mostly used by tests). */
  serverUrl?: string
  openHook?: StartOptions['openHook']
  noOpen?: boolean
  noOpenEnv?: boolean
  /** Bound on retry attempts when the user keeps entering invalid URLs. */
  maxAttempts?: number
}

export interface StartSpaDefaultResult {
  exitCode: number
  /** The URL the user supplied (null when they failed to provide one). */
  website: string | null
}

/**
 * Validate that `value` parses as an http(s) URL. Empty / whitespace /
 * non-http schemes are rejected.
 */
export function isValidWebsiteUrl(value: string): boolean {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return false
  try {
    const u = new URL(trimmed)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

async function defaultPromptUrl(): Promise<string> {
  const { input } = await import('@inquirer/prompts')
  const value = await input({
    message: 'Company website URL (we will scrape it for context):',
    validate: (raw: string) =>
      isValidWebsiteUrl(raw) ||
      'Enter a valid http(s) URL, e.g. https://your-company.com',
  })
  return value
}

async function defaultRunStart(opts: StartOptions): Promise<void> {
  const { runStart } = await import('../../lib/onboarding/start')
  await runStart(opts)
}

/**
 * Entry point for the SPA-default `start` flow. Prompts for a website,
 * then hands off to `runStart` with `nonInteractive: true` + the captured
 * URL so the existing flag-capture → /setup/review path runs.
 */
export async function runStartSpaDefault(
  opts: RunStartSpaDefaultOptions,
): Promise<StartSpaDefaultResult> {
  const promptUrl = opts.promptUrl ?? defaultPromptUrl
  const runStart = opts.runStart ?? defaultRunStart
  const maxAttempts = opts.maxAttempts ?? 3

  let website: string | null = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const raw = await promptUrl()
    if (isValidWebsiteUrl(raw)) {
      website = raw.trim()
      break
    }
    // The default prompt validates inline so this branch is mostly hit by
    // tests injecting a no-validation fake. Print a short hint and retry.
    console.error('  Invalid URL. Please enter a full http(s) URL.')
  }

  if (!website) {
    console.error(
      `  Aborted after ${maxAttempts} invalid attempts. Re-run \`yalc-gtm start\` when ready.`,
    )
    return { exitCode: 1, website: null }
  }

  await runStart({
    tenantId: opts.tenantId,
    nonInteractive: true,
    website,
    serverUrl: opts.serverUrl,
    openHook: opts.openHook,
    noOpen: opts.noOpen,
    noOpenEnv: opts.noOpenEnv,
  })

  return { exitCode: 0, website }
}
