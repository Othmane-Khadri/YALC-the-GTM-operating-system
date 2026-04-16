// ─── Orchestrator Types ──────────────────────────────────────────────────────

export interface PlanStep {
  stepId: string
  skillId: string
  input: Record<string, unknown>
  dependsOnStep?: string
}

export interface Gate {
  type: 'plan' | 'data' | 'action'
  description: string
}

export interface Phase {
  phaseIndex: number
  description: string
  steps: PlanStep[]
  gateAfter: Gate | null
}

export interface OrchestrationPlan {
  query: string
  phases: Phase[]
  createdAt: string
}

export interface PipelineContext {
  stepResults: Map<string, unknown>
  phaseSummaries: string[]
}
