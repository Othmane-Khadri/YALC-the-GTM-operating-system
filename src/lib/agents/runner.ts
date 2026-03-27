// ─── Background Agent Runner ─────────────────────────────────────────────────
// Executes agent configs with structured logging and retry support.

import { getSkillRegistryReady } from '../skills/registry'
import { AgentLogger } from './logger'
import type { AgentConfig, AgentRunLog } from './types'
import type { SkillContext } from '../skills/types'

export class BackgroundAgent {
  private config: AgentConfig
  private logger: AgentLogger

  constructor(config: AgentConfig) {
    this.config = config
    this.logger = new AgentLogger(config.id)
  }

  async run(): Promise<AgentRunLog> {
    this.logger.log('info', `Starting agent: ${this.config.name}`)

    const registry = await getSkillRegistryReady()

    // Build a minimal context
    const context: SkillContext = {
      framework: null as any,
      intelligence: [],
      providers: {
        resolve: () => ({ id: 'mock', name: 'mock', execute: async function* () {} }),
      } as any,
      userId: 'agent',
    }

    let hasFailure = false

    for (const step of this.config.steps) {
      const skill = registry.get(step.skillId)
      if (!skill) {
        this.logger.endStep(step.skillId, {
          status: 'failed',
          durationMs: 0,
          error: `Skill "${step.skillId}" not found`,
        })
        if (!step.continueOnError) {
          hasFailure = true
          break
        }
        continue
      }

      this.logger.startStep(step.skillId)
      const stepStart = Date.now()

      let retries = 0
      let lastError: string | null = null
      let stepResult: unknown = null
      let succeeded = false

      while (retries <= this.config.maxRetries) {
        try {
          // Execute with timeout
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Step timed out')), this.config.timeoutMs),
          )

          const executePromise = (async () => {
            for await (const event of skill.execute(step.input, context)) {
              if (event.type === 'result') stepResult = event.data
              if (event.type === 'error') throw new Error(event.message)
            }
          })()

          await Promise.race([executePromise, timeoutPromise])
          succeeded = true
          break
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          retries++
          if (retries <= this.config.maxRetries) {
            this.logger.log('warn', `Retrying ${step.skillId} (attempt ${retries + 1})`)
          }
        }
      }

      const durationMs = Date.now() - stepStart

      if (succeeded) {
        this.logger.endStep(step.skillId, {
          status: 'completed',
          durationMs,
          result: stepResult,
        })
      } else {
        this.logger.endStep(step.skillId, {
          status: 'failed',
          durationMs,
          error: lastError ?? 'Unknown error',
        })
        if (!step.continueOnError) {
          hasFailure = true
          break
        }
      }
    }

    const overallStatus = hasFailure ? 'failed' : 'completed'
    return this.logger.complete(overallStatus)
  }
}
