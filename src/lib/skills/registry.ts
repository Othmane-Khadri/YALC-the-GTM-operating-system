import type { Skill, SkillMetadata, SkillCategory } from './types'

export class SkillRegistry {
  private skills = new Map<string, Skill>()

  register(skill: Skill): void {
    this.skills.set(skill.id, skill)
  }

  unregister(id: string): void {
    this.skills.delete(id)
  }

  get(id: string): Skill | null {
    return this.skills.get(id) ?? null
  }

  list(category?: SkillCategory): SkillMetadata[] {
    const all = Array.from(this.skills.values())
    const filtered = category ? all.filter(s => s.category === category) : all
    return filtered.map(s => ({
      id: s.id,
      name: s.name,
      version: s.version,
      description: s.description,
      category: s.category,
      inputSchema: s.inputSchema,
      outputSchema: s.outputSchema,
    }))
  }

  /**
   * Generates a skill list string for the workflow planner's system prompt.
   */
  getForPlanner(): string {
    const skills = this.list()
    if (skills.length === 0) return 'No skills available.'
    return skills
      .map(s => `- ${s.name} (${s.id}): ${s.description} [category: ${s.category}]`)
      .join('\n')
  }
}

/**
 * Register all built-in skills on a registry instance.
 */
export async function registerBuiltinSkills(registry: SkillRegistry): Promise<void> {
  const { findCompaniesSkill } = await import('./builtin/find-companies')
  const { enrichLeadsSkill } = await import('./builtin/enrich-leads')
  const { qualifyLeadsSkill } = await import('./builtin/qualify-leads')
  const { exportDataSkill } = await import('./builtin/export-data')
  const { optimizeSkill } = await import('./builtin/optimize-skill')
  const { visualizeCampaignsSkill } = await import('./builtin/visualize-campaigns')
  const { scrapeLinkedinSkill } = await import('./builtin/scrape-linkedin')
  const { answerCommentsSkill } = await import('./builtin/answer-comments')
  const { emailSequenceSkill } = await import('./builtin/email-sequence')
  const { orchestrateSkill } = await import('./builtin/orchestrate')
  const { monthlyCampaignReportSkill } = await import('./builtin/monthly-campaign-report')

  registry.register(findCompaniesSkill)
  registry.register(enrichLeadsSkill)
  registry.register(qualifyLeadsSkill)
  registry.register(exportDataSkill)
  registry.register(optimizeSkill)
  registry.register(visualizeCampaignsSkill)
  registry.register(scrapeLinkedinSkill)
  registry.register(answerCommentsSkill)
  registry.register(emailSequenceSkill)
  registry.register(orchestrateSkill)
  registry.register(monthlyCampaignReportSkill)
}

// Lazy default instance for CLI backward compatibility
let _defaultSkillRegistry: SkillRegistry | null = null
let _skillInitPromise: Promise<void> | null = null

export function getSkillRegistry(): SkillRegistry {
  if (!_defaultSkillRegistry) {
    _defaultSkillRegistry = new SkillRegistry()
    _skillInitPromise = registerBuiltinSkills(_defaultSkillRegistry)
  }
  return _defaultSkillRegistry
}

export async function getSkillRegistryReady(): Promise<SkillRegistry> {
  const registry = getSkillRegistry()
  if (_skillInitPromise) await _skillInitPromise
  return registry
}
