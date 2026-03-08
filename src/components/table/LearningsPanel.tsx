'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface LearningPattern {
  insight: string
  confidence: 'hypothesis' | 'validated' | 'proven'
  segment?: string
  evidence_count: number
  confirmed: boolean
  edited?: string
}

interface LearningsPanelProps {
  patterns: LearningPattern[]
  stats: { total: number; approved: number; rejected: number; flagged: number; pending: number }
  onSave: (confirmed: LearningPattern[]) => void
  onDismiss: () => void
  onUpdatePatterns: (patterns: LearningPattern[]) => void
}

const CONFIDENCE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  hypothesis: { bg: 'var(--accent-light)', color: 'var(--accent-dark)', label: 'Hypothesis' },
  validated: { bg: 'var(--success-light)', color: 'var(--success)', label: 'Validated' },
  proven: { bg: 'var(--success-light)', color: 'var(--success)', label: 'Proven' },
}

export function LearningsPanel({ patterns, stats, onSave, onDismiss, onUpdatePatterns }: LearningsPanelProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editText, setEditText] = useState('')

  const confirmed = patterns.filter(p => p.confirmed)
  const totalReviewed = stats.approved + stats.rejected + stats.flagged

  const handleConfirmToggle = (index: number) => {
    const updated = [...patterns]
    updated[index] = { ...updated[index], confirmed: !updated[index].confirmed }
    onUpdatePatterns(updated)
  }

  const startEdit = (index: number) => {
    setEditingIndex(index)
    setEditText(patterns[index].edited || patterns[index].insight)
  }

  const saveEdit = (index: number) => {
    const updated = [...patterns]
    updated[index] = { ...updated[index], edited: editText, confirmed: true }
    onUpdatePatterns(updated)
    setEditingIndex(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-xl max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col modal-enter">
        {/* Header */}
        <div className="px-8 pt-8 pb-5 border-b border-border-subtle">
          <h2 className="text-lg font-bold text-text-primary">
            I reviewed {totalReviewed} leads. Here&apos;s what I learned:
          </h2>

          {/* Stats bar */}
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--success)' }} />
              <span className="text-xs text-text-secondary tabular-nums">{stats.approved} approved</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--error)' }} />
              <span className="text-xs text-text-secondary tabular-nums">{stats.rejected} rejected</span>
            </div>
            {stats.flagged > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--warning)' }} />
                <span className="text-xs text-text-secondary tabular-nums">{stats.flagged} flagged</span>
              </div>
            )}
          </div>
        </div>

        {/* Pattern cards */}
        <div className="flex-1 overflow-y-auto px-8 py-5 space-y-3">
          {patterns.map((pattern, index) => {
            const style = CONFIDENCE_STYLES[pattern.confidence]
            return (
              <div
                key={index}
                className={cn(
                  "rounded-xl border p-5 transition-all duration-200 fade-in-up",
                  pattern.confirmed ? "border-border bg-white" : "border-border-subtle bg-surface opacity-60"
                )}
                style={{ animationDelay: `${index * 100}ms` }}
              >
                {/* Insight */}
                {editingIndex === index ? (
                  <div className="space-y-2">
                    <textarea
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      className="w-full text-sm leading-relaxed text-text-primary border border-border rounded-lg p-3 input-focus resize-none"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(index)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-text-primary text-background"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingIndex(null)}
                        className="px-3 py-1.5 text-xs text-text-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-text-primary">
                    {pattern.edited || pattern.insight}
                  </p>
                )}

                {/* Meta */}
                <div className="flex items-center gap-2 mt-3">
                  <span
                    className="font-bold rounded-md text-[10px] px-2 py-[2px] tracking-wide"
                    style={{ backgroundColor: style.bg, color: style.color }}
                  >
                    {style.label}
                  </span>
                  <span className="text-xs text-text-muted">
                    based on {pattern.evidence_count} leads
                  </span>
                  {pattern.segment && (
                    <span className="font-bold rounded-md text-[10px] px-2 py-[2px] bg-surface-2 text-text-muted">
                      {pattern.segment}
                    </span>
                  )}
                </div>

                {/* Actions */}
                {editingIndex !== index && (
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => handleConfirmToggle(index)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                        pattern.confirmed
                          ? "bg-success-light text-success"
                          : "bg-surface text-text-muted hover:bg-success-light hover:text-success"
                      )}
                    >
                      {pattern.confirmed ? '✓ Confirmed' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => handleConfirmToggle(index)}
                      className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-error transition-colors"
                    >
                      Not quite
                    </button>
                    <button
                      onClick={() => startEdit(index)}
                      className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-accent transition-colors"
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-border-subtle flex items-center justify-between">
          <button
            onClick={onDismiss}
            className="text-sm text-text-muted hover:text-text-secondary transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={() => onSave(confirmed)}
            disabled={confirmed.length === 0}
            className={cn(
              "px-6 py-3 rounded-xl text-sm font-bold transition-all duration-150",
              confirmed.length > 0
                ? "bg-text-primary text-background hover:bg-text-secondary"
                : "bg-surface-2 text-text-muted cursor-not-allowed"
            )}
          >
            Save {confirmed.length} Learning{confirmed.length !== 1 ? 's' : ''} & Close
          </button>
        </div>
      </div>
    </div>
  )
}
