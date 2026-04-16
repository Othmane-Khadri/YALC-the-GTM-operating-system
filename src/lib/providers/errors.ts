/**
 * Provider-layer error taxonomy (Phase 2 / P2.4).
 *
 * These errors surface rule-level routing decisions that the
 * orchestrator should understand (as opposed to generic network
 * failures). They carry enough context for the orchestrator to
 * transparently reroute or fail the step with a helpful message.
 */

export class InsufficientCreditsError extends Error {
  readonly provider: string
  readonly balance: number
  readonly needed: number

  constructor(provider: string, balance: number, needed: number) {
    super(
      `[${provider}] Insufficient credits: balance=${balance}, needed=${needed} (includes 1.5x safety margin)`,
    )
    this.name = 'InsufficientCreditsError'
    this.provider = provider
    this.balance = balance
    this.needed = needed
  }
}

export class EarlyStageSkipError extends Error {
  readonly provider: string
  readonly routeTo: string
  readonly stages: string[]

  constructor(provider: string, routeTo: string, stages: string[]) {
    super(
      `[${provider}] Skipped: target segment stages [${stages.join(', ')}] — route to ${routeTo} instead`,
    )
    this.name = 'EarlyStageSkipError'
    this.provider = provider
    this.routeTo = routeTo
    this.stages = stages
  }
}
