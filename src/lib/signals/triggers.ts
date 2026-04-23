// ─── Signal Trigger System ──────────────────────────────────────────────────
// Maps detected signals to downstream GTM actions.
// Config lives in ~/.gtm-os/tenants/<slug>/signal-triggers.yaml

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'
import { sendSlackNotification } from '../services/slack'
import type { DetectedSignal, TriggerConfig, TriggerFile, SignalType } from './types'

// ─── Load trigger config ────────────────────────────────────────────────────

export async function loadTriggerConfig(tenantId: string): Promise<TriggerFile | null> {
  const configPath = join(
    homedir(),
    '.gtm-os',
    'tenants',
    tenantId,
    'signal-triggers.yaml',
  )

  if (!existsSync(configPath)) return null

  try {
    const raw = readFileSync(configPath, 'utf-8')
    return yaml.load(raw) as TriggerFile
  } catch (err) {
    console.error(
      `[triggers] Failed to load ${configPath}:`,
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

// ─── Execute triggers for a signal ──────────────────────────────────────────

export async function executeTriggers(
  signal: DetectedSignal,
  config: TriggerFile,
): Promise<void> {
  const triggers = config.triggers[signal.signalType as SignalType] ?? []

  for (const trigger of triggers) {
    try {
      await executeSingleTrigger(signal, trigger)
    } catch (err) {
      console.error(
        `[triggers] Action "${trigger.action}" failed for signal ${signal.id}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}

async function executeSingleTrigger(
  signal: DetectedSignal,
  trigger: TriggerConfig,
): Promise<void> {
  switch (trigger.action) {
    case 'intelligence':
      // Already handled in engine.ts — every signal feeds intelligence.
      // This trigger exists so users can see it in their config and
      // understand it happens automatically.
      break

    case 'slack': {
      const message = resolveTemplate(
        trigger.template ?? `Signal: {{signal_type}} for {{entity_name}} — {{summary}}`,
        signal,
      )
      await sendSlackNotification('signal_detected', {
        text: message,
        signal_type: signal.signalType,
        entity_name: signal.entityName,
        entity_id: signal.entityId,
        summary: signal.summary,
        channel: trigger.channel,
      })
      break
    }

    case 'enrich':
      // Log intent — actual enrichment would be handled by the orchestrator
      // or a follow-up CLI command. We don't auto-spend credits.
      console.log(
        `[triggers] ENRICH queued for ${signal.entityId} (signal: ${signal.signalType})`,
      )
      break

    case 'qualify':
      console.log(
        `[triggers] QUALIFY queued for ${signal.entityId} (signal: ${signal.signalType})`,
      )
      break

    case 'campaign':
      console.log(
        `[triggers] CAMPAIGN add queued: ${signal.entityId} → campaign ${trigger.campaignId ?? 'default'} (signal: ${signal.signalType})`,
      )
      break
  }
}

// ─── Template resolution ────────────────────────────────────────────────────

function resolveTemplate(template: string, signal: DetectedSignal): string {
  return template
    .replace(/\{\{entity_name\}\}/g, signal.entityName)
    .replace(/\{\{entity_id\}\}/g, signal.entityId)
    .replace(/\{\{signal_type\}\}/g, signal.signalType)
    .replace(/\{\{summary\}\}/g, signal.summary)
    .replace(/\{\{data\.(\w+)\}\}/g, (_match, key: string) => {
      const val = signal.data[key]
      return val !== undefined ? String(val) : ''
    })
}

// ─── List triggers ──────────────────────────────────────────────────────────

export async function listTriggers(
  tenantId: string,
): Promise<TriggerFile | null> {
  return loadTriggerConfig(tenantId)
}

// ─── Set a single trigger ───────────────────────────────────────────────────

export async function setTrigger(
  tenantId: string,
  signalType: SignalType,
  trigger: TriggerConfig,
): Promise<void> {
  const configPath = join(
    homedir(),
    '.gtm-os',
    'tenants',
    tenantId,
    'signal-triggers.yaml',
  )

  let config: TriggerFile = { triggers: {} }

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8')
      config = (yaml.load(raw) as TriggerFile) ?? { triggers: {} }
    } catch {
      // Start fresh on parse error
    }
  }

  if (!config.triggers[signalType]) {
    config.triggers[signalType] = []
  }

  // Avoid duplicate action entries
  const existing = config.triggers[signalType]!
  const alreadyExists = existing.some(t => t.action === trigger.action)
  if (!alreadyExists) {
    existing.push(trigger)
  }

  const { mkdirSync, writeFileSync } = await import('fs')
  const dir = join(homedir(), '.gtm-os', 'tenants', tenantId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, yaml.dump(config, { lineWidth: 120 }))
}
