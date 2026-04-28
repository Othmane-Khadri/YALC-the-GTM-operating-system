import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'node:os'
import yaml from 'js-yaml'
import type { Skill, SkillEvent, SkillContext, SkillCategory } from './types'
import { validateMarkdownSkill, type MarkdownSkillDefinition } from './markdown-validator'

// ---------------------------------------------------------------------------
// Frontmatter parser — js-yaml-backed for full Draft 7 / nested-object support
// (`output_schema:` blocks need real YAML semantics).
// ---------------------------------------------------------------------------

interface ParsedMarkdown {
  frontmatter: Record<string, unknown>
  body: string
}

function parseMarkdownFrontmatter(raw: string): ParsedMarkdown {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: raw }
  }

  const endIndex = trimmed.indexOf('\n---', 3)
  if (endIndex === -1) {
    return { frontmatter: {}, body: raw }
  }

  const yamlBlock = trimmed.slice(4, endIndex).trim()
  const body = trimmed.slice(endIndex + 4).trim()

  let frontmatter: Record<string, unknown> = {}
  try {
    const parsed = yaml.load(yamlBlock)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>
    }
  } catch {
    // Malformed frontmatter — leave empty so validator surfaces a useful error.
    frontmatter = {}
  }

  return { frontmatter, body }
}

// ---------------------------------------------------------------------------
// Template variable substitution
// ---------------------------------------------------------------------------

function substituteTemplateVars(
  template: string,
  inputs: Record<string, unknown>,
  declaredInputs: MarkdownSkillDefinition['inputs'],
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
    const value = inputs[varName]
    if (value === undefined || value === null) {
      const inputDef = declaredInputs.find(inp => inp.name === varName)
      if (inputDef?.required !== false) {
        throw new Error(`Missing required input: ${varName}`)
      }
      return ''
    }
    return String(value)
  })
}

// ---------------------------------------------------------------------------
// Build a Skill object from a parsed+validated markdown definition
// ---------------------------------------------------------------------------

