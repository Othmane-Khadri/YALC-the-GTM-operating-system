// ─── Agent Logger ────────────────────────────────────────────────────────────
// Structured JSON logging for background agent runs.

import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { StepLog, AgentRunLog } from './types'

const LOG_BASE = join(homedir(), '.gtm-os', 'logs', 'agents')

export class AgentLogger {
  private agentId: string
  private runId: string
  private startedAt: string
  private steps: StepLog[] = []
  private logDir: string

  constructor(agentId: string) {
    this.agentId = agentId
    this.runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.startedAt = new Date().toISOString()
    this.logDir = join(LOG_BASE, agentId)
    mkdirSync(this.logDir, { recursive: true })
  }

  log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      agentId: this.agentId,
      runId: this.runId,
      message,
      data,
    }
    console.log(`[${level}] [${this.agentId}] ${message}`)
    // Could append to a running log file if needed
  }

  startStep(skillId: string): void {
    this.log('info', `Starting step: ${skillId}`)
  }

  endStep(skillId: string, result: { status: 'completed' | 'failed' | 'skipped'; durationMs: number; result?: unknown; error?: string }): void {
    this.steps.push({
      skillId,
      status: result.status,
      durationMs: result.durationMs,
      result: result.result,
      error: result.error,
    })
    this.log(result.status === 'failed' ? 'error' : 'info', `Step ${skillId}: ${result.status} (${result.durationMs}ms)`)
  }

  complete(status: 'completed' | 'failed' | 'partial'): AgentRunLog {
    const runLog: AgentRunLog = {
      agentId: this.agentId,
      runId: this.runId,
      startedAt: this.startedAt,
      completedAt: new Date().toISOString(),
      status,
      steps: this.steps,
    }

    const logPath = join(this.logDir, `${this.runId}.json`)
    writeFileSync(logPath, JSON.stringify(runLog, null, 2))
    this.log('info', `Run complete: ${status}. Log: ${logPath}`)

    return runLog
  }

  static getLastRun(agentId: string): AgentRunLog | null {
    const logDir = join(LOG_BASE, agentId)
    if (!existsSync(logDir)) return null

    const files = readdirSync(logDir)
      .filter((f) => f.endsWith('.json'))
      .sort()

    if (files.length === 0) return null

    const lastFile = files[files.length - 1]
    const { readFileSync } = require('fs')
    return JSON.parse(readFileSync(join(logDir, lastFile), 'utf-8'))
  }
}
