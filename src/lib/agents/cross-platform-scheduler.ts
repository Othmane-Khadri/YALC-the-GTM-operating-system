/**
 * Cross-platform background agent scheduler.
 *
 * Reads every YAML under ~/.gtm-os/agents/, converts AgentSchedule to a
 * 5-field cron expression, then registers it with node-cron. Works
 * identically on macOS, Windows, and Linux — no OS-level plumbing required.
 *
 * Start once (long-lived process):
 *   yalc-gtm scheduler:start
 *
 * Keep alive across reboots:
 *   macOS / Linux:  pm2 start "yalc-gtm scheduler:start" --name yalc-scheduler
 *   Windows:        pm2 start "yalc-gtm scheduler:start" --name yalc-scheduler
 *                   pm2 save && pm2 startup
 */

import { schedule, validate, type ScheduledTask } from 'node-cron'
import { listYamlAgents, loadAgentFromYaml } from './yaml-loader.js'
import { BackgroundAgent } from './runner.js'
import type { AgentSchedule } from './types.js'

export interface SchedulerEntry {
  agentId: string
  expression: string
  nextRun: string | null
}

/** Convert an AgentSchedule to a 5-field cron expression string. */
export function agentScheduleToCron(s: AgentSchedule): string {
  const m = s.minute ?? 0
  const h = s.hour ?? 8

  switch (s.type) {
    case 'daily':
      return `${m} ${h} * * *`
    case 'weekly':
      return `${m} ${h} * * ${s.dayOfWeek ?? 1}`
    case 'interval': {
      if (!s.intervalMinutes || s.intervalMinutes < 1) {
        throw new Error('intervalMinutes must be >= 1')
      }
      if (s.intervalMinutes >= 60 && s.intervalMinutes % 60 === 0) {
        return `0 */${s.intervalMinutes / 60} * * *`
      }
      return `*/${s.intervalMinutes} * * * *`
    }
    case 'cron':
      if (!s.expression) {
        throw new Error('schedule.type "cron" requires an expression field in the YAML')
      }
      return s.expression
    default:
      throw new Error(`Unknown schedule type: ${String((s as AgentSchedule).type)}`)
  }
}

export class CrossPlatformScheduler {
  private tasks = new Map<string, ScheduledTask>()

  /** Load all agent YAMLs and register cron jobs. Returns count registered. */
  start(): number {
    const ids = listYamlAgents()
    if (ids.length === 0) {
      console.log('No agent YAML files found in ~/.gtm-os/agents/. Install a framework first.')
      return 0
    }

    for (const agentId of ids) {
      const config = loadAgentFromYaml(agentId)
      if (!config) continue

      let expression: string
      try {
        expression = agentScheduleToCron(config.schedule)
      } catch (err) {
        console.error(`  [skip] ${agentId}: ${err instanceof Error ? err.message : err}`)
        continue
      }

      if (!validate(expression)) {
        console.error(`  [skip] ${agentId}: invalid cron expression "${expression}"`)
        continue
      }

      const task = schedule(expression, async () => {
        const ts = new Date().toISOString()
        console.log(`[${ts}] scheduler: starting ${agentId}`)
        try {
          const agent = new BackgroundAgent(config)
          const log = await agent.run()
          console.log(`[${new Date().toISOString()}] scheduler: ${agentId} → ${log.status}`)
        } catch (err) {
          console.error(
            `[${new Date().toISOString()}] scheduler: ${agentId} ERROR — ${err instanceof Error ? err.message : err}`,
          )
        }
      })

      this.tasks.set(agentId, task)
      console.log(`  registered: ${agentId.padEnd(32)} ${expression}`)
    }

    return this.tasks.size
  }

  /** Stop all running tasks and clear registrations. */
  stop(): void {
    for (const task of this.tasks.values()) task.stop()
    this.tasks.clear()
  }

  /** Return a snapshot of registered agents with their next scheduled fire time. */
  status(): SchedulerEntry[] {
    return Array.from(this.tasks.entries()).map(([agentId, task]) => {
      const config = loadAgentFromYaml(agentId)
      let expression = '?'
      try {
        if (config) expression = agentScheduleToCron(config.schedule)
      } catch {
        /* leave as '?' */
      }
      const next = task.getNextRun()
      return {
        agentId,
        expression,
        nextRun: next ? next.toISOString() : null,
      }
    })
  }
}
