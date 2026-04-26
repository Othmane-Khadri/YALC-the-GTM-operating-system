/**
 * Skill runner — executes a registered skill with key/value inputs.
 *
 * Backs the `skills:run <skillId>` CLI command. Resolves the skill from the
 * registry (with `md:<name>` fallback), parses inputs, and streams events
 * to stdout in the same shape the pipeline runner uses.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import type { Skill } from './types'

export interface RunSkillOpts {
  input?: string[]
  inputFile?: string
  output?: string
  tenant?: string
}

function parseKvInputs(pairs: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const raw of pairs) {
    const eq = raw.indexOf('=')
    if (eq === -1) {
      throw new Error(`Invalid --input "${raw}". Expected key=value.`)
    }
    const key = raw.slice(0, eq).trim()
    const value = raw.slice(eq + 1)
    if (!key) {
      throw new Error(`Invalid --input "${raw}". Empty key.`)
    }
    out[key] = value
  }
  return out
}

async function resolveSkill(skillId: string): Promise<Skill | null> {
  const { getSkillRegistryReady } = await import('./registry')
  const registry = await getSkillRegistryReady()
  // Try the literal id first (e.g. find-companies, md:my-skill).
  const direct = registry.get(skillId)
  if (direct) return direct
  // Markdown skills are registered as md:<name> — fall back if the user
  // passed the bare name.
  if (!skillId.startsWith('md:')) {
    const md = registry.get(`md:${skillId}`)
    if (md) return md
  }
  return null
}

export async function runSkill(skillId: string, opts: RunSkillOpts): Promise<void> {
  const skill = await resolveSkill(skillId)
  if (!skill) {
    console.error(
      `Skill "${skillId}" not found. Run \`yalc-gtm skills:browse --installed\` to see installed skills.`,
    )
    process.exit(1)
  }

  // Build inputs from --input k=v repeats and/or --input-file.
  let inputs: Record<string, unknown> = {}
  if (opts.inputFile) {
    const filePath = resolve(process.cwd(), opts.inputFile)
    if (!existsSync(filePath)) {
      console.error(`Input file not found: ${filePath}`)
      process.exit(1)
    }
    try {
      inputs = JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch (err) {
      console.error(`Input file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }
  if (opts.input && opts.input.length > 0) {
    try {
      inputs = { ...inputs, ...parseKvInputs(opts.input) }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  }

  // Validate required inputs against the skill's declared schema.
  const schema = (skill.inputSchema ?? {}) as Record<string, unknown>
  const required = (schema.required as string[] | undefined) ?? []
  const missing = required.filter(k => inputs[k] === undefined || inputs[k] === null || inputs[k] === '')
  if (missing.length > 0) {
    console.error(`Missing required input(s): ${missing.join(', ')}`)
    console.error(`Run: yalc-gtm skills:info ${skillId}  to see the input schema.`)
    process.exit(1)
  }

  // Build a minimal SkillContext compatible with the pipeline runner shape.
  const { getRegistryReady } = await import('../providers/registry')
  const providers = await getRegistryReady()
  const context = {
    framework: null as any,
    intelligence: [],
    providers,
    userId: opts.tenant ?? 'default',
  }

  const collected: unknown[] = []
  let exitCode = 0

  for await (const event of skill.execute(inputs, context as any)) {
    if (event.type === 'progress') {
      console.error(`[${event.percent}%] ${event.message}`)
    } else if (event.type === 'error') {
      console.error(`ERROR: ${event.message}`)
      exitCode = 1
    } else if (event.type === 'result') {
      collected.push(event.data)
    } else if (event.type === 'approval_needed') {
      console.error(`Approval needed: ${event.title} — ${event.description}`)
    } else if (event.type === 'signal') {
      console.error(`Signal: ${event.signalType}`)
    }
  }

  const output = collected.length === 1 ? collected[0] : collected
  const serialized = JSON.stringify(output, null, 2)

  if (opts.output) {
    const outPath = resolve(process.cwd(), opts.output)
    writeFileSync(outPath, serialized + '\n')
    console.error(`Wrote output to ${outPath}`)
  } else {
    console.log(serialized)
  }

  if (exitCode !== 0) {
    process.exit(exitCode)
  }
}
