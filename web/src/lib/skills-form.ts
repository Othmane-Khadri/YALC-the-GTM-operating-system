/**
 * Skill input schema → structured form helpers.
 *
 * The /skills page renders a form built from each skill's `inputSchema`
 * (a JSON-Schema-flavored object). These helpers are kept dependency-
 * free so the SPA bundle stays under its 300 KB raw budget — `ajv` is
 * available at the repo root but pulling it into the SPA would push us
 * past the size cap. The validation surface we need (required, basic
 * type checks, enum, format=email|url, number coercion) is small enough
 * to hand-roll.
 *
 * Persistence: per-skill working state is keyed by skill id under a
 * shared prefix so users don't lose work on refresh.
 */

const STORAGE_PREFIX = 'yalc:skills-form:'

export interface SkillPropertySchema {
  type?: string
  description?: string
  format?: string
  enum?: string[]
  default?: unknown
  items?: SkillPropertySchema
  properties?: Record<string, SkillPropertySchema>
  required?: string[]
}

export interface SkillInputSchema {
  type?: string
  properties?: Record<string, SkillPropertySchema>
  required?: string[]
}

export type FieldControl =
  | 'text'
  | 'email'
  | 'url'
  | 'number'
  | 'checkbox'
  | 'csv'
  | 'enum'
  | 'object'

export interface FormField {
  key: string
  control: FieldControl
  required: boolean
  description?: string
  options?: string[]
  itemType?: string
  /** For object-type fields, the nested fields. */
  children?: FormField[]
}

/**
 * Walk the top-level properties of a schema and produce one form field
 * per property. Unknown shapes get returned with `control: 'text'` —
 * `hasUnsupportedSchema` is the gate that switches the page to the JSON
 * fallback before we ever call this for rendering.
 */
export function buildFormFields(schema: SkillInputSchema | undefined): FormField[] {
  if (!schema?.properties) return []
  const required = new Set(schema.required ?? [])
  const out: FormField[] = []
  for (const [key, prop] of Object.entries(schema.properties)) {
    out.push(buildField(key, prop, required.has(key)))
  }
  return out
}

function buildField(key: string, prop: SkillPropertySchema, isRequired: boolean): FormField {
  const base: FormField = {
    key,
    control: 'text',
    required: isRequired,
    description: prop.description,
  }
  if (prop.enum && prop.enum.length > 0) {
    return { ...base, control: 'enum', options: [...prop.enum] }
  }
  switch (prop.type) {
    case 'string':
      if (prop.format === 'email') return { ...base, control: 'email' }
      if (prop.format === 'url' || prop.format === 'uri') return { ...base, control: 'url' }
      return { ...base, control: 'text' }
    case 'number':
    case 'integer':
      return { ...base, control: 'number' }
    case 'boolean':
      return { ...base, control: 'checkbox' }
    case 'array':
      return {
        ...base,
        control: 'csv',
        itemType: prop.items?.type ?? 'string',
      }
    case 'object': {
      const childRequired = new Set(prop.required ?? [])
      const children = Object.entries(prop.properties ?? {}).map(([k, p]) =>
        buildField(k, p, childRequired.has(k)),
      )
      return { ...base, control: 'object', children }
    }
    default:
      // Unknown / unspecified — treat as text so something renders, but
      // `hasUnsupportedSchema` will normally have caught it earlier.
      return base
  }
}

/**
 * Conservative gate: returns true when the schema contains a property
 * shape the form helpers can't faithfully represent (e.g. arrays of
 * objects, unrecognised types). Callers fall back to the raw JSON
 * textarea so power users keep the existing path.
 */
export function hasUnsupportedSchema(schema: SkillInputSchema | undefined): boolean {
  if (!schema?.properties || Object.keys(schema.properties).length === 0) return true
  for (const prop of Object.values(schema.properties)) {
    if (!isSupportedProperty(prop)) return true
  }
  return false
}

function isSupportedProperty(prop: SkillPropertySchema): boolean {
  if (prop.enum && prop.enum.length > 0) return true
  switch (prop.type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
      return true
    case 'array':
      // Only arrays of primitives — objects need a per-row UI we don't render.
      return prop.items?.type === 'string' || prop.items?.type === 'number'
    case 'object':
      // Recurse: every nested property must also be supported.
      if (!prop.properties) return false
      return Object.values(prop.properties).every(isSupportedProperty)
    default:
      return false
  }
}

// ─── coercion + validation ──────────────────────────────────────────────────

export type RawFormValues = Record<string, unknown>

/**
 * Convert raw form state (where numbers are strings, CSV arrays are
 * comma-separated strings, etc.) into the typed payload the API
 * expects. Empty optional fields are stripped so the server's required-
 * field check sees a stable shape.
 */