function buildSkillFromDefinition(def: MarkdownSkillDefinition, promptTemplate: string): Skill {
  const inputProperties: Record<string, unknown> = {}
  const requiredInputs: string[] = []

  for (const inp of def.inputs) {
    inputProperties[inp.name] = {
      type: 'string',
      description: inp.description,
    }
    if (inp.required !== false) {
      requiredInputs.push(inp.name)
    }
  }

  const validCategories: SkillCategory[] = ['research', 'content', 'outreach', 'analysis', 'data', 'integration']
  const category: SkillCategory = validCategories.includes(def.category as SkillCategory)
    ? (def.category as SkillCategory)
    : 'research'

  const skill: Skill = {
    id: `md:${def.name}`,
    name: def.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    version: def.version ?? '1.0.0',
    description: def.description,
    category,
    inputSchema: {
      type: 'object',
      properties: inputProperties,
      required: requiredInputs,
    },
    outputSchema: {
      type: 'object',
      properties: {
        result: { type: 'object' },
      },
    },
    validationSchema: def.output_schema,
    requiredCapabilities: def.capabilities ?? [],

    async *execute(input: unknown, context: SkillContext): AsyncIterable<SkillEvent> {
      const inputObj = (input ?? {}) as Record<string, unknown>

      yield { type: 'progress', message: `Preparing markdown skill: ${def.name}`, percent: 5 }

      // Substitute template variables
      let resolvedPrompt: string
      try {
        resolvedPrompt = substituteTemplateVars(promptTemplate, inputObj, def.inputs)
      } catch (err) {
        yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
        return
      }

      // Capability path takes precedence when declared.
      if (def.capability) {
        yield { type: 'progress', message: `Resolving capability: ${def.capability}`, percent: 10 }
        try {
          const { getCapabilityRegistryReady } = await import('../providers/capabilities.js')
          const capRegistry = await getCapabilityRegistryReady()
          const { adapter, ctx: adapterCtx } = await capRegistry.resolveWithContext(def.capability)
          yield { type: 'progress', message: `Using capability adapter: ${adapter.providerId}`, percent: 30 }
          const result = await adapter.execute({ ...inputObj, prompt: resolvedPrompt }, adapterCtx)
          yield { type: 'result', data: result }
          yield { type: 'progress', message: 'Complete.', percent: 100 }
        } catch (err) {
          yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
        }
        return
      }

      yield { type: 'progress', message: `Resolving provider: ${def.provider}`, percent: 10 }

      // Resolve the provider
      let provider
      try {
        provider = context.providers.resolve({
          stepType: def.capabilities?.[0] ?? 'custom',
          provider: def.provider ?? '',
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        yield {
          type: 'error',
          message: `Provider '${def.provider}' not found. Install with: provider:add --mcp ${def.provider}`,
        }
        return
      }

      yield { type: 'progress', message: `Using provider: ${provider.name}`, percent: 20 }

      const step = {
        stepIndex: 0,
        title: def.name,
        stepType: def.capabilities?.[0] ?? 'custom',
        provider: provider.id,
        description: resolvedPrompt,
        // `config` carries ONLY the user's --input values, i.e. the
        // tool's argument shape. Strict-schema MCP tools (Pydantic, Zod,
        // JSON-schema) reject unknown keys, so we no longer inject
        // `prompt` / `output` here.
        config: { ...inputObj },
        // Skill-runtime fields live on `metadata`. Builtin providers
        // that previously expected `step.config.prompt` should now read
        // `step.metadata.prompt`.
        metadata: {
          prompt: resolvedPrompt,
          output: def.output ?? 'structured_json',
          skillName: def.name,
        },
      }

      const executionContext = {
        frameworkContext: '',
        batchSize: 100,
        totalRequested: 100,
      }

      yield { type: 'progress', message: 'Executing...', percent: 30 }

      let totalRows = 0
      try {
        for await (const batch of provider.execute(step, executionContext)) {
          totalRows += batch.rows.length
          const percent = Math.min(30 + (totalRows / 100) * 60, 90)
          yield { type: 'progress', message: `Received ${totalRows} rows...`, percent }
          yield { type: 'result', data: { rows: batch.rows, batchIndex: batch.batchIndex } }
        }
      } catch (err) {
        yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
        return
      }

      yield { type: 'progress', message: `Complete. ${totalRows} rows returned.`, percent: 100 }
    },
  }

  return skill
}

// ---------------------------------------------------------------------------
// Load all markdown skills from the skills directory
// ---------------------------------------------------------------------------

export function getMarkdownSkillsDir(): string {
  return join(homedir(), '.gtm-os', 'skills')
}

export interface MarkdownSkillLoadResult {
  skill: Skill | null
  filePath: string
  errors: string[]
}

export async function loadMarkdownSkill(filePath: string): Promise<MarkdownSkillLoadResult> {
  const raw = await readFile(filePath, 'utf-8')
  const { frontmatter, body } = parseMarkdownFrontmatter(raw)

  const rawSchema = (frontmatter as Record<string, unknown>).output_schema
  // Distinguish "not declared" (undefined) from "explicit pass-through" (null).
  const outputSchema: Record<string, unknown> | null | undefined =
    rawSchema === undefined
      ? undefined
      : rawSchema === null
        ? null
        : (rawSchema as Record<string, unknown>)

  const definition: MarkdownSkillDefinition = {
    name: frontmatter.name as string,
    description: frontmatter.description as string,
    inputs: (frontmatter.inputs as MarkdownSkillDefinition['inputs']) ?? [],
    provider: frontmatter.provider as string | undefined,
    capability: frontmatter.capability as string | undefined,
    requires_capabilities: frontmatter.requires_capabilities as string[] | undefined,
    capabilities: frontmatter.capabilities as string[] | undefined,
    output: frontmatter.output as string | undefined,
    category: frontmatter.category as string | undefined,
    version: frontmatter.version as string | undefined,
    output_schema: outputSchema,
  }

  const errors = validateMarkdownSkill(definition, body)
  if (errors.length > 0) {
    return { skill: null, filePath, errors }
  }

  if (definition.capability && definition.provider) {
    // Capability wins; provider is treated as a hint for future migration.
    // eslint-disable-next-line no-console
    console.warn(
      `[markdown-loader] Skill ${definition.name} declares both 'capability' and 'provider'; capability will be used.`,
    )
  }

  const skill = buildSkillFromDefinition(definition, body)
  return { skill, filePath, errors: [] }
}

export async function loadAllMarkdownSkills(): Promise<Skill[]> {
  const skillsDir = getMarkdownSkillsDir()
  let entries: string[]

  try {
    const dirEntries = await readdir(skillsDir)
    entries = dirEntries.filter(f => f.endsWith('.md'))
  } catch {
    return []
  }

  const skills: Skill[] = []

  for (const entry of entries) {
    const filePath = join(skillsDir, entry)
    try {
      const result = await loadMarkdownSkill(filePath)
      if (result.skill) {
        skills.push(result.skill)
      } else if (result.errors.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[markdown-loader] Skipping ${entry}: ${result.errors.join('; ')}`)
      }
    } catch {
      // Silently skip unreadable files
    }
  }

  return skills
}

// Re-export for testing
export { parseMarkdownFrontmatter, substituteTemplateVars, buildSkillFromDefinition }
