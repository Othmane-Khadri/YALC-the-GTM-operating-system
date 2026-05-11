/**
 * Structured input form for the /skills "Run with these inputs" panel.
 *
 * Renders one control per top-level property of the skill's input
 * schema. Falls back to a raw JSON textarea when the schema is missing
 * or contains a property shape we can't render faithfully (e.g. arrays
 * of objects). Required fields get an asterisk in the destructive token
 * colour (`text-destructive` resolves through `tailwind.config.ts` →
 * `web/brand/tokens.json` — no inline hex).
 *
 * State is owned by the parent so it can persist across reloads via
 * `savePersistedInputs` and submit a coerced payload on Run.
 */

import {
  buildFormFields,
  hasUnsupportedSchema,
  type FormField,
  type RawFormValues,
  type SkillInputSchema,
} from '@/lib/skills-form'

interface SkillInputFormProps {
  skillId: string
  schema: SkillInputSchema | undefined
  values: RawFormValues
  errors: Record<string, string>
  onChange: (next: RawFormValues) => void
  /** When true, render the JSON textarea regardless (user toggle). */
  forceJson?: boolean
  /** Raw JSON textarea content when in fallback mode. */
  jsonText?: string
  onJsonTextChange?: (next: string) => void
  jsonError?: string | null
  /** Show a "use raw JSON" toggle even when the schema is supported. */
  allowJsonToggle?: boolean
  onToggleJson?: () => void
}

const inputClass =
  'w-full rounded-md border border-border bg-background p-2 text-sm font-mono'

const labelClass = 'block space-y-1 text-xs'

const requiredAsteriskClass = 'ml-0.5 text-destructive font-bold'

const helperTextClass = 'mt-0.5 text-muted-foreground font-mono text-[11px]'

const errorTextClass = 'mt-0.5 text-destructive font-mono text-[11px]'

export function SkillInputForm(props: SkillInputFormProps) {
  const { schema, values, errors, onChange, skillId } = props
  const unsupported = hasUnsupportedSchema(schema)
  const useFallback = props.forceJson || unsupported

  if (useFallback) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {unsupported
            ? 'This skill exposes inputs the structured form does not support — paste a JSON object below.'
            : 'Raw JSON mode.'}
        </p>
        <textarea
          data-testid="skills-form-fallback-json"
          aria-label={`Raw JSON inputs for ${skillId}`}
          className={`${inputClass} h-40`}
          value={props.jsonText ?? ''}
          onChange={(e) => props.onJsonTextChange?.(e.target.value)}
        />
        {props.jsonError && (
          <p className={errorTextClass} data-testid="skills-form-json-error">
            {props.jsonError}
          </p>
        )}
        {props.allowJsonToggle && !unsupported && (
          <button
            type="button"
            data-testid="skills-form-toggle-structured"
            onClick={props.onToggleJson}
            className="text-xs underline text-muted-foreground hover:text-foreground"
          >
            Back to structured form
          </button>
        )}
      </div>
    )
  }

  const fields = buildFormFields(schema)

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <FieldRow
          key={field.key}
          field={field}
          value={values[field.key]}
          error={errors[field.key]}
          onChange={(next) => onChange({ ...values, [field.key]: next })}
        />
      ))}
      {props.allowJsonToggle && (
        <details className="text-xs">
          <summary
            className="cursor-pointer text-muted-foreground hover:text-foreground"
            data-testid="skills-form-toggle-json"
          >
            Use raw JSON instead
          </summary>
          <p className="mt-2 text-muted-foreground">
            Switch to the JSON textarea below if the structured form does not
            cover what you need.
          </p>
          <button
            type="button"
            onClick={props.onToggleJson}
            className="mt-1 underline text-muted-foreground hover:text-foreground"
          >
            Open raw JSON editor
          </button>
        </details>
      )}
    </div>
  )
}

// ─── one field row ──────────────────────────────────────────────────────────

interface FieldRowProps {
  field: FormField
  value: unknown
  error?: string
  onChange: (next: unknown) => void
}

function FieldRow({ field, value, error, onChange }: FieldRowProps) {
  const inputId = `skills-input-${field.key}`
  const ariaInvalid = error ? true : undefined
  const ariaRequired = field.required ? true : undefined

  return (
    <label className={labelClass} htmlFor={inputId}>
      <span className="font-mono">
        {field.key}
        {field.required && (
          <span aria-hidden="true" className={requiredAsteriskClass}>
            *
          </span>
        )}
      </span>
      {renderControl(field, value, onChange, inputId, ariaInvalid, ariaRequired)}
      {field.description && !error && (
        <span className={helperTextClass}>{field.description}</span>
      )}
      {error && (
        <span
          className={errorTextClass}
          data-testid={`skills-error-${field.key}`}
        >
          {error}
        </span>
      )}
    </label>
  )
}

function renderControl(
  field: FormField,
  value: unknown,
  onChange: (next: unknown) => void,
  inputId: string,
  ariaInvalid: true | undefined,
  ariaRequired: true | undefined,
) {
  switch (field.control) {
    case 'checkbox':
      return (
        <input
          id={inputId}
          data-testid={inputId}
          type="checkbox"
          aria-required={ariaRequired}
          aria-invalid={ariaInvalid}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-primary"
        />
      )
    case 'enum':
      return (
        <select
          id={inputId}
          data-testid={inputId}
          aria-required={ariaRequired}
          aria-invalid={ariaInvalid}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        >
          <option value="">{field.required ? '— select —' : '— none —'}</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )
    case 'number':
      return (
        <input
          id={inputId}
          data-testid={inputId}
          type="number"
          aria-required={ariaRequired}
          aria-invalid={ariaInvalid}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )
    case 'email':
      return (
        <input
          id={inputId}
          data-testid={inputId}
          type="email"
          aria-required={ariaRequired}
          aria-invalid={ariaInvalid}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )
    case 'url':
      return (
        <input
          id={inputId}
          data-testid={inputId}
          type="url"
          aria-required={ariaRequired}
          aria-invalid={ariaInvalid}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )
    case 'csv':
      return (
        <input
          id={inputId}
          data-testid={inputId}
          type="text"
          aria-required={ariaRequired}
          aria-invalid={ariaInvalid}
          placeholder="comma, separated, values"
          value={
            Array.isArray(value)
              ? value.join(', ')
              : typeof value === 'string'
                ? value
                : ''
          }
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )
    case 'object':
      return (
        <fieldset className="space-y-2 rounded-md border border-border p-2">
          <legend className="px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {field.key}
          </legend>
          {field.children?.map((child) => (
            <FieldRow
              key={child.key}
              field={child}
              value={
                value && typeof value === 'object'
                  ? (value as Record<string, unknown>)[child.key]
                  : undefined
              }
              onChange={(next) => {
                const prev =
                  value && typeof value === 'object' && !Array.isArray(value)
                    ? (value as Record<string, unknown>)
                    : {}
                onChange({ ...prev, [child.key]: next })
              }}
            />
          ))}
        </fieldset>
      )
    case 'text':
    default:
      return (
        <input
          id={inputId}
          data-testid={inputId}
          type="text"
          aria-required={ariaRequired}
          aria-invalid={ariaInvalid}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )
  }
}
