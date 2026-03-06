import type { Skill, SkillMetadata, SkillCategory } from './types'

import { findCompaniesSkill } from './builtin/find-companies'
import { enrichLeadsSkill } from './builtin/enrich-leads'
import { qualifyLeadsSkill } from './builtin/qualify-leads'
import { exportDataSkill } from './builtin/export-data'

class SkillRegistry {
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

// Module-level singleton
const skillRegistry = new SkillRegistry()

// Auto-register built-in skills
skillRegistry.register(findCompaniesSkill)
skillRegistry.register(enrichLeadsSkill)
skillRegistry.register(qualifyLeadsSkill)
skillRegistry.register(exportDataSkill)

export function getSkillRegistry(): SkillRegistry {
  return skillRegistry
}

export { SkillRegistry }
