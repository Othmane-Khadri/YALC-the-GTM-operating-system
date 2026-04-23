// ─── Chain Pipeline Types ────────────────────────────────────────────────────
// Type definitions for YAML-defined declarative pipelines.

export interface PipelineStep {
  skill: string
  input?: Record<string, unknown>
  from?: string
  condition?: string
  transform?: Record<string, string>
  output?: string
  retries?: number
}

export interface PipelineDefinition {
  name: string
  description: string
  version?: string
  steps: PipelineStep[]
}

export interface PipelineCheckpoint {
  pipelineName: string
  pipelineFile: string
  startedAt: string
  updatedAt: string
  currentStep: number
  completedSteps: number[]
  stepResults: Record<string, unknown>
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled'
  error?: string
}

export interface PipelineValidationError {
  step: number
  field: string
  message: string
}

export interface PipelineRunOptions {
  file: string
  dryRun?: boolean
  resumeFrom?: number
  tenantId?: string
}

export interface StepExecutionResult {
  stepIndex: number
  skillId: string
  status: 'completed' | 'skipped' | 'failed'
  data: unknown
  duration: number
  skippedReason?: string
  error?: string
}
