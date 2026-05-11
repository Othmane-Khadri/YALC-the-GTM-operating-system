/**
 * Outbound campaign hypothesis — capture, persistence, and key-gating.
 *
 * Used by the setup-completion Step 10 (`/setup`) and by the
 * `outreach-campaign-builder` framework's first-run flow. Captures the
 * 4 dimensions a real outbound experiment must declare BEFORE any messaging
 * gets drafted:
 *
 *   1. icp_segment          — which audience cell are we testing?
 *   2. message_angle        — what one-line value prop are we asserting?
 *   3. signal_trigger       — what observable buying signal qualifies a fit?
 *   4. expected_reply_rate  — the success bar (0.0–1.0) campaign-intelligence
 *                             scores against later.
 *
 * This is the antidote to the prior misroute where the `propose-campaigns`
 * skill (a CONTENT skill) was the first step of the outreach framework — it
 * returned content hooks instead of asking the operator to declare an
 * outbound experiment.
 *
 * Persistence is deliberately on-disk (not just in-memory): both the install
 * wizard and a downstream `campaign:create` call need to read it without
 * coupling to a specific runtime context.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { loadInstalledConfig, saveInstalledConfig } from './registry.js'

/** Canonical 4-field shape of an outbound experiment hypothesis. */
export interface OutboundHypothesis {
  /** ICP segment under test (e.g. "Series A SaaS CTOs in EU"). */
  icp_segment: string
  /** One-line message angle being tested. */
  message_angle: string
  /** Observable buying signal that makes a prospect a fit. */
  signal_trigger: string
  /** Success bar — fraction in [0, 1]. campaign-intelligence scores against this. */
  expected_reply_rate: number
}

/**
 * Returns true when at least one full outbound channel is configured:
 *   - LinkedIn — both `UNIPILE_API_KEY` AND `UNIPILE_DSN` (Unipile rejects either alone), OR
 *   - Email    — `INSTANTLY_API_KEY`.
 *
 * Setup Step 10 gates on this — without a usable channel the install would
 * succeed but the framework would have nothing to launch into.
 */
export function hasOutboundChannelKeys(): boolean {
  const linkedin = !!(process.env.UNIPILE_API_KEY && process.env.UNIPILE_DSN)
  const email = !!process.env.INSTANTLY_API_KEY
  return linkedin || email
}

/** Path the JSON hypothesis sidecar lives at. */
function hypothesisPath(frameworkName: string): string {
  return join(homedir(), '.gtm-os', 'frameworks', 'installed', `${frameworkName}.hypothesis.json`)
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

/**
 * Validate the hypothesis shape. Throws on missing fields or out-of-range
 * `expected_reply_rate`. Pure function — no side effects.
 */
export function validateOutboundHypothesis(hyp: OutboundHypothesis): void {
  const missing: string[] = []
  if (!hyp.icp_segment || typeof hyp.icp_segment !== 'string') missing.push('icp_segment')
  if (!hyp.message_angle || typeof hyp.message_angle !== 'string') missing.push('message_angle')
  if (!hyp.signal_trigger || typeof hyp.signal_trigger !== 'string') missing.push('signal_trigger')
  if (typeof hyp.expected_reply_rate !== 'number') missing.push('expected_reply_rate')
  if (missing.length > 0) {
    throw new Error(
      `OutboundHypothesis missing required fields: ${missing.join(', ')}`,
    )
  }
  if (hyp.expected_reply_rate < 0 || hyp.expected_reply_rate > 1) {
    throw new Error(
      `OutboundHypothesis.expected_reply_rate must be in [0, 1], got ${hyp.expected_reply_rate}`,
    )
  }
}

/**
 * Persist the hypothesis as a JSON sidecar AND merge it into the framework's
 * installed-config `inputs.hypothesis` slot when the framework is installed.
 * Storing in both places keeps the on-disk artifact independent of install
 * state (so the user can record a hypothesis before install) while still
 * giving the runner a single field to read once install lands.
 */
export function saveOutboundHypothesis(
  frameworkName: string,
  hyp: OutboundHypothesis,
): void {
  validateOutboundHypothesis(hyp)
  const path = hypothesisPath(frameworkName)
  ensureDir(join(homedir(), '.gtm-os', 'frameworks', 'installed'))
  writeFileSync(path, JSON.stringify(hyp, null, 2) + '\n', 'utf-8')

  const cfg = loadInstalledConfig(frameworkName)
  if (cfg) {
    cfg.inputs = { ...cfg.inputs, hypothesis: { ...hyp } }
    saveInstalledConfig(cfg)
  }
}

/** Read the persisted hypothesis. Returns null when none exists. */
export function loadOutboundHypothesis(
  frameworkName: string,
): OutboundHypothesis | null {
  const path = hypothesisPath(frameworkName)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as OutboundHypothesis
  } catch {
    return null
  }
}