export function coerceFormValues(
  schema: SkillInputSchema | undefined,
  raw: RawFormValues,
): Record<string, unknown> {
  if (!schema?.properties) return {}
  const out: Record<string, unknown> = {}
  for (const [key, prop] of Object.entries(schema.properties)) {
    const v = raw[key]
    const coerced = coerceOne(prop, v)
    if (coerced !== undefined) out[key] = coerced
  }
  return out
}

function coerceOne(prop: SkillPropertySchema, value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (prop.enum && prop.enum.length > 0) {
    if (typeof value === 'string' && value === '') return undefined
    return value
  }
  switch (prop.type) {
    case 'number':
    case 'integer': {
      if (value === '' || value === null) return undefined
      const n = typeof value === 'number' ? value : Number(String(value).trim())
      return Number.isFinite(n) ? n : value // surface invalid as-is for the validator
    }
    case 'boolean':
      return Boolean(value)
    case 'array': {
      if (Array.isArray(value)) {
        const arr = value.map((s) => String(s).trim()).filter(Boolean)
        return arr.length > 0 ? arr : undefined
      }
      const s = String(value).trim()
      if (!s) return undefined
      const parts = s
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
      return parts.length > 0 ? parts : undefined
    }
    case 'object': {
      if (typeof value !== 'object') return undefined
      const nested = value as RawFormValues
      const out: Record<string, unknown> = {}
      for (const [k, p] of Object.entries(prop.properties ?? {})) {
        const c = coerceOne(p, nested[k])
        if (c !== undefined) out[k] = c
      }
      return Object.keys(out).length > 0 ? out : undefined
    }
    case 'string':
    default: {
      const s = typeof value === 'string' ? value : String(value)
      return s === '' ? undefined : s
    }
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE = /^(https?:)?\/\/.+|^[a-z][a-z0-9+\-.]*:\/\/.+/i

/**
 * Validate the raw form state against the schema. Returns a per-key
 * map of human-readable error messages. An empty result means the
 * payload is safe to submit.
 */
export function validateFormData(
  schema: SkillInputSchema | undefined,
  raw: RawFormValues,
): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!schema?.properties) return errors
  const required = new Set(schema.required ?? [])

  for (const [key, prop] of Object.entries(schema.properties)) {
    const v = raw[key]
    const isEmpty =
      v === undefined ||
      v === null ||
      v === '' ||
      (Array.isArray(v) && v.length === 0)

    if (required.has(key) && isEmpty) {
      errors[key] = 'Required'
      continue
    }
    if (isEmpty) continue

    const propErr = validateOne(prop, v)
    if (propErr) errors[key] = propErr
  }

  return errors
}

function validateOne(prop: SkillPropertySchema, value: unknown): string | null {
  if (prop.enum && prop.enum.length > 0) {
    if (!prop.enum.includes(String(value))) {
      return `Must be one of: ${prop.enum.join(', ')}`
    }
    return null
  }
  switch (prop.type) {
    case 'string': {
      const s = String(value)
      if (prop.format === 'email' && !EMAIL_RE.test(s)) return 'Must be a valid email address'
      if ((prop.format === 'url' || prop.format === 'uri') && !URL_RE.test(s))
        return 'Must be a valid URL'
      return null
    }
    case 'number':
    case 'integer': {
      const n = typeof value === 'number' ? value : Number(String(value).trim())
      if (!Number.isFinite(n)) return 'Must be a number'
      if (prop.type === 'integer' && !Number.isInteger(n)) return 'Must be an integer'
      return null
    }
    case 'boolean':
      return null
    case 'array': {
      const arr = Array.isArray(value)
        ? value
        : String(value)
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
      if (prop.items?.type === 'number') {
        for (const item of arr) {
          if (!Number.isFinite(Number(item))) return 'Each value must be a number'
        }
      }
      return null
    }
    case 'object':
      return null
    default:
      return null
  }
}

// ─── localStorage persistence ───────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') return null
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    return ls ?? null
  } catch {
    return null
  }
}

export function loadPersistedInputs(skillId: string): RawFormValues {
  const ls = safeStorage()
  if (!ls) return {}
  const raw = ls.getItem(STORAGE_PREFIX + skillId)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as RawFormValues
    }
    return {}
  } catch {
    return {}
  }
}

export function savePersistedInputs(skillId: string, values: RawFormValues): void {
  const ls = safeStorage()
  if (!ls) return
  try {
    ls.setItem(STORAGE_PREFIX + skillId, JSON.stringify(values))
  } catch {
    // Quota or serialization error — silently drop; user can re-enter values.
  }
}

export function clearPersistedInputs(skillId: string): void {
  const ls = safeStorage()
  if (!ls) return
  try {
    ls.removeItem(STORAGE_PREFIX + skillId)
  } catch {
    /* ignore */
  }
}
