import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { Skill, SkillEvent, SkillContext, SkillCategory } from './types'
import { validateMarkdownSkill, type MarkdownSkillDefinition } from './markdown-validator'

// ---------------------------------------------------------------------------
// Frontmatter parser — avoids external dependency (gray-matter)
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
  const frontmatter = parseSimpleYaml(yamlBlock)

  return { frontmatter, body }
}

/**
 * Minimal YAML parser supporting:
 * - key: value (string, number, boolean)
 * - key: [a, b, c] (inline arrays)
 * - key:\n  - item (block arrays with nested objects)
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = yaml.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const match = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (!match) { i++; continue }

    const key = match[1]
    const valueStr = match[2].trim()

    // Inline array: [a, b, c]
    if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
      const inner = valueStr.slice(1, -1)
      result[key] = inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      i++
      continue
    }

    // Non-empty scalar value
    if (valueStr !== '') {
      result[key] = parseScalar(valueStr)
      i++
      continue
    }

    // Block sequence (list of items)
    const items: unknown[] = []
    i++
    while (i < lines.length) {
      const itemLine = lines[i]
      // Check for list item at 2-space indent
      const itemMatch = itemLine.match(/^  - (.+)$/)
      if (!itemMatch) break

      // Check if the next lines are indented sub-keys (object item)
      const firstValue = itemMatch[1].trim()
      const subKeyMatch = firstValue.match(/^(\w[\w-]*):\s*(.+)$/)

      if (subKeyMatch) {
        // Object item starting on the dash line
        const obj: Record<string, unknown> = {}
        obj[subKeyMatch[1]] = parseScalar(subKeyMatch[2])
        i++
        // Collect continuation keys at 4-space indent
        while (i < lines.length) {
          const subLine = lines[i]
          const subMatch = subLine.match(/^    (\w[\w-]*):\s*(.+)$/)
          if (!subMatch) break
          obj[subMatch[1]] = parseScalar(subMatch[2])
          i++
        }
        items.push(obj)
      } else {
        // Simple scalar item
        items.push(parseScalar(firstValue))
        i++
      }
    }
    if (items.length > 0) {
      result[key] = items
    }
    continue
  }

  return result
}

function parseScalar(val: string): string | number | boolean {
  if (val === 'true') return true
  if (val === 'false') return false
  const trimmed = val.replace(/^["']|["']$/g, '')
  const num = Number(trimmed)
  if (!isNaN(num) && trimmed !== '') return num
  return trimmed
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

      yield { type: 'progress', message: `Resolving provider: ${def.provider}`, percent: 10 }

      // Resolve the provider
      let provider
      try {
        provider = context.providers.resolve({
          stepType: def.capabilities?.[0] ?? 'custom',
          provider: def.provider,
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
        config: {
          prompt: resolvedPrompt,
          ...inputObj,
          output: def.output ?? 'structured_json',
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
  return join(process.env.HOME!, '.gtm-os', 'skills')
}

export interface MarkdownSkillLoadResult {
  skill: Skill | null
  filePath: string
  errors: string[]
}

export async function loadMarkdownSkill(filePath: string): Promise<MarkdownSkillLoadResult> {
  const raw = await readFile(filePath, 'utf-8')
  const { frontmatter, body } = parseMarkdownFrontmatter(raw)

  const definition: MarkdownSkillDefinition = {
    name: frontmatter.name as string,
    description: frontmatter.description as string,
    inputs: (frontmatter.inputs as MarkdownSkillDefinition['inputs']) ?? [],
    provider: frontmatter.provider as string,
    capabilities: frontmatter.capabilities as string[] | undefined,
    output: frontmatter.output as string | undefined,
    category: frontmatter.category as string | undefined,
    version: frontmatter.version as string | undefined,
  }

  const errors = validateMarkdownSkill(definition, body)
  if (errors.length > 0) {
    return { skill: null, filePath, errors }
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
