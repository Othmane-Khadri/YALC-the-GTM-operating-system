/**
 * /setup/review — preview-driven onboarding review (Stream 3 form editor).
 *
 * The CLI's capture flow ends by writing draft sections into
 * `~/.gtm-os/_preview/`. This page reads them through `/api/setup/preview`,
 * lets the user edit each one through a form-based card, and commits the
 * approved set back to live via `/api/setup/commit`.
 *
 * Display order is fixed:
 *   Captured inputs    → Company, ICP, Voice
 *   Synthesized outputs → Framework, Positioning, Qualification rules,
 *                         Campaign templates, Search queries
 *   Tenant config      → Config
 *
 * `company_context.yaml` is the only file with a deterministic schema, so
 * it gets a structured form (per-field labels, help text, placeholders).
 * Every other file is shown as a single labeled textarea — its body is
 * synthesized prose / YAML the LLM emits and re-parsing into nested
 * widgets would invent fields the schema doesn't pin down. An Advanced
 * `<details>` block exposes the raw rendered preview alongside.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import yaml from 'js-yaml'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/api'
import { MarkdownView, StructuredValue, tryParseYaml } from '@/lib/render'
import { resolveFieldHelp } from '@/data/setup-field-help'

type SectionId =
  | 'company_context'
  | 'framework'
  | 'voice'
  | 'icp'
  | 'positioning'
  | 'qualification_rules'
  | 'campaign_templates'
  | 'search_queries'
  | 'config'

const SECTION_ORDER: SectionId[] = [
  'company_context',
  'icp',
  'voice',
  'framework',
  'positioning',
  'qualification_rules',
  'campaign_templates',
  'search_queries',
  'config',
]

/** Sections that originate from user capture rather than LLM synthesis. */
const CAPTURE_LAYER_IDS: ReadonlySet<SectionId> = new Set<SectionId>([
  'company_context',
  'icp',
  'voice',
])

/** Sections that should NOT show a "Regenerate with AI" button. */
const NO_REGENERATE: ReadonlySet<SectionId> = new Set<SectionId>([
  'company_context',
  'config',
])

interface ConfidenceSignals {
  input_chars: number
  llm_self_rating: number
  has_metadata_anchors: boolean
}

interface SectionEntry {
  id: SectionId
  canonical: string
  content: string
  confidence: number | null
  confidence_signals: ConfidenceSignals | null
}

interface PreviewResponse {
  tenant: string
  preview_root: string
  captured_at: string | null
  sections: SectionEntry[]
}

interface CardState {
  /** Working copy of `content` (may differ from preview server-side). */
  content: string
  /** True once the user has saved (PUT) at least once during this session. */
  saved: boolean
  /** True while the card is dirty (unsaved edits). */
  dirty: boolean
  /** True if the card is marked for discard at commit time. */
  discard: boolean
  /** Last error from save / regenerate, displayed in-card. */
  error: string | null
  /** True while a network call is in flight on this card. */
  busy: boolean
  /**
   * Kept for backwards-compatibility with the existing test harness, which
   * passes `editing` into `SectionCard`. The form renderer no longer uses
   * a Read/Edit mode toggle — every card is editable by default.
   */
  editing: boolean
}

// ─── Pretty rendering (Advanced block) ──────────────────────────────────────

/**
 * Render a preview file in human-readable form. YAML files get parsed and
 * shown as nested labeled sections; markdown files get rendered as styled
 * prose; everything else falls back to a clean monospace pre-block.
 *
 * Exported because the existing /setup/review tests and the Advanced
 * `<details>` block both reuse it.
 */
export function PrettySectionContent({
  canonical,
  content,
}: {
  canonical: string
  content: string
}): JSX.Element {
  const trimmed = content.trim()
  if (!trimmed) {
    return <p className="text-muted-foreground italic text-sm">empty section</p>
  }
  if (canonical.endsWith('.yaml') || canonical.endsWith('.yml')) {
    const parsed = tryParseYaml(content)
    if (parsed.ok) {
      return <StructuredValue value={parsed.value} />
    }
    return (
      <pre className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">
        {`Couldn't parse YAML (${parsed.error}). Raw content:\n\n${content}`}
      </pre>
    )
  }
  if (canonical.endsWith('.md') || canonical.endsWith('.markdown')) {
    return <MarkdownView content={content} />
  }
  return (
    <pre className="font-mono text-xs whitespace-pre-wrap leading-relaxed">
      {content}
    </pre>
  )
}

