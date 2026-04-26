// ─── agent:create — Interactive Agent Scaffolder ─────────────────────────────

import { input, select, checkbox, confirm } from '@inquirer/prompts'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'
import { getSkillRegistryReady } from '../../lib/skills/registry'

const AGENTS_DIR = join(homedir(), '.gtm-os', 'agents')

export async function runAgentCreate(): Promise<void> {
  console.log('\n  Agent Creator\n')

  // Ensure directory
  if (!existsSync(AGENTS_DIR)) {
    mkdirSync(AGENTS_DIR, { recursive: true })
  }

  // 1. Agent ID
  const id = await input({
    message: 'Agent ID (kebab-case):',
    validate: (val) => {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(val)) return 'Must be kebab-case (e.g., my-agent)'
      if (existsSync(join(AGENTS_DIR, `${val}.yaml`))) return `Agent "${val}" already exists`
      return true
    },
  })

  // 2. Description
  const description = await input({
    message: 'Description:',
  })

  // 3. Select skills
  const registry = await getSkillRegistryReady()
  const allSkills = registry.list()

  const selectedSkillIds = await checkbox({
    message: 'Select skills to chain (space to select, enter to confirm):',
    choices: allSkills.map(s => ({
      name: `${s.id} — ${s.description.slice(0, 60)}`,
      value: s.id,
    })),
  })

  if (selectedSkillIds.length === 0) {
    console.log('No skills selected. Aborting.')
    return
  }

  // 4. Per-skill inputs
  const steps: Array<{ skillId: string; input: Record<string, unknown>; continueOnError: boolean }> = []

  for (const skillId of selectedSkillIds) {
    const skill = registry.get(skillId)
    if (!skill) continue

    console.log(`\n── ${skill.name} (${skillId}) ──`)

    const stepInput: Record<string, unknown> = {}
    const schema = skill.inputSchema as { properties?: Record<string, { type: string; description?: string; default?: unknown }> }

    if (schema?.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        const defaultVal = prop.default !== undefined ? String(prop.default) : ''
        const answer = await input({
          message: `  ${key}${prop.description ? ` (${prop.description})` : ''}:`,
          default: defaultVal,
        })
        if (answer) {
          if (prop.type === 'boolean') stepInput[key] = answer === 'true'
          else if (prop.type === 'number') stepInput[key] = Number(answer)
          else stepInput[key] = answer
        }
      }
    }

    const continueOnError = skillId !== selectedSkillIds[0]
      ? await confirm({ message: `  Continue to next step if ${skillId} fails?`, default: true })
      : false

    steps.push({ skillId, input: stepInput, continueOnError })
  }

  // 5. Schedule
  const scheduleType = await select({
    message: 'Schedule type:',
    choices: [
      { name: 'Daily', value: 'daily' as const },
      { name: 'Weekly', value: 'weekly' as const },
      { name: 'Interval (every N minutes)', value: 'interval' as const },
    ],
  })

  const schedule: Record<string, unknown> = { type: scheduleType }

  if (scheduleType === 'daily' || scheduleType === 'weekly') {
    const hour = await input({ message: 'Hour (0-23):', default: '8' })
    const minute = await input({ message: 'Minute (0-59):', default: '0' })
    schedule.hour = parseInt(hour, 10)
    schedule.minute = parseInt(minute, 10)
  }

  if (scheduleType === 'weekly') {
    const day = await select({
      message: 'Day of week:',
      choices: [
        { name: 'Monday', value: 1 },
        { name: 'Tuesday', value: 2 },
        { name: 'Wednesday', value: 3 },
        { name: 'Thursday', value: 4 },
        { name: 'Friday', value: 5 },
        { name: 'Saturday', value: 6 },
        { name: 'Sunday', value: 0 },
      ],
    })
    schedule.dayOfWeek = day
  }

  if (scheduleType === 'interval') {
    const intervalMin = await input({ message: 'Interval (minutes):', default: '60' })
    schedule.intervalMinutes = parseInt(intervalMin, 10)
  }

  // 6. Retry/timeout
  const maxRetries = await input({ message: 'Max retries per step:', default: '2' })
  const timeoutMs = await input({ message: 'Timeout per step (ms):', default: '300000' })

  // 7. Build and write YAML
  const agentConfig = {
    id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    description,
    steps: steps.map(s => ({
      skillId: s.skillId,
      input: s.input,
      ...(s.continueOnError ? { continueOnError: true } : {}),
    })),
    schedule,
    maxRetries: parseInt(maxRetries, 10),
    timeoutMs: parseInt(timeoutMs, 10),
  }

  const yamlStr = yaml.dump(agentConfig, { lineWidth: 120, noRefs: true })
  const filePath = join(AGENTS_DIR, `${id}.yaml`)
  writeFileSync(filePath, yamlStr)

  console.log(`\n✓ Agent written to ${filePath}`)
  console.log(`\nRun it now:  yalc-gtm agent:run --agent ${id}`)

  // 8. Offer install
  const doInstall = await confirm({ message: 'Install as launchd service now?', default: false })
  if (doInstall) {
    const { execSync } = await import('child_process')
    const { join: pathJoin } = await import('path')
    const { existsSync: pathExists } = await import('fs')
    const { PKG_ROOT } = await import('../../lib/paths')
    // Resolution order: cwd (dev checkout) → PKG_ROOT (installed tarball)
    const cwdPath = pathJoin(process.cwd(), 'scripts', 'install-agent.sh')
    const pkgPath = pathJoin(PKG_ROOT, 'scripts', 'install-agent.sh')
    const scriptPath = pathExists(cwdPath) ? cwdPath : pkgPath
    try {
      const hour = String(schedule.hour ?? 8)
      const minute = String(schedule.minute ?? 0)
      const output = execSync(
        `bash "${scriptPath}" "${id.replace(/[^a-zA-Z0-9_-]/g, '')}" "${hour}" "${minute}"`,
        { encoding: 'utf-8' },
      )
      console.log(output)
    } catch (err) {
      console.error('Installation failed:', err instanceof Error ? err.message : err)
    }
  }
}
