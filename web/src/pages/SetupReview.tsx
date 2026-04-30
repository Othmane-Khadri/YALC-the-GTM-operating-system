/**
 * /setup/review — preview-driven onboarding review (0.9.B).
 *
 * The CLI's capture flow ends by writing draft sections into
 * `~/.gtm-os/_preview/`. This page reads them through `/api/setup/preview`,
 * lets the user edit each one inline, and commits the approved set back to
 * live via `/api/setup/commit`.
 *
 * Render order is fixed (matches `SECTION_NAMES` on the server). Each
 * section card carries a confidence badge with a tooltip showing the raw
 * signals that fed the score.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { MarkdownView, StructuredValue, tryParseYaml } from '@/lib/render'

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
  'framework',
  'voice',
  'icp',
  'positioning',
  'qualification_rules',
  'campaign_templates',
  'search_queries',
  'config',
]

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
  /** True when the user has flipped this card into raw-edit mode. */
  editing: boolean
}

/**
 * Render a preview file in human-readable form. YAML files get parsed and
 * shown as nested labeled sections; markdown files get rendered as styled
 * prose; everything else falls back to a clean monospace pre-block.
 */
function PrettySectionContent({
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
  // Plain text: search_queries.txt etc — show one line per item.
  return (
    <pre className="font-mono text-xs whitespace-pre-wrap leading-relaxed">
      {content}
    </pre>
  )
}

function bucketForConfidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.85) return 'high'
  if (score >= 0.6) return 'medium'
  return 'low'
}

function badgeColorFor(bucket: 'high' | 'medium' | 'low'): string {
  // Brand tokens: high uses the muted forest green you'd expect for "good";
  // since tokens.json doesn't ship a green/yellow/red triplet we fall back to
  // tinted versions of the existing palette so the badges still read as
  // status indicators. Strict brand-token consumers can tighten in 0.9.G.
  if (bucket === 'high') return 'bg-[#3F8F5A] text-white border-transparent'
  if (bucket === 'medium') return 'bg-[#D4A23A] text-white border-transparent'
  return 'bg-[#C9506E] text-white border-transparent'
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

interface SectionCardProps {
  section: SectionEntry
  state: CardState
  onEdit: (canonical: string, content: string) => void
  onSave: (canonical: string) => void
  onRegenerate: (id: SectionId) => void
  onToggleDiscard: (canonical: string) => void
  onSetEditing: (canonical: string, editing: boolean) => void
}

export function SectionCard({
  section,
  state,
  onEdit,
  onSave,
  onRegenerate,
  onToggleDiscard,
  onSetEditing,
}: SectionCardProps) {
  const conf = section.confidence
  const bucket = conf == null ? null : bucketForConfidence(conf)
  const signals = section.confidence_signals
  const tooltip = signals
    ? `input_chars=${signals.input_chars}\nllm_self_rating=${signals.llm_self_rating}\nhas_metadata_anchors=${signals.has_metadata_anchors}`
    : 'no signals captured'

  return (
    <Card data-testid={`setup-card-${section.canonical}`} className={state.discard ? 'opacity-60' : ''}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{titleFor(section.id)}</CardTitle>
            <CardDescription className="font-mono text-xs">{section.canonical}</CardDescription>
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
      <CardContent className="space-y-3">
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            data-testid={`setup-mode-pretty-${section.canonical}`}
            className={`px-2 py-1 rounded ${state.editing ? 'text-muted-foreground hover:text-foreground' : 'bg-foreground/10 font-medium'}`}
            onClick={() => onSetEditing(section.canonical, false)}
          >
            Reading view
          </button>
          <button
            type="button"
            data-testid={`setup-mode-edit-${section.canonical}`}
            className={`px-2 py-1 rounded ${state.editing ? 'bg-foreground/10 font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => onSetEditing(section.canonical, true)}
          >
            Edit raw
          </button>
        </div>
        {state.editing ? (
          <textarea
            data-testid={`setup-textarea-${section.canonical}`}
            className="w-full min-h-[240px] rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            value={state.content}
            spellCheck={false}
            onChange={(e) => onEdit(section.canonical, e.target.value)}
          />
        ) : (
          <div
            data-testid={`setup-pretty-${section.canonical}`}
            className="rounded-md border border-border bg-background/40 p-4 max-h-[420px] overflow-y-auto"
          >
            <PrettySectionContent canonical={section.canonical} content={state.content} />
          </div>
        )}
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
          <Button
            data-testid={`setup-regen-${section.canonical}`}
            size="sm"
            variant="outline"
            disabled={state.busy || state.discard}
            onClick={() => onRegenerate(section.id)}
          >
            Regenerate
          </Button>
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
          <p data-testid={`setup-error-${section.canonical}`} className="text-xs text-destructive">
            {state.error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

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
          // Preserve prior dirty/saved flags when content is unchanged so a
          // background reload doesn't silently wipe a save indicator.
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

  // Commit gate: every non-discarded card must be free of unsaved edits.
  // A user who opens /setup/review and is happy with the auto-captured
  // content can commit immediately — they shouldn't be forced to click
  // Save on every card just to satisfy the gate. Edits that ARE in
  // progress still need to be saved (or discarded) before committing.
  const requiredSavedSet = useMemo(() => {
    return orderedSections
      .filter((s) => !states[s.canonical]?.discard)
      .every((s) => states[s.canonical] && !states[s.canonical].dirty)
  }, [orderedSections, states])

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
        [canonical]: { ...prev[canonical], busy: false, saved: true, dirty: false, error: null },
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
    // Discarded sections — the API takes section ids, not canonical paths.
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
      // Redirect home so the user lands on the framework dashboard once
      // commit completes. We use a soft pushState to keep history clean.
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
                Run <code className="font-mono">yalc-gtm start --non-interactive --website &lt;url&gt;</code>{' '}
                to capture a fresh preview, then refresh this page.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

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
            disabled={!data || !requiredSavedSet || committing}
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

        <div className="space-y-4">
          {orderedSections.map((s) => (
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
                }
              }
              onEdit={handleEdit}
              onSave={handleSave}
              onRegenerate={handleRegenerate}
              onToggleDiscard={handleToggleDiscard}
              onSetEditing={handleSetEditing}
            />
          ))}
        </div>

        {!requiredSavedSet && data && orderedSections.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Save your in-progress edits (or mark sections as discard) to enable Save &amp; Commit.
          </p>
        )}
      </div>
    </main>
  )
}