// ─── Confidence helpers ────────────────────────────────────────────────────

function bucketForConfidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.85) return 'high'
  if (score >= 0.6) return 'medium'
  return 'low'
}

function badgeColorFor(bucket: 'high' | 'medium' | 'low'): string {
  if (bucket === 'high') return 'bg-confidence-high text-white border-transparent'
  if (bucket === 'medium') return 'bg-confidence-medium text-white border-transparent'
  return 'bg-confidence-low text-white border-transparent'
}

function titleFor(id: SectionId): string {
  const labels: Record<SectionId, string> = {
    company_context: 'Company context',
    framework: 'GTM framework',
    voice: 'Voice & tone',
    icp: 'ICP segments',
    positioning: 'Positioning',
    qualification_rules: 'Qualification rules',
    campaign_templates: 'Campaign templates',
    search_queries: 'Search queries',
    config: 'Config',
  }
  return labels[id]
}

// ─── company_context.yaml: structured form ─────────────────────────────────

/**
 * Mutable shape used by the company-context form. Mirrors the live
 * `CompanyContext` schema (`src/lib/framework/context-types.ts`) but
 * tolerates partial / missing keys so an in-progress capture still loads.
 *
 * Anything we don't render (e.g. `signals`, `icp.competitors_detail`,
 * `icp.segments_detail`) is preserved verbatim by stashing it on
 * `__rest__` keys in the parsed object before re-emit.
 */
interface CompanyContextForm {
  raw: Record<string, unknown>
  parseError: string | null
}

function parseCompanyContext(content: string): CompanyContextForm {
  try {
    const parsed = (yaml.load(content) ?? {}) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null) {
      return { raw: {}, parseError: 'Top-level value is not an object' }
    }
    return { raw: parsed, parseError: null }
  } catch (err) {
    return { raw: {}, parseError: err instanceof Error ? err.message : 'YAML parse failed' }
  }
}

function getPath(obj: Record<string, unknown>, dotted: string): unknown {
  const parts = dotted.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return cur
}

function setPath(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    const next = cur[key]
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cur[key] = {}
    }
    cur = cur[key] as Record<string, unknown>
  }
  const leaf = parts[parts.length - 1]
  if (value === undefined || value === '') {
    delete cur[leaf]
  } else {
    cur[leaf] = value
  }
}

function arrayToLines(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((v) => (typeof v === 'string' ? v : v == null ? '' : String(v)))
    .filter((s) => s !== '')
    .join('\n')
}

function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Whether the captured ICP block satisfies the spec's minimum bar. */
function icpHasContent(ctx: Record<string, unknown>): boolean {
  const icp = (ctx.icp ?? {}) as Record<string, unknown>
  const freeform = typeof icp.segments_freeform === 'string' ? icp.segments_freeform.trim() : ''
  if (freeform.length > 0) return true
  const detail = icp.segments_detail
  if (Array.isArray(detail) && detail.length >= 1) return true
  return false
}

