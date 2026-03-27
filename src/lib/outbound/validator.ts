// ─── Outbound Message Validator ──────────────────────────────────────────────
// Validates and optionally auto-fixes outbound messages against the 7 rules.

import { OUTBOUND_RULES, type Violation } from './rules'

export interface ValidationResult {
  valid: boolean
  violations: Violation[]
}

export interface FixResult {
  text: string
  violations: Violation[]
  fixes: string[]
}

/**
 * Validate a message against all outbound rules.
 * Returns valid: true only if all rules pass.
 */
export function validateMessage(text: string): ValidationResult {
  const violations: Violation[] = []

  for (const rule of OUTBOUND_RULES) {
    if (!rule.check(text)) {
      // Extract a short excerpt around the violation
      const excerpt = text.length > 80 ? text.slice(0, 80) + '...' : text
      violations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        excerpt,
      })
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  }
}

/**
 * Validate and attempt to auto-fix violations.
 * Returns the fixed text along with original violations and applied fixes.
 */
export function validateAndFix(text: string): FixResult {
  const violations: Violation[] = []
  const fixes: string[] = []
  let current = text

  for (const rule of OUTBOUND_RULES) {
    if (!rule.check(current)) {
      const excerpt = current.length > 80 ? current.slice(0, 80) + '...' : current
      violations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        excerpt,
      })

      if (rule.fix) {
        const before = current
        current = rule.fix(current)
        if (current !== before) {
          fixes.push(`[${rule.id}] Auto-fixed: ${rule.name}`)
        }
      }
    }
  }

  return { text: current, violations, fixes }
}
