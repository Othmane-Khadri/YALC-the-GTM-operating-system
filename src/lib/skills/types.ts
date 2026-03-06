import type { ProviderRegistry } from '../providers/registry'

// ---------------------------------------------------------------------------
// Skill event types — yielded during execution
// ---------------------------------------------------------------------------

export type SkillEvent =
  | { type: 'progress'; message: string; percent: number }
  | { type: 'result'; data: unknown }
  | { type: 'approval_needed'; title: string; description: string; payload: unknown }
  | { type: 'signal'; signalType: string; data: unknown }
  | { type: 'error'; message: string }

// ---------------------------------------------------------------------------
// Skill context — passed into every skill's execute()
// ---------------------------------------------------------------------------

export interface SkillContext {
  framework: import('../framework/types').GTMFramework
  intelligence: unknown[]
  providers: ProviderRegistry
  userId: string
}

// ---------------------------------------------------------------------------
// Skill interface — the core contract
// ---------------------------------------------------------------------------

export type SkillCategory = 'research' | 'content' | 'outreach' | 'analysis' | 'data' | 'integration'

export interface Skill {
  id: string
  name: string
  version: string
  description: string
  category: SkillCategory
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  requiredCapabilities: string[]
  estimatedCost?: (input: unknown) => number
  execute: (input: unknown, context: SkillContext) => AsyncIterable<SkillEvent>
}

// ---------------------------------------------------------------------------
// Skill metadata — lightweight version for planner and UI
// ---------------------------------------------------------------------------

export interface SkillMetadata {
  id: string
  name: string
  version: string
  description: string
  category: SkillCategory
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
}
