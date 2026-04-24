// ─── GTM-OS — Public API ─────────────────────────────────────────────────────
// This is the main entry point for library consumers.
// Import from 'gtm-os' to access types, registries, skills, and utilities.

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  StepExecutor,
  ProviderCapability,
  ProviderMetadata,
  WorkflowStepInput,
  ExecutionContext,
  RowBatch,
} from './lib/providers/types'

export type {
  Skill,
  SkillEvent,
  SkillContext,
  SkillCategory,
  SkillMetadata,
} from './lib/skills/types'

export type {
  GTMFramework,
  ICPSegment,
  CompetitorProfile,
  Learning,
  Objection,
  CompanyStage,
  ChannelType,
} from './lib/framework/types'

export type {
  GTMOSConfig,
  NotionConfig,
  UnipileConfig,
  QualificationConfig,
  CrustdataConfig,
  FullEnrichConfig,
} from './lib/config/types'

export type {
  ReviewRequest,
  ReviewType,
  ReviewPriority,
  ReviewStatus,
  ReviewAction,
} from './lib/review/types'

// ─── Registries ──────────────────────────────────────────────────────────────
export {
  ProviderRegistry,
  registerBuiltinProviders,
  getRegistry,
  getRegistryReady,
} from './lib/providers/registry'

export {
  SkillRegistry,
  registerBuiltinSkills,
  getSkillRegistry,
  getSkillRegistryReady,
} from './lib/skills/registry'

// ─── Built-in skills ─────────────────────────────────────────────────────────
export { findCompaniesSkill } from './lib/skills/builtin/find-companies'
export { enrichLeadsSkill } from './lib/skills/builtin/enrich-leads'
export { qualifyLeadsSkill } from './lib/skills/builtin/qualify-leads'
export { exportDataSkill } from './lib/skills/builtin/export-data'
export { optimizeSkill } from './lib/skills/builtin/optimize-skill'

// ─── Review ──────────────────────────────────────────────────────────────────
export { ReviewQueue } from './lib/review/queue'
export { JsonFileReviewAdapter } from './lib/review/adapters'
export type { ReviewAdapter } from './lib/review/adapters'

// ─── Framework ───────────────────────────────────────────────────────────────
export { buildFrameworkContext, loadFramework, saveFramework, updateFramework } from './lib/framework/context'
export { createEmptyFramework } from './lib/framework/template'

// ─── Config ──────────────────────────────────────────────────────────────────
export { loadConfig, getConfig } from './lib/config/loader'

// ─── Server ──────────────────────────────────────────────────────────────────
export { createApp, startServer } from './lib/server/index'

// ─── Factory ─────────────────────────────────────────────────────────────────
export { createGtmOS } from './lib/factory'
export type { GTMOSOptions, GTMOSInstance } from './lib/factory'