/** Returns null when the form passes required-field validation, or a list of issues. */
function validateRequiredFields(
  byCanonical: Record<string, string>,
): { ok: true } | { ok: false; issues: string[] } {
  const issues: string[] = []
  const ctxStr = byCanonical['company_context.yaml']
  if (typeof ctxStr === 'string') {
    let parsed: Record<string, unknown> = {}
    try {
      parsed = (yaml.load(ctxStr) ?? {}) as Record<string, unknown>
    } catch {
      issues.push('Company context is not valid YAML.')
      return { ok: false, issues }
    }
    const company = (parsed.company ?? {}) as Record<string, unknown>
    const name = typeof company.name === 'string' ? company.name.trim() : ''
    if (!name) {
      issues.push('Company name is required.')
    }
    if (!icpHasContent(parsed)) {
      issues.push(
        'ICP needs either a free-form description or at least one structured segment.',
      )
    }
  } else {
    issues.push('Company context section is missing.')
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}

interface CompanyFormProps {
  /** Current YAML body — single source of truth for the editor. */
  content: string
  /** Called whenever any field in the form mutates. */
  onChange: (next: string) => void
  /** Disabled flag (busy / discarded). */
  disabled?: boolean
  /** Used as a stable id prefix for label/input pairing. */
  idPrefix: string
}

function CompanyContextForm({ content, onChange, disabled, idPrefix }: CompanyFormProps): JSX.Element {
  const parsed = useMemo(() => parseCompanyContext(content), [content])

  if (parsed.parseError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
        <p className="font-semibold text-destructive">Couldn't parse company_context.yaml</p>
        <p className="mt-1 text-muted-foreground">{parsed.parseError}</p>
        <p className="mt-2 text-muted-foreground">
          Open Advanced below to repair the raw file, then refresh.
        </p>
      </div>
    )
  }

  const update = (key: string, value: unknown) => {
    // Clone so React notices the change.
    const cloned = JSON.parse(JSON.stringify(parsed.raw)) as Record<string, unknown>
    setPath(cloned, key, value)
    // Keep `meta.last_updated_at` fresh on any user edit.
    setPath(cloned, 'meta.last_updated_at', new Date().toISOString())
    onChange(yaml.dump(cloned))
  }

  const updateArray = (key: string, text: string) => {
    update(key.replace(/\[\]$/, ''), linesToArray(text))
  }

  const TextField = ({
    fieldKey,
    type = 'text',
    isRequired = false,
  }: {
    fieldKey: string
    type?: 'text' | 'url'
    isRequired?: boolean
  }) => {
    const help = resolveFieldHelp('company_context', fieldKey)
    const inputId = `${idPrefix}-${fieldKey.replace(/[^a-z0-9]+/gi, '-')}`
    const value = String(getPath(parsed.raw, fieldKey) ?? '')
    return (
      <div className="space-y-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          {help.label}
          {isRequired && <span className="text-destructive ml-1">*</span>}
        </label>
        <Input
          id={inputId}
          type={type}
          value={value}
          placeholder={help.placeholder}
          disabled={disabled}
          data-testid={`setup-field-${fieldKey}`}
          onChange={(e) => update(fieldKey, e.target.value)}
        />
        {help.help && <p className="text-xs text-muted-foreground">{help.help}</p>}
      </div>
    )
  }

  const TextareaField = ({
    fieldKey,
    rows = 3,
    isRequired = false,
  }: {
    fieldKey: string
    rows?: number
    isRequired?: boolean
  }) => {
    const help = resolveFieldHelp('company_context', fieldKey)
    const inputId = `${idPrefix}-${fieldKey.replace(/[^a-z0-9]+/gi, '-')}`
    const value = String(getPath(parsed.raw, fieldKey) ?? '')
    return (
      <div className="space-y-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          {help.label}
          {isRequired && <span className="text-destructive ml-1">*</span>}
        </label>
        <textarea
          id={inputId}
          rows={rows}
          value={value}
          placeholder={help.placeholder}
          disabled={disabled}
          data-testid={`setup-field-${fieldKey}`}
          onChange={(e) => update(fieldKey, e.target.value)}
          className="flex w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        {help.help && <p className="text-xs text-muted-foreground">{help.help}</p>}
      </div>
    )
  }

  const ArrayField = ({ fieldKey, rows = 4 }: { fieldKey: string; rows?: number }) => {
    const help = resolveFieldHelp('company_context', fieldKey)
    const inputId = `${idPrefix}-${fieldKey.replace(/[^a-z0-9]+/gi, '-')}`
    const path = fieldKey.replace(/\[\]$/, '')
    const value = arrayToLines(getPath(parsed.raw, path))
    return (
      <div className="space-y-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          {help.label}
        </label>
        <textarea
          id={inputId}
          rows={rows}
          value={value}
          placeholder={help.placeholder}
          disabled={disabled}
          data-testid={`setup-field-${fieldKey}`}
          onChange={(e) => updateArray(fieldKey, e.target.value)}
          className="flex w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        {help.help && <p className="text-xs text-muted-foreground">{help.help}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-xs uppercase tracking-wide text-muted-foreground">Company</legend>
        <TextField fieldKey="company.name" isRequired />
        <TextField fieldKey="company.website" type="url" />
        <TextareaField fieldKey="company.description" rows={2} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TextField fieldKey="company.industry" />
          <TextField fieldKey="company.stage" />
          <TextField fieldKey="company.team_size" />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs uppercase tracking-wide text-muted-foreground">Founder</legend>
        <TextField fieldKey="founder.name" />
        <TextField fieldKey="founder.linkedin" type="url" />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs uppercase tracking-wide text-muted-foreground">Voice</legend>
        <TextareaField fieldKey="voice.description" rows={3} />
        <TextField fieldKey="voice.examples_path" />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs uppercase tracking-wide text-muted-foreground">Sources</legend>
        <TextField fieldKey="sources.website" type="url" />
        <TextField fieldKey="sources.linkedin" type="url" />
        <TextField fieldKey="sources.linkedin_account_id" />
        <ArrayField fieldKey="sources.docs[]" rows={3} />
        <TextField fieldKey="sources.voice" />
      </fieldset>

      <fieldset className="space-y-3 opacity-80">
        <legend className="text-xs uppercase tracking-wide text-muted-foreground">Meta (read-only)</legend>
        <p className="text-xs text-muted-foreground">
          captured_at:{' '}
          <span className="font-mono">{String(getPath(parsed.raw, 'meta.captured_at') ?? '')}</span>
          {' · '}last_updated_at:{' '}
          <span className="font-mono">{String(getPath(parsed.raw, 'meta.last_updated_at') ?? '')}</span>
          {' · '}version:{' '}
          <span className="font-mono">{String(getPath(parsed.raw, 'meta.version') ?? '')}</span>
        </p>
      </fieldset>
    </div>
  )
}

// ─── Generic single-textarea form for every other section ──────────────────

interface FileFieldFormProps {
  sectionId: SectionId
  canonical: string
  content: string
  onChange: (next: string) => void
  disabled?: boolean
  idPrefix: string
}

function FileFieldForm({
  sectionId,
  canonical,
  content,
  onChange,
  disabled,
  idPrefix,
}: FileFieldFormProps): JSX.Element {
  const help = resolveFieldHelp(sectionId, '__file__')
  const inputId = `${idPrefix}-file`
  const isYaml = canonical.endsWith('.yaml') || canonical.endsWith('.yml')
  // YAML parse warning helps the user spot "your edit broke the structure"
  // without shipping a full schema validator.
  const yamlWarning = useMemo(() => {
    if (!isYaml || !content.trim()) return null
    const parsed = tryParseYaml(content)
    return parsed.ok ? null : parsed.error
  }, [isYaml, content])

  const monospace =
    canonical.endsWith('.yaml') ||
    canonical.endsWith('.yml') ||
    canonical.endsWith('.txt')

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="text-sm font-medium">
        {help.label}
      </label>
      <textarea
        id={inputId}
        rows={Math.min(20, Math.max(8, content.split('\n').length + 1))}
        value={content}
        spellCheck={!monospace}
        disabled={disabled}
        data-testid={`setup-textarea-${canonical}`}
        onChange={(e) => onChange(e.target.value)}
        className={`flex w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
          monospace ? 'font-mono text-xs' : ''
        }`}
      />
      {help.help && <p className="text-xs text-muted-foreground">{help.help}</p>}
      {yamlWarning && (
        <p
          data-testid={`setup-yaml-warning-${canonical}`}
          className="text-xs text-destructive"
        >
          YAML parse error — Save will be rejected: {yamlWarning}
        </p>
      )}
    </div>
  )
}

