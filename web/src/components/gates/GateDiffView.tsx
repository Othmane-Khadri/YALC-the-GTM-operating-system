/**
 * GateDiffView — side-by-side JSON diff for "approved with edits" gates (D3).
 *
 * Renders a property-level diff between two payloads (the original
 * pre-edit value from the awaiting-gate sentinel, and the final post-
 * approval payload). We intentionally don't pull in `jsondiffpatch` —
 * the bundle budget can't afford it, and the surface here is a small
 * fixed shape (top-level + one nested level for changed values).
 *
 * Color semantics re-use the brand `confidence` tokens:
 *
 *   added     → confidence.high   (green)
 *   removed   → confidence.low    (red, with strikethrough)
 *   changed   → confidence.medium (yellow, both values shown)
 *   unchanged → muted (kept in the structure for readability, dimmed)
 *
 * Pure helpers are exported separately so logic can be tested without
 * mounting a DOM (matches the rest of the SPA's test patterns).
 */

import type { ReactElement } from 'react'

export type DiffEntryKind = 'added' | 'removed' | 'changed' | 'unchanged'

export interface DiffEntry {
  /** Top-level key, or "(value)" for non-object payloads. */
  key: string
  kind: DiffEntryKind
  originalValue?: unknown
  finalValue?: unknown
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  const aIsArr = Array.isArray(a)
  const bIsArr = Array.isArray(b)
  if (aIsArr !== bIsArr) return false
  if (aIsArr && bIsArr) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, k)) return false
    if (!deepEqual(aObj[k], bObj[k])) return false
  }
  return true
}

/**
 * Compute a property-level diff between two JSON-shaped values.
 *
 * For object inputs, walks the top-level union of keys and classifies
 * each. For non-object inputs, surfaces a single synthetic entry keyed
 * "(value)" so the renderer still has something to display.
 */
export function computeJsonDiff(original: unknown, final: unknown): DiffEntry[] {
  if (!isPlainObject(original) || !isPlainObject(final)) {
    if (deepEqual(original, final)) {
      return [{ key: '(value)', kind: 'unchanged', originalValue: original, finalValue: final }]
    }
    return [{ key: '(value)', kind: 'changed', originalValue: original, finalValue: final }]
  }
  const keys = new Set<string>([...Object.keys(original), ...Object.keys(final)])
  const out: DiffEntry[] = []
  for (const key of keys) {
    const inOrig = Object.prototype.hasOwnProperty.call(original, key)
    const inFinal = Object.prototype.hasOwnProperty.call(final, key)
    if (inOrig && !inFinal) {
      out.push({ key, kind: 'removed', originalValue: original[key] })
    } else if (!inOrig && inFinal) {
      out.push({ key, kind: 'added', finalValue: final[key] })
    } else if (deepEqual(original[key], final[key])) {
      out.push({
        key,
        kind: 'unchanged',
        originalValue: original[key],
        finalValue: final[key],
      })
    } else {
      out.push({
        key,
        kind: 'changed',
        originalValue: original[key],
        finalValue: final[key],
      })
    }
  }
  return out
}

/**
 * True when an operator's pending edit-draft would result in `edits_applied`
 * on approve — used by /today to decide whether to surface the "View edits"
 * link next to a gate whose payload the user has been editing locally.
 *
 * The draft is the JSON string the user has typed; the original is the
 * payload from the awaiting-gate sentinel. We tolerate unparseable drafts
 * (return false — there's nothing meaningful to diff against yet) and
 * empty drafts (treated as "no edits").
 */
export function shouldShowViewEditsLink(originalPayload: unknown, draft: string): boolean {
  if (typeof draft !== 'string' || draft.trim().length === 0) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(draft)
  } catch {
    return false
  }
  return !deepEqual(originalPayload, parsed)
}

function fmt(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

interface GateDiffViewProps {
  original: unknown
  final: unknown
}

/**
 * Side-by-side diff renderer.
 *
 * Two columns ("Original" / "Final") with one row per top-level key.
 * The row carries the brand-token color for its diff kind. Empty diffs
 * render an "identical" empty state so the modal isn't blank when the
 * operator approved without edits.
 */
export function GateDiffView({ original, final }: GateDiffViewProps): ReactElement {
  const entries = computeJsonDiff(original, final)
  const hasChanges = entries.some((e) => e.kind !== 'unchanged')

  return (
    <div className="space-y-3" data-testid="gate-diff-view">
      <div className="grid grid-cols-2 gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <div>Original</div>
        <div>Final</div>
      </div>
      {!hasChanges && (
        <p className="text-sm text-muted-foreground italic" data-testid="gate-diff-identical">
          Payloads are identical — no edits were applied at approval.
        </p>
      )}
      <div className="space-y-1">
        {entries.map((entry, i) => (
          <DiffRow key={`${entry.key}-${i}`} entry={entry} />
        ))}
      </div>
    </div>
  )
}

function rowClasses(kind: DiffEntryKind): {
  container: string
  badge: string
} {
  switch (kind) {
    case 'added':
      return {
        container: 'border-l-2 border-confidence-high bg-confidence-high/10',
        badge: 'bg-confidence-high text-white',
      }
    case 'removed':
      return {
        container: 'border-l-2 border-confidence-low bg-confidence-low/10',
        badge: 'bg-confidence-low text-white',
      }
    case 'changed':
      return {
        container: 'border-l-2 border-confidence-medium bg-confidence-medium/10',
        badge: 'bg-confidence-medium text-white',
      }
    case 'unchanged':
      return {
        container: 'border-l-2 border-border',
        badge: 'bg-muted text-muted-foreground',
      }
  }
}

function DiffRow({ entry }: { entry: DiffEntry }): ReactElement {
  const cls = rowClasses(entry.kind)
  const removed = entry.kind === 'removed'
  return (
    <div
      data-testid={`gate-diff-row-${entry.key}`}
      data-kind={entry.kind}
      className={`grid grid-cols-2 gap-2 rounded-sm px-2 py-1 text-xs font-mono ${cls.container}`}
    >
      <div>
        <div className="flex items-center gap-2">
          <span className={`inline-block px-1 rounded text-[10px] uppercase ${cls.badge}`}>
            {entry.kind === 'unchanged' ? '=' : entry.kind === 'added' ? '+' : entry.kind === 'removed' ? '−' : '~'}
          </span>
          <span className="text-muted-foreground">"{entry.key}"</span>
        </div>
        {entry.kind !== 'added' && (
          <pre className={`whitespace-pre-wrap break-words mt-1 ${removed ? 'line-through opacity-70' : ''}`}>
            {fmt(entry.originalValue)}
          </pre>
        )}
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className={`inline-block px-1 rounded text-[10px] uppercase ${cls.badge}`}>
            {entry.kind === 'unchanged' ? '=' : entry.kind === 'added' ? '+' : entry.kind === 'removed' ? '−' : '~'}
          </span>
          <span className="text-muted-foreground">"{entry.key}"</span>
        </div>
        {entry.kind !== 'removed' && (
          <pre className="whitespace-pre-wrap break-words mt-1">{fmt(entry.finalValue)}</pre>
        )}
      </div>
    </div>
  )
}
