// ─── Skill Output Transforms ─────────────────────────────────────────────────
// Maps output of one skill to input of another for pipeline chaining.

type TransformFn = (output: unknown) => Record<string, unknown>

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