// ─── SectionCard ───────────────────────────────────────────────────────────

interface SectionCardProps {
  section: SectionEntry
  state: CardState
  onEdit: (canonical: string, content: string) => void
  onSave: (canonical: string) => void
  onRegenerate: (id: SectionId) => void
  onToggleDiscard: (canonical: string) => void
  /**
   * Kept for backwards-compatibility with the legacy test harness. The
   * new form-first card no longer flips between Read and Edit modes, so
   * this prop is accepted but unused.
   */
  onSetEditing?: (canonical: string, editing: boolean) => void
}

export function SectionCard({
  section,
  state,
  onEdit,
  onSave,
  onRegenerate,
  onToggleDiscard,
}: SectionCardProps) {
  const conf = section.confidence
  const bucket = conf == null ? null : bucketForConfidence(conf)
  const signals = section.confidence_signals
  const tooltip = signals
    ? `input_chars=${signals.input_chars}\nllm_self_rating=${signals.llm_self_rating}\nhas_metadata_anchors=${signals.has_metadata_anchors}`
    : 'no signals captured'

  const showRegenerate = !NO_REGENERATE.has(section.id)
  const idPrefix = `setup-${section.canonical.replace(/[^a-z0-9]+/gi, '-')}`

  return (
    <Card
      data-testid={`setup-card-${section.canonical}`}
      className={state.discard ? 'opacity-60' : ''}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{titleFor(section.id)}</CardTitle>
            <CardDescription className="font-mono text-xs">
              {section.canonical}
            </CardDescription>
          </div>
          {bucket && (
            <Badge
              data-testid={`setup-confidence-${section.canonical}`}
              title={tooltip}
              className={badgeColorFor(bucket)}
            >
              {bucket} · {conf!.toFixed(2)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {section.id === 'company_context' && section.canonical === 'company_context.yaml' ? (
          <CompanyContextForm
            content={state.content}
            onChange={(next) => onEdit(section.canonical, next)}
            disabled={state.busy || state.discard}
            idPrefix={idPrefix}
          />
        ) : (
          <FileFieldForm
            sectionId={section.id}
            canonical={section.canonical}
            content={state.content}
            onChange={(next) => onEdit(section.canonical, next)}
            disabled={state.busy || state.discard}
            idPrefix={idPrefix}
          />
        )}

        <details className="rounded-md border border-border bg-background/40">
          <summary
            data-testid={`setup-advanced-${section.canonical}`}
            className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Advanced — view rendered preview
          </summary>
          <div className="px-3 pb-3">
            <PrettySectionContent canonical={section.canonical} content={state.content} />
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            data-testid={`setup-save-${section.canonical}`}
            size="sm"
            variant="default"
            disabled={state.busy || state.discard || !state.dirty}
            onClick={() => onSave(section.canonical)}
          >
            {state.dirty ? 'Save changes' : state.saved ? 'Saved' : 'Save'}
          </Button>
          {showRegenerate ? (
            <Button
              data-testid={`setup-regen-${section.canonical}`}
              size="sm"
              variant="outline"
              disabled={state.busy || state.discard || state.dirty}
              onClick={() => onRegenerate(section.id)}
              title={
                state.dirty
                  ? 'Save your changes first — Regenerate would overwrite them.'
                  : 'Re-run synthesis for this section.'
              }
            >
              {state.busy ? 'Regenerating…' : 'Regenerate with AI'}
            </Button>
          ) : (
            <Button
              data-testid={`setup-regen-disabled-${section.canonical}`}
              size="sm"
              variant="outline"
              disabled
              title="Captured inputs — edit the form to update."
            >
              Regenerate with AI
            </Button>
          )}
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <input
              data-testid={`setup-discard-${section.canonical}`}
              type="checkbox"
              checked={state.discard}
              onChange={() => onToggleDiscard(section.canonical)}
            />
            Discard section
          </label>
        </div>
        {state.error && (
          <p
            data-testid={`setup-error-${section.canonical}`}
            className="text-xs text-destructive"
          >
            {state.error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── SetupReview page ───────────────────────────────────────────────────────

export function SetupReview() {
  const [data, setData] = useState<PreviewResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [states, setStates] = useState<Record<string, CardState>>({})
  const [committing, setCommitting] = useState(false)
  const [commitMessage, setCommitMessage] = useState<string | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await api.get<PreviewResponse>('/api/setup/preview')
      setData(res)
      setStates((prev) => {
        const next: Record<string, CardState> = {}
        for (const s of res.sections) {
          const prior = prev[s.canonical]
          if (prior && prior.content === s.content) {
            next[s.canonical] = prior
          } else {
            next[s.canonical] = {
              content: s.content,
              saved: prior?.saved ?? false,
              dirty: false,
              discard: prior?.discard ?? false,
              error: null,
              busy: false,
              editing: prior?.editing ?? false,
            }
          }
        }
        return next
      })
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Failed to load preview (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Failed to load preview'
      setLoadError(msg)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const orderedSections = useMemo(() => {
    if (!data) return []
    const idx: Record<string, number> = {}
    SECTION_ORDER.forEach((id, i) => {
      idx[id] = i
    })
    return [...data.sections].sort((a, b) => {
      const ai = idx[a.id] ?? 99
      const bi = idx[b.id] ?? 99
      if (ai !== bi) return ai - bi
      return a.canonical.localeCompare(b.canonical)
    })
  }, [data])

  // Commit gate. Two distinct conditions:
  //   1. Every non-discarded card must be free of unsaved edits.
  //   2. Required-field validation passes (company name + ICP non-empty).
  const allSaved = useMemo(() => {
    return orderedSections
      .filter((s) => !states[s.canonical]?.discard)
      .every((s) => states[s.canonical] && !states[s.canonical].dirty)
  }, [orderedSections, states])

  const validation = useMemo(() => {
    const byCanonical: Record<string, string> = {}
    for (const s of orderedSections) {
      if (states[s.canonical]?.discard) continue
      byCanonical[s.canonical] = states[s.canonical]?.content ?? s.content
    }
    return validateRequiredFields(byCanonical)
  }, [orderedSections, states])

  const canCommit = allSaved && validation.ok

  const handleEdit = (canonical: string, content: string) => {
    setStates((prev) => ({
      ...prev,
      [canonical]: {
        ...prev[canonical],
        content,
        dirty: content !== prev[canonical]?.content ? true : prev[canonical].dirty,
      },
    }))
  }

  const handleSave = async (canonical: string) => {
    setStates((prev) => ({
      ...prev,
      [canonical]: { ...prev[canonical], busy: true, error: null },
    }))
    try {
      const cur = states[canonical]
      await api.put(`/api/setup/preview/${encodeURIComponent(canonical)}`, {
        content: cur.content,
        canonical,
      })
      setStates((prev) => ({
        ...prev,
        [canonical]: {
          ...prev[canonical],
          busy: false,
          saved: true,
          dirty: false,
          error: null,
        },
      }))
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? typeof err.body === 'object' && err.body && 'message' in err.body
            ? String((err.body as { message: unknown }).message)
            : `Save failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Save failed'
      setStates((prev) => ({
        ...prev,
        [canonical]: { ...prev[canonical], busy: false, error: msg },
      }))
    }
  }

  const handleRegenerate = async (id: SectionId) => {
    // Mark every canonical entry under this section busy.
    const affected = orderedSections.filter((s) => s.id === id).map((s) => s.canonical)
    setStates((prev) => {
      const next = { ...prev }
      for (const c of affected) next[c] = { ...next[c], busy: true, error: null }
      return next
    })
    try {
      // Existing endpoint — see `src/lib/server/routes/setup.ts`. The
      // server re-runs `regeneratePreviewSection()` and rewrites the
      // preview files in place. We then refetch /preview to pull in the
      // new content and reset local state.
      await api.post(`/api/setup/regenerate/${encodeURIComponent(id)}`, {})
      await reload()
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? typeof err.body === 'object' && err.body && 'message' in err.body
            ? String((err.body as { message: unknown }).message)
            : `Regenerate failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Regenerate failed'
      setStates((prev) => {
        const next = { ...prev }
        for (const c of affected) next[c] = { ...next[c], busy: false, error: msg }
        return next
      })
    }
  }

  const handleToggleDiscard = (canonical: string) => {
    setStates((prev) => ({
      ...prev,
      [canonical]: { ...prev[canonical], discard: !prev[canonical]?.discard },
    }))
  }

  const handleSetEditing = (canonical: string, editing: boolean) => {
    setStates((prev) => ({
      ...prev,
      [canonical]: { ...prev[canonical], editing },
    }))
  }

  const handleCommit = async () => {
    setCommitting(true)
    setCommitError(null)
    setCommitMessage(null)
    const discardIds = new Set<SectionId>()
    for (const s of orderedSections) {
      if (states[s.canonical]?.discard) discardIds.add(s.id)
    }
    try {
      const res = await api.post<{
        ok: boolean
        committed: string[]
        discarded: string[]
      }>('/api/setup/commit', { discard: Array.from(discardIds) })
      setCommitMessage(
        `Committed ${res.committed.length} path(s)` +
          (res.discarded.length ? `, discarded ${res.discarded.length}` : '') +
          '. Setup is live.',
      )
      window.history.pushState({}, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? typeof err.body === 'object' && err.body && 'message' in err.body
            ? String((err.body as { message: unknown }).message)
            : `Commit failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Commit failed'
      setCommitError(msg)
    } finally {
      setCommitting(false)
    }
  }

  if (loadError) {
    return (
      <main className="min-h-screen px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <h1 className="font-heading text-3xl font-bold mb-4">Setup review</h1>
          <Card>
            <CardContent className="pt-6">
              <p className="text-destructive">{loadError}</p>
              <p className="mt-4 text-sm text-muted-foreground">
                Run{' '}
                <code className="font-mono">
                  yalc-gtm start --non-interactive --website &lt;url&gt;
                </code>{' '}
                to capture a fresh preview, then refresh this page.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  // Partition for the visual divider.
  const captureCards = orderedSections.filter((s) => CAPTURE_LAYER_IDS.has(s.id))
  const synthesisCards = orderedSections.filter(
    (s) => !CAPTURE_LAYER_IDS.has(s.id) && s.id !== 'config',
  )
  const configCards = orderedSections.filter((s) => s.id === 'config')

  const renderCards = (entries: SectionEntry[]) =>
    entries.map((s) => (
      <SectionCard
        key={s.canonical}
        section={s}
        state={
          states[s.canonical] ?? {
            content: s.content,
            saved: false,
            dirty: false,
            discard: false,
            error: null,
            busy: false,
            editing: false,
          }
        }
        onEdit={handleEdit}
        onSave={handleSave}
        onRegenerate={handleRegenerate}
        onToggleDiscard={handleToggleDiscard}
        onSetEditing={handleSetEditing}
      />
    ))

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Onboarding · review
            </p>
            <h1 className="font-heading text-3xl font-bold tracking-tight">Setup review</h1>
            {data?.captured_at && (
              <p className="text-sm text-muted-foreground mt-1">
                Captured {new Date(data.captured_at).toLocaleString()} · tenant {data.tenant}
              </p>
            )}
          </div>
          <Button
            data-testid="setup-commit"
            variant="gradient"
            disabled={!data || !canCommit || committing}
            onClick={handleCommit}
          >
            {committing ? 'Committing…' : 'Save & Commit'}
          </Button>
        </header>

        {commitMessage && (
          <Card>
            <CardContent className="pt-6 text-sm">{commitMessage}</CardContent>
          </Card>
        )}
        {commitError && (
          <Card>
            <CardContent className="pt-6 text-sm text-destructive">{commitError}</CardContent>
          </Card>
        )}

        {captureCards.length > 0 && (
          <section className="space-y-4">
            <div data-testid="setup-divider-captured" className="border-t border-border pt-4">
              <h2 className="font-heading text-xl font-semibold">Captured inputs</h2>
              <p className="text-sm text-muted-foreground mt-1">
                What you told us about the company, ICP, and voice. Edits here re-shape every
                synthesized section below.
              </p>
            </div>
            {renderCards(captureCards)}
          </section>
        )}

        {synthesisCards.length > 0 && (
          <section className="space-y-4">
            <div data-testid="setup-divider-synthesized" className="border-t border-border pt-4">
              <h2 className="font-heading text-xl font-semibold">Synthesized outputs</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Generated from your captured context. Use Regenerate with AI to re-run a single
                section after you change the captured inputs.
              </p>
            </div>
            {renderCards(synthesisCards)}
          </section>
        )}

        {configCards.length > 0 && (
          <section className="space-y-4">
            <div data-testid="setup-divider-config" className="border-t border-border pt-4">
              <h2 className="font-heading text-xl font-semibold">Tenant config</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Provider preferences and defaults. Provider keys live in your env, not here.
              </p>
            </div>
            {renderCards(configCards)}
          </section>
        )}

        {!validation.ok && data && orderedSections.length > 0 && (
          <Card data-testid="setup-validation-block" className="border-destructive/50">
            <CardContent className="pt-6 space-y-1 text-sm">
              <p className="font-medium text-destructive">Required fields missing</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {validation.issues.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {!allSaved && data && orderedSections.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Save your in-progress edits (or mark sections as discard) to enable Save &amp; Commit.
          </p>
        )}
      </div>
    </main>
  )
}
