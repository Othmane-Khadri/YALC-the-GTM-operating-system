import { readdir, readFile, access } from 'fs/promises'
import { join } from 'path'
import type { SkillManifest } from './types'
import type { Skill, SkillEvent, SkillContext } from '../skills/types'

export function getSkillsDir(): string {
  return join(process.env.HOME!, '.gtm-os', 'skills')
}

export async function loadCommunitySkills(): Promise<Skill[]> {
  const skillsDir = getSkillsDir()
  let entries: { name: string; isDirectory: () => boolean }[]

  try {
    entries = (await readdir(skillsDir, { withFileTypes: true })) as { name: string; isDirectory: () => boolean }[]
  } catch {
    return []
  }

  const skills: Skill[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillDir = join(skillsDir, entry.name)
    const manifestPath = join(skillDir, 'skill.json')

    let manifest: SkillManifest
    try {
      const raw = await readFile(manifestPath, 'utf-8')
      manifest = JSON.parse(raw) as SkillManifest
    } catch {
      continue
    }

    const mainFile = manifest.main ?? 'index.ts'
    const mainPath = join(skillDir, mainFile)
    try {
      await access(mainPath)
    } catch {
      continue
    }

    const skill: Skill = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      category: manifest.category,
      inputSchema: manifest.inputSchema,
      outputSchema: manifest.outputSchema,
      requiredCapabilities: manifest.requiredCapabilities,
      estimatedCost: manifest.estimatedCostPerRun ? () => manifest.estimatedCostPerRun! : undefined,
      async *execute(input: unknown, context: SkillContext): AsyncIterable<SkillEvent> {
        const mod = await import(mainPath)
        const executeFn = mod.default?.execute ?? mod.execute
        if (typeof executeFn !== 'function') {
          yield { type: 'error', message: `Skill ${manifest.id}: no execute function exported from ${mainFile}` }
          return
        }
        yield* executeFn(input, context)
      },
    }
    skills.push(skill)
  }

  return skills
}
