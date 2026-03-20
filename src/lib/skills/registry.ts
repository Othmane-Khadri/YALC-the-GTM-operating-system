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
export function registerBuiltinSkills(registry: SkillRegistry): void {
  const { findCompaniesSkill } = require('./builtin/find-companies')
  const { enrichLeadsSkill } = require('./builtin/enrich-leads')
  const { qualifyLeadsSkill } = require('./builtin/qualify-leads')
  const { exportDataSkill } = require('./builtin/export-data')
  const { optimizeSkill } = require('./builtin/optimize-skill')

  registry.register(findCompaniesSkill)
  registry.register(enrichLeadsSkill)
  registry.register(qualifyLeadsSkill)
  registry.register(exportDataSkill)
  registry.register(optimizeSkill)
}

// Lazy default instance for CLI backward compatibility
let _defaultSkillRegistry: SkillRegistry | null = null

export function getSkillRegistry(): SkillRegistry {
  if (!_defaultSkillRegistry) {
    _defaultSkillRegistry = new SkillRegistry()
    registerBuiltinSkills(_defaultSkillRegistry)
  }
  return _defaultSkillRegistry
}
