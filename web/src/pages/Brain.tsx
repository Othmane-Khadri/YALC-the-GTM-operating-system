/**
 * /brain — context viewer + in-place editor (C4).
 *
 * Reads `~/.gtm-os/{company_context.yaml, framework.yaml, voice/, ...}`
 * via /api/brain/context. Each section becomes a card with the rendered
 * yaml/markdown body, a confidence badge (when known), a Regenerate button
 * (proxies to `start --regenerate`), and — for YAML-backed sections — an
 * Edit toggle that flips the card into a textarea-driven editor.
 *
 * Saves go to `POST /api/brain/section` with `{ path: <section_root>,
 * value: <parsed_object> }`. The server merges the new value into the live
 * yaml, flips the per-section confidence sidecar to 1.0, and appends an
 * audit-log line. No re-synthesis runs.
 *
 * Optimistic UI: the local content updates immediately on Save click; on
 * failure we restore the previous value and surface an inline error
 * (the SPA doesn't ship a separate toast layer — see web/src/lib/feedback.ts).
 */

import { useCallback, useEffect, useState } from 'react'
import yaml from 'js-yaml'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import {
  bucketBadgeClass,
  bucketForConfidence,
  describeError,
  eyebrowClass,
  preBlockClass,
} from '@/lib/feedback'

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

interface BrainSectionFile {
  canonical: string
  abs: string
  content: string
}

interface BrainSection {
  id: SectionId
  files: BrainSectionFile[]
  confidence: number | null
  confidence_signals: {
    input_chars: number
    llm_self_rating: number
    has_metadata_anchors: boolean
  } | null
}

interface ContextResponse {
  tenant: string
  live_root: string
  sections: BrainSection[]
}

const TITLES: Record<SectionId, string> = {
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

/**
 * Sections that map onto a single editable YAML file. These are the ones
 * `POST /api/brain/section` accepts as path roots — every other section is
 * still viewable but not editable from this page.
 */
const EDITABLE_SECTIONS: ReadonlySet<SectionId> = new Set([
  'company_context',
  'framework',
  'icp',
  'campaign_templates',
  'config',
])

/**
 * Pick the canonical file whose content the editor mutates. For sections
 * with multiple files (positioning/, voice/) we'd need a different surface
 * — for now those aren't editable from /brain.
 */
function primaryFileFor(section: BrainSection): BrainSectionFile | null {
  if (section.files.length === 0) return null
  // For `icp` we want `icp/segments.yaml` specifically.
  if (section.id === 'icp') {
    return (
      section.files.find((f) => f.canonical === 'icp/segments.yaml') ??
      section.files[0]
    )
  }
  return section.files[0]
}

interface EditState {
  /** The textarea draft value (raw YAML). */
  draft: string
  /** Snapshot of the on-disk content captured the moment we entered edit mode. */
  prior: string
  /** True while a save call is in flight. */
  busy: boolean
  /** Last save error, surfaced inline. */
  error: string | null
}

export function Brain() {
  const [data, setData] = useState<ContextResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [errorMap, setErrorMap] = useState<Record<string, string | null>>({})
  const [regenMessage, setRegenMessage] = useState<string | null>(null)
  /** When a section id is present here, the card is in edit mode. */
  const [edits, setEdits] = useState<Record<string, EditState>>({})

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      setData(await api.get<ContextResponse>('/api/brain/context'))
    } catch (err) {
      setLoadError(describeError(err, 'Failed to load context'))
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const handleEnterEdit = (s: BrainSection) => {
    const file = primaryFileFor(s)
    if (!file) return
    setEdits((prev) => ({
      ...prev,
      [s.id]: {
        draft: file.content,
        prior: file.content,
        busy: false,
        error: null,
      },
    }))
  }

  const handleCancelEdit = (id: SectionId) => {
    setEdits((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const handleDraftChange = (id: SectionId, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...prev[id], draft: value },
    }))
  }

  const handleSave = async (s: BrainSection) => {
    const state = edits[s.id]
    if (!state) return
    // Parse client-side so we send a structured value the server can merge.
    let parsed: unknown
    try {
      parsed = yaml.load(state.draft)
    } catch (err) {
      setEdits((prev) => ({
        ...prev,
        [s.id]: {
          ...prev[s.id],
          error: err instanceof Error ? err.message : 'Invalid YAML',
        },
      }))
      return
    }

    // Optimistic local update — patch the file's `content` in `data`
    // immediately. Restore on error.
    const file = primaryFileFor(s)
    if (!file) return
    setEdits((prev) => ({
      ...prev,
      [s.id]: { ...prev[s.id], busy: true, error: null },
    }))
    setData((prev) => patchSectionContent(prev, s.id, file.canonical, state.draft))

    try {
      await api.post('/api/brain/section', {
        path: s.id,
        value: parsed,
      })
      // Successful save — exit edit mode, clear local state.
      setEdits((prev) => {
        const next = { ...prev }
        delete next[s.id]
        return next
      })
    } catch (err) {
      // Rollback: restore the prior content and stay in edit mode so the
      // user can see what went wrong without losing their draft.
      setData((prev) => patchSectionContent(prev, s.id, file.canonical, state.prior))
      setEdits((prev) => ({
        ...prev,
        [s.id]: {
          ...prev[s.id],
          busy: false,
          error: describeError(err, 'Save failed'),
        },
      }))
    }
  }

  const handleRegenerate = async (id: SectionId) => {
    setBusy((p) => ({ ...p, [id]: true }))
    setErrorMap((p) => ({ ...p, [id]: null }))
    setRegenMessage(null)
    try {
      await api.post(`/api/brain/regenerate/${encodeURIComponent(id)}`, {})
      setRegenMessage(
        `Regenerated ${TITLES[id]}. Open /setup/review to commit the new draft.`,
      )
    } catch (err) {
      setErrorMap((p) => ({ ...p, [id]: describeError(err, 'Regenerate failed') }))
    } finally {
      setBusy((p) => ({ ...p, [id]: false }))
    }
  }

  if (loadError) {
    return (
      <main className="min-h-screen px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <h1 className="font-heading text-3xl font-bold mb-4">Brain</h1>
          <Card>
            <CardContent className="pt-6">
              <p className="text-destructive">{loadError}</p>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  const sections = data?.sections ?? []
  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <p className={eyebrowClass}>Brain</p>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Context viewer</h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-1">
              tenant {data.tenant} · {data.live_root}
            </p>
          )}
        </header>

        {regenMessage && (
          <p className="text-sm" data-testid="brain-regen-message">{regenMessage}</p>
        )}

        <div className="space-y-4">
          {sections.map((s) => (
            <BrainSectionCard
              key={s.id}
              section={s}
              edit={edits[s.id] ?? null}
              regenBusy={!!busy[s.id]}
              regenError={errorMap[s.id] ?? null}
              onEnterEdit={() => handleEnterEdit(s)}
              onCancelEdit={() => handleCancelEdit(s.id)}
              onDraftChange={(v) => handleDraftChange(s.id, v)}
              onSave={() => handleSave(s)}
              onRegenerate={() => handleRegenerate(s.id)}
            />
          ))}
        </div>
      </div>
    </main>
  )
}

