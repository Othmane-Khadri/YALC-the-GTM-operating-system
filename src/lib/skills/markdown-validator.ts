// ---------------------------------------------------------------------------
// Markdown Skill Validator
// Validates at load time. Bad skills never register.
// ---------------------------------------------------------------------------

export interface MarkdownInputDefinition {
  name: string
  description: string
  required?: boolean
}

export interface MarkdownSkillDefinition {
  name: string
  description: string
  inputs: MarkdownInputDefinition[]
  /**
   * Legacy — pin the skill to a specific provider id. Mutually
   * exclusive in practice with `capability:` (when both are set the
   * loader logs a WARN and prefers `capability:`).
   */
  provider?: string
  /**
   * Capability-routed skills declare WHAT they need. The runtime
   * resolves the provider via the capability registry's priority list.
   * Validation of the capability id happens at runtime (not load time)
   * so registration order doesn't matter.
   */
  capability?: string
  /** Additional capabilities the skill body needs. */
  requires_capabilities?: string[]
  capabilities?: string[]
  output?: string
  category?: string
  version?: string
}

/**
 * A skill must declare EITHER `provider:` (legacy) OR `capability:`
 * (new). Both is permitted but emits a WARN at load time.
 */
const REQUIRED_FIELDS: (keyof MarkdownSkillDefinition)[] = ['name', 'description', 'inputs']

/**
 * Validates a markdown skill definition and its prompt template.
 * Returns an array of all validation errors (not just the first).
 */
export function validateMarkdownSkill(
  definition: MarkdownSkillDefinition,
  promptTemplate: string,
): string[] {
  const errors: string[] = []

  // 1. Required frontmatter fields
  for (const field of REQUIRED_FIELDS) {
    const val = definition[field]
    if (val === undefined || val === null || val === '') {
      errors.push(`Missing required frontmatter field: ${field}`)
    }
  }

  // 1b. At least one of `provider:` or `capability:` must be present.
  const hasProvider = !!definition.provider && definition.provider !== ''
  const hasCapability = !!definition.capability && definition.capability !== ''
  if (!hasProvider && !hasCapability) {
    errors.push('Missing required frontmatter field: one of `provider` or `capability` must be set')
  }

  // 1c. requires_capabilities must be an array of non-empty strings if present.
  if (definition.requires_capabilities !== undefined) {
    if (!Array.isArray(definition.requires_capabilities)) {
      errors.push('Frontmatter "requires_capabilities" must be an array of capability ids')
    } else {
      for (const c of definition.requires_capabilities) {
        if (typeof c !== 'string' || c.trim() === '') {
          errors.push('Frontmatter "requires_capabilities" entries must be non-empty strings')
          break
        }
      }
    }
  }

  // 2. Name must be a valid slug
  if (definition.name && !/^[a-z][a-z0-9-]*$/.test(definition.name)) {
    errors.push(`Invalid skill name "${definition.name}": must be lowercase alphanumeric with hyphens, starting with a letter`)
  }

  // 3. Inputs must be an array
  if (definition.inputs && !Array.isArray(definition.inputs)) {
    errors.push('Frontmatter "inputs" must be an array')
    return errors // Can't continue input validation
  }

  // 4. Each input needs a name and description
  if (Array.isArray(definition.inputs)) {
    for (let i = 0; i < definition.inputs.length; i++) {
      const inp = definition.inputs[i]
      if (!inp.name) {
        errors.push(`Input at index ${i} is missing "name"`)
      }
      if (!inp.description) {
        errors.push(`Input "${inp.name ?? i}" is missing "description"`)
      }
    }

    // 5. No duplicate input names
    const names = definition.inputs.map(inp => inp.name).filter(Boolean)
    const seen = new Set<string>()
    for (const name of names) {
      if (seen.has(name)) {
        errors.push(`Duplicate input name: ${name}`)
      }
      seen.add(name)
    }
  }

  // 6. All template variables must have corresponding input declarations
  const templateVars = extractTemplateVars(promptTemplate)
  const declaredNames = new Set((definition.inputs ?? []).map(inp => inp.name))
  for (const varName of templateVars) {
    if (!declaredNames.has(varName)) {
      errors.push(`Template variable "{{${varName}}}" has no corresponding input declaration`)
    }
  }

  // 7. Prompt template must not be empty
  if (!promptTemplate || promptTemplate.trim() === '') {
    errors.push('Prompt template (body) is empty')
  }

  // 8. Category validation (if provided)
  if (definition.category) {
    const validCategories = ['research', 'content', 'outreach', 'analysis', 'data', 'integration']
    if (!validCategories.includes(definition.category)) {
      errors.push(`Invalid category "${definition.category}". Valid: ${validCategories.join(', ')}`)
    }
  }

  return errors
}

/**
 * Extract all {{variable}} references from a prompt template.
 */
function extractTemplateVars(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g)
  const vars = new Set<string>()
  for (const match of matches) {
    vars.add(match[1])
  }
  return Array.from(vars)
}
