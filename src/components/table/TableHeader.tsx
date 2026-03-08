'use client'

import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { activeTableMetaAtom, feedbackStatsAtom } from '@/atoms/table'
import { cn } from '@/lib/utils'

interface TableHeaderProps {
  onDoneReviewing: () => void
  isLearning: boolean
}

export function TableHeader({ onDoneReviewing, isLearning }: TableHeaderProps) {
  const meta = useAtomValue(activeTableMetaAtom)
  const stats = useAtomValue(feedbackStatsAtom)
  const [qualityIssues, setQualityIssues] = useState<{ critical: number; warning: number }>({ critical: 0, warning: 0 })

  useEffect(() => {
    if (!meta?.id) return
    fetch('/api/data-quality/issues')
      .then(r => r.json())
      .then(data => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const relevant = (data.issues ?? []).filter((i: any) => i.resultSetId === meta.id)
        setQualityIssues({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          critical: relevant.filter((i: any) => i.severity === 'critical').length,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          warning: relevant.filter((i: any) => i.severity === 'warning').length,
        })
      })
      .catch(() => {})
  }, [meta?.id])

  if (!meta) return null

  const reviewed = stats.approved + stats.rejected + stats.flagged
  const canFinish = stats.approved >= 5 && stats.rejected >= 5

  // Progress segments
  const total = stats.total || 1
  const approvedPct = (stats.approved / total) * 100
  const rejectedPct = (stats.rejected / total) * 100
  const flaggedPct = (stats.flagged / total) * 100

  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-border bg-white">
      {/* Back link */}
      <a href="/chat" className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Chat
      </a>

      <div className="w-px h-5 bg-border-subtle" />

      {/* Table name */}
      <h1 className="text-sm font-bold text-text-primary truncate max-w-[300px]">
        {meta.name}
      </h1>

      {/* Row count badge */}
      <span className="font-bold rounded-lg bg-surface-2 text-text-muted text-[11px] px-2.5 py-[3px] tabular-nums">
        {meta.rowCount} rows
      </span>

      {/* Quality badge */}
      {qualityIssues.critical > 0 && (
        <a href="/reviews" className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-error/15 text-error">
          {qualityIssues.critical} critical
        </a>
      )}
      {qualityIssues.critical === 0 && qualityIssues.warning > 0 && (
        <a href="/reviews" className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-warning/15 text-warning">
          {qualityIssues.warning} warning{qualityIssues.warning !== 1 ? 's' : ''}
        </a>
      )}

      {/* Feedback progress bar */}
      <div className="flex-1 max-w-[200px]">
        <div className="h-2 rounded-full bg-surface-2 overflow-hidden flex">
          {approvedPct > 0 && (
            <div
              className="h-full transition-all duration-300"
              style={{ width: `${approvedPct}%`, backgroundColor: 'var(--success)' }}
            />
          )}
          {rejectedPct > 0 && (
            <div
              className="h-full transition-all duration-300"
              style={{ width: `${rejectedPct}%`, backgroundColor: 'var(--error)' }}
            />
          )}
          {flaggedPct > 0 && (
            <div
              className="h-full transition-all duration-300"
              style={{ width: `${flaggedPct}%`, backgroundColor: 'var(--warning)' }}
            />
          )}
        </div>
        <div className="text-[10px] text-text-muted mt-1 tabular-nums">
          {reviewed}/{stats.total} reviewed
        </div>
      </div>

      {/* Done Reviewing */}
      <button
        onClick={onDoneReviewing}
        disabled={!canFinish || isLearning}
        className={cn(
          "ml-auto px-4 py-2 rounded-xl text-xs font-bold transition-all duration-150",
          canFinish && !isLearning
            ? "bg-text-primary text-background hover:bg-text-secondary cursor-pointer"
            : "bg-surface-2 text-text-muted cursor-not-allowed"
        )}
      >
        {isLearning ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin" width="12" height="12" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" opacity="0.25"/>
              <path d="M12.5 7a5.5 5.5 0 00-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Analyzing...
          </span>
        ) : (
          'Done Reviewing'
        )}
      </button>
    </div>
  )
}