interface BrainSectionCardProps {
  section: BrainSection
  edit: EditState | null
  regenBusy: boolean
  regenError: string | null
  onEnterEdit: () => void
  onCancelEdit: () => void
  onDraftChange: (value: string) => void
  onSave: () => void
  onRegenerate: () => void
}

export function BrainSectionCard({
  section: s,
  edit,
  regenBusy,
  regenError,
  onEnterEdit,
  onCancelEdit,
  onDraftChange,
  onSave,
  onRegenerate,
}: BrainSectionCardProps) {
  const bucket = s.confidence == null ? null : bucketForConfidence(s.confidence)
  const tooltip = s.confidence_signals
    ? `input_chars=${s.confidence_signals.input_chars}\nllm_self_rating=${s.confidence_signals.llm_self_rating}\nhas_metadata_anchors=${s.confidence_signals.has_metadata_anchors}`
    : 'no signals captured'
  const editable = EDITABLE_SECTIONS.has(s.id)
  const editing = !!edit

  return (
    <Card data-testid={`brain-card-${s.id}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{TITLES[s.id]}</CardTitle>
            <CardDescription className="font-mono text-xs">
              {s.files.map((f) => f.canonical).join(' · ')}
            </CardDescription>
          </div>
          {bucket && (
            <Badge
              data-testid={`brain-confidence-${s.id}`}
              title={tooltip}
              className={bucketBadgeClass(bucket)}
            >
              {bucket} · {s.confidence!.toFixed(2)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <EditForm
            section={s}
            edit={edit!}
            onDraftChange={onDraftChange}
            onSave={onSave}
            onCancel={onCancelEdit}
          />
        ) : (
          <>
            {s.files.map((f) => (
              <pre
                key={f.canonical}
                data-testid={`brain-content-${f.canonical}`}
                className={preBlockClass}
              >
                {f.content}
              </pre>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              {editable && (
                <Button
                  size="sm"
                  variant="default"
                  data-testid={`brain-edit-${s.id}`}
                  onClick={onEnterEdit}
                >
                  Edit
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                data-testid={`brain-regen-${s.id}`}
                disabled={regenBusy}
                onClick={onRegenerate}
              >
                {regenBusy ? 'Regenerating…' : 'Regenerate this section'}
              </Button>
            </div>
            {regenError && (
              <p
                data-testid={`brain-error-${s.id}`}
                className="text-xs text-destructive"
              >
                {regenError}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

interface EditFormProps {
  section: BrainSection
  edit: EditState
  onDraftChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}

function EditForm({ section: s, edit, onDraftChange, onSave, onCancel }: EditFormProps) {
  const file = primaryFileFor(s)
  return (
    <>
      <p className="text-xs text-muted-foreground font-mono">
        editing {file?.canonical ?? s.id}
      </p>
      <textarea
        data-testid={`brain-textarea-${s.id}`}
        className="w-full min-h-[280px] rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        value={edit.draft}
        spellCheck={false}
        disabled={edit.busy}
        onChange={(e) => onDraftChange(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="default"
          data-testid={`brain-save-${s.id}`}
          disabled={edit.busy}
          onClick={onSave}
        >
          {edit.busy ? 'Saving…' : 'Save'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid={`brain-cancel-${s.id}`}
          disabled={edit.busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
      {edit.error && (
        <p
          data-testid={`brain-save-error-${s.id}`}
          className="text-xs text-destructive"
        >
          {edit.error}
        </p>
      )}
    </>
  )
}

/**
 * Replace the `content` of one file inside a `BrainSection` immutably.
 * Used by the optimistic-update path so the visible YAML reflects the
 * pending save before the server confirms.
 */
function patchSectionContent(
  prev: ContextResponse | null,
  id: SectionId,
  canonical: string,
  content: string,
): ContextResponse | null {
  if (!prev) return prev
  return {
    ...prev,
    sections: prev.sections.map((s) =>
      s.id !== id
        ? s
        : {
            ...s,
            files: s.files.map((f) => (f.canonical === canonical ? { ...f, content } : f)),
          },
    ),
  }
}
