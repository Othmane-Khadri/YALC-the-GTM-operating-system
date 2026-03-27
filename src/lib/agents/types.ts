// ─── Background Agent Types ──────────────────────────────────────────────────

export interface AgentStep {
  skillId: string
  input: Record<string, unknown>
  continueOnError?: boolean
}

export interface AgentSchedule {
  type: 'interval' | 'daily' | 'weekly' | 'cron'
  hour?: number
  minute?: number
  dayOfWeek?: number // 0=Sunday
  intervalMinutes?: number
}

export interface AgentConfig {
  id: string
  name: string
  description: string
  steps: AgentStep[]
  schedule: AgentSchedule
  maxRetries: number
  timeoutMs: number
}

export interface StepLog {
  skillId: string
  status: 'completed' | 'failed' | 'skipped'
  durationMs: number
  result?: unknown
  error?: string
}

export interface AgentRunLog {
  agentId: string
  runId: string
  startedAt: string
  completedAt: string
  status: 'completed' | 'failed' | 'partial'
  steps: StepLog[]
}
