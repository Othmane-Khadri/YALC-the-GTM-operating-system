// ─── Skill Output Transforms ─────────────────────────────────────────────────
// Maps output of one skill to input of another for pipeline chaining.
// Supports both legacy hardcoded transforms and generic field mapping.

type TransformFn = (output: unknown) => Record<string, unknown>

// ─── Legacy hardcoded transforms (backward compatibility) ────────────────────

const KNOWN_TRANSFORMS: Record<string, TransformFn> = {
  'scrape-linkedin→qualify-leads': (output) => {
    const data = output as { resultSetId?: string }
    return { resultSetId: data.resultSetId }
  },

  'find-companies→enrich-leads': (output) => {
    const data = output as { companies?: Array<Record<string, unknown>> }
    return { leads: data.companies }
  },

  'qualify-leads→export-data': (output) => {
    const data = output as { resultSetId?: string }
    return { resultSetId: data.resultSetId, format: 'csv' }
  },

  'qualify-leads→email-sequence': (output) => {
    const data = output as { qualified?: number; segment?: string }
    return {
      type: 'lead-nurture',
      audienceContext: `${data.qualified ?? 0} qualified leads`,
    }
  },
}

/**
 * Get a transform function for a pair of skills.
 * Returns null if no known transform exists.
 */
export function getTransform(fromSkillId: string, toSkillId: string): TransformFn | null {
  const key = `${fromSkillId}→${toSkillId}`
  return KNOWN_TRANSFORMS[key] ?? null
}

/**
 * Apply a transform if available, otherwise pass output as-is.
 */
export function applyTransform(
  fromSkillId: string,
  toSkillId: string,
  output: unknown,
  baseInput: Record<string, unknown>,
): Record<string, unknown> {
  const transform = getTransform(fromSkillId, toSkillId)
  if (transform) {
    return { ...baseInput, ...transform(output) }
  }
  return baseInput
}

// ─── Generic Transform Engine ────────────────────────────────────────────────

/**
 * Apply an explicit field mapping from YAML transform config.
 * Maps: { source_field: target_field } — source from output, target in result.
 *
 * Example: { company_url: domain } means output.company_url -> result.domain
 */
export function applyExplicitTransform(
  output: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [sourceField, targetField] of Object.entries(mapping)) {
    const value = getNestedValue(output, sourceField)
    if (value !== undefined) {
      result[targetField] = value
    }
  }
  return result
}

/**
 * Auto-map fields: if an output field name matches an input field name, map it.
 * Returns a new object with matching fields.
 */
export function autoMapFields(
  output: Record<string, unknown>,
  inputSchema: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const expectedFields = extractSchemaFieldNames(inputSchema)

  for (const field of expectedFields) {
    if (field in output && output[field] !== undefined) {
      result[field] = output[field]
    }
  }
  return result
}

/**
 * Full pipeline transform: explicit mapping first, then auto-map remaining fields,
 * then merge with step-level input overrides.
 */
export function applyPipelineTransform(
  previousOutput: unknown,
  stepInput: Record<string, unknown>,
  explicitMapping?: Record<string, string>,
  targetInputSchema?: Record<string, unknown>,
): Record<string, unknown> {
  const output = flattenOutput(previousOutput)
  let mapped: Record<string, unknown> = {}

  // 1. Explicit mapping takes priority
  if (explicitMapping && Object.keys(explicitMapping).length > 0) {
    mapped = applyExplicitTransform(output, explicitMapping)
  }

  // 2. Auto-map remaining fields if we have a target schema
  if (targetInputSchema) {
    const autoMapped = autoMapFields(output, targetInputSchema)
    mapped = { ...autoMapped, ...mapped } // explicit wins
  }

  // 3. Step-level input overrides everything
  return { ...mapped, ...stepInput }
}

/**
 * Validate that a step's required input fields are satisfiable from the
 * previous step's output (considering explicit transforms).
 * Returns list of missing fields, or empty array if all satisfied.
 */
export function validateStepTransform(
  outputFields: string[],
  requiredInputFields: string[],
  stepInput: Record<string, unknown>,
  explicitMapping?: Record<string, string>,
): string[] {
  const availableFields = new Set(outputFields)

  // Fields provided directly in step input
  const directFields = new Set(Object.keys(stepInput))

  // Fields mapped via explicit transform
  const mappedTargets = new Set<string>()
  if (explicitMapping) {
    for (const [source, target] of Object.entries(explicitMapping)) {
      if (availableFields.has(source)) {
        mappedTargets.add(target)
      }
    }
  }

  const missing: string[] = []
  for (const field of requiredInputFields) {
    if (
      !directFields.has(field) &&
      !availableFields.has(field) &&
      !mappedTargets.has(field)
    ) {
      missing.push(field)
    }
  }
  return missing
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Flatten a skill output into a flat Record.
 * If it's already an object, return as-is.
 * If it's an array, wrap it as { items: [...], count: N }.
 * If it's a primitive, wrap as { value: ... }.
 */
function flattenOutput(output: unknown): Record<string, unknown> {
  if (output == null) return {}
  if (Array.isArray(output)) return { items: output, count: output.length }
  if (typeof output === 'object') return output as Record<string, unknown>
  return { value: output }
}

/**
 * Extract field names from a JSON Schema-like object.
 * Handles { properties: { field: { type: ... } } } and flat { field: type } patterns.
 */
function extractSchemaFieldNames(schema: Record<string, unknown>): string[] {
  if (schema.properties && typeof schema.properties === 'object') {
    return Object.keys(schema.properties as Record<string, unknown>)
  }
  // Flat schema: keys are field names
  return Object.keys(schema)
}
