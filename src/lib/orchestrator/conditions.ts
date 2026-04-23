// ─── Safe Condition Evaluator ────────────────────────────────────────────────
// Parses and evaluates a simple DSL for pipeline conditions.
// NO eval(), NO Function constructor. Pure string parsing.

export interface ParsedCondition {
  type: 'comparison' | 'exists' | 'contains'
  field: string
  operator?: string
  value?: string | number | boolean
}

export interface ConditionNode {
  type: 'leaf' | 'and' | 'or'
  condition?: ParsedCondition
  left?: ConditionNode
  right?: ConditionNode
}

/**
 * Parse a condition string into a tree of ConditionNodes.
 * Supports:
 *   field == value | field != value
 *   field > value  | field < value | field >= value | field <= value
 *   field contains value
 *   field exists
 *   condition AND condition
 *   condition OR condition
 *
 * AND binds tighter than OR.
 */
export function parseCondition(expr: string): ConditionNode {
  const trimmed = expr.trim()
  if (!trimmed) {
    throw new ConditionParseError('Empty condition expression')
  }
  return parseOr(trimmed)
}

function parseOr(expr: string): ConditionNode {
  const parts = splitOnKeyword(expr, ' OR ')
  if (parts.length === 1) return parseAnd(parts[0])
  let node: ConditionNode = parseAnd(parts[0])
  for (let i = 1; i < parts.length; i++) {
    node = { type: 'or', left: node, right: parseAnd(parts[i]) }
  }
  return node
}

function parseAnd(expr: string): ConditionNode {
  const parts = splitOnKeyword(expr, ' AND ')
  if (parts.length === 1) return parseLeaf(parts[0])
  let node: ConditionNode = parseLeaf(parts[0])
  for (let i = 1; i < parts.length; i++) {
    node = { type: 'and', left: node, right: parseLeaf(parts[i]) }
  }
  return node
}

function parseLeaf(expr: string): ConditionNode {
  const trimmed = expr.trim()

  // field exists
  const existsMatch = trimmed.match(/^(\S+)\s+exists$/i)
  if (existsMatch) {
    return {
      type: 'leaf',
      condition: { type: 'exists', field: existsMatch[1] },
    }
  }

  // field contains value
  const containsMatch = trimmed.match(/^(\S+)\s+contains\s+(.+)$/i)
  if (containsMatch) {
    return {
      type: 'leaf',
      condition: {
        type: 'contains',
        field: containsMatch[1],
        value: parseValue(containsMatch[2].trim()),
      },
    }
  }

  // Comparison operators: ==, !=, >=, <=, >, <
  const compMatch = trimmed.match(/^(\S+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/)
  if (compMatch) {
    return {
      type: 'leaf',
      condition: {
        type: 'comparison',
        field: compMatch[1],
        operator: compMatch[2],
        value: parseValue(compMatch[3].trim()),
      },
    }
  }

  throw new ConditionParseError(
    `Cannot parse condition: "${trimmed}". Expected format: field operator value, field exists, or field contains value.`,
  )
}

function parseValue(raw: string): string | number | boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1)
  }
  const num = Number(raw)
  if (!isNaN(num) && raw !== '') return num
  return raw
}

/**
 * Split on a keyword but only at the top level (not inside quotes).
 */
function splitOnKeyword(expr: string, keyword: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  let inQuote = false
  let quoteChar = ''

  for (let i = 0; i < expr.length; i++) {
    const char = expr[i]

    if (inQuote) {
      current += char
      if (char === quoteChar) inQuote = false
      continue
    }

    if (char === '"' || char === "'") {
      inQuote = true
      quoteChar = char
      current += char
      continue
    }

    if (char === '(') { depth++; current += char; continue }
    if (char === ')') { depth--; current += char; continue }

    if (depth === 0 && expr.slice(i, i + keyword.length).toUpperCase() === keyword.toUpperCase()) {
      parts.push(current.trim())
      current = ''
      i += keyword.length - 1
      continue
    }

    current += char
  }

  if (current.trim()) parts.push(current.trim())
  return parts
}

/**
 * Evaluate a parsed condition tree against a data record.
 */
export function evaluateCondition(
  node: ConditionNode,
  data: Record<string, unknown>,
): boolean {
  if (node.type === 'and') {
    return evaluateCondition(node.left!, data) && evaluateCondition(node.right!, data)
  }
  if (node.type === 'or') {
    return evaluateCondition(node.left!, data) || evaluateCondition(node.right!, data)
  }

  const condition = node.condition!
  const fieldValue = getNestedField(data, condition.field)

  switch (condition.type) {
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null

    case 'contains': {
      if (typeof fieldValue === 'string') {
        return fieldValue.toLowerCase().includes(String(condition.value).toLowerCase())
      }
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(condition.value)
      }
      return false
    }

    case 'comparison': {
      const target = condition.value
      switch (condition.operator) {
        case '==':
          return fieldValue == target // eslint-disable-line eqeqeq
        case '!=':
          return fieldValue != target // eslint-disable-line eqeqeq
        case '>':
          return typeof fieldValue === 'number' && typeof target === 'number' && fieldValue > target
        case '<':
          return typeof fieldValue === 'number' && typeof target === 'number' && fieldValue < target
        case '>=':
          return typeof fieldValue === 'number' && typeof target === 'number' && fieldValue >= target
        case '<=':
          return typeof fieldValue === 'number' && typeof target === 'number' && fieldValue <= target
        default:
          return false
      }
    }

    default:
      return false
  }
}

/**
 * Convenience: parse + evaluate in one call.
 */
export function checkCondition(expr: string, data: Record<string, unknown>): boolean {
  const node = parseCondition(expr)
  return evaluateCondition(node, data)
}

/**
 * Validate a condition expression without evaluating it.
 * Returns null if valid, or an error message if invalid.
 */
export function validateCondition(expr: string): string | null {
  try {
    parseCondition(expr)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

// Helper: resolve dotted field paths like "company.domain"
function getNestedField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export class ConditionParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConditionParseError'
  }
}
