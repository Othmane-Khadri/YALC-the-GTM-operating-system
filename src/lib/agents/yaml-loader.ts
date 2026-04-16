// ─── YAML Agent Config Loader ────────────────────────────────────────────────
// Loads AgentConfig from YAML files in ~/.gtm-os/agents/

import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'
import type { AgentConfig, AgentSchedule, AgentStep } from './types'

const AGENTS_DIR = join(homedir(), '.gtm-os', 'agents')

interface RawYamlAgent {
  id: string
  name?: string
  description?: string
  steps: Array<{
    skillId: string
    input?: Record<string, unknown>
    continueOnError?: boolean
  }>
  schedule: {
    type: 'interval' | 'daily' | 'weekly' | 'cron'
    hour?: number
    minute?: number
    dayOfWeek?: number
    intervalMinutes?: number
  }
  maxRetries?: number
  timeoutMs?: number
}

export function loadAgentFromYaml(agentId: string): AgentConfig | null {
  const filePath = join(AGENTS_DIR, `${agentId}.yaml`)
  if (!existsSync(filePath)) return null

  const raw = yaml.load(readFileSync(filePath, 'utf-8')) as RawYamlAgent
  return parseAgentYaml(raw)
}

export function listYamlAgents(): string[] {
  if (!existsSync(AGENTS_DIR)) return []
  return readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => f.replace(/\.ya?ml$/, ''))
}

function parseAgentYaml(raw: RawYamlAgent): AgentConfig {
  if (!raw.id || typeof raw.id !== 'string') {
    throw new Error('Agent YAML must have an "id" field')
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new Error('Agent YAML must have at least one step')
  }
  if (!raw.schedule || !raw.schedule.type) {
    throw new Error('Agent YAML must have a "schedule" with "type"')
  }

  const steps: AgentStep[] = raw.steps.map(s => ({
    skillId: s.skillId,
    input: s.input ?? {},
    continueOnError: s.continueOnError ?? false,
  }))

  const schedule: AgentSchedule = {
    type: raw.schedule.type,
    hour: raw.schedule.hour,
    minute: raw.schedule.minute,
    dayOfWeek: raw.schedule.dayOfWeek,
    intervalMinutes: raw.schedule.intervalMinutes,
  }

  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    description: raw.description ?? '',
    steps,
    schedule,
    maxRetries: raw.maxRetries ?? 2,
    timeoutMs: raw.timeoutMs ?? 300000,
  }
}
