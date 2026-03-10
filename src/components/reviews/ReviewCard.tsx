'use client'

import { useState } from 'react'
import type { ReviewRequest } from '@/lib/review/types'
import { cn } from '@/lib/utils'

const PRIORITY_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  urgent: { border: 'var(--error)', bg: 'var(--error-light)', text: 'var(--error)' },
  high: { border: 'var(--warning)', bg: 'var(--warning-light)', text: 'var(--warning-dark)' },
  normal: { border: 'var(--accent)', bg: 'var(--accent-light)', text: 'var(--accent)' },
  low: { border: 'var(--border)', bg: 'var(--surface-2)', text: 'var(--text-muted)' },
}

interface ReviewCardProps {
  review: ReviewRequest
  onUpdate: (updated: ReviewRequest) => void
}

export function ReviewCard({ review, onUpdate }: ReviewCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState('')
  const [acting, setActing] = useState(false)

  const isPending = review.status === 'pending'
  const colors = PRIORITY_COLORS[review.priority] ?? PRIORITY_COLORS.low

  async function handleAction(status: 'approved' | 'rejected' | 'dismissed') {
    setActing(true)
    try {
      const res = await fetch(`/api/reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes: notes || undefined }),
      })
      const updated = await res.json()
      onUpdate({ ...review, ...updated })
    } finally {
      setActing(false)
    }
  }

  return (
    <div
      className="rounded-3xl border border-border bg-white overflow-hidden"
      style={{ borderLeftWidth: '4px', borderLeftColor: colors.border }}
    >
      <div className="px-6 py-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-sm text-text-primary truncate">{String(review.title ?? '')}</h3>
              <span
                className="font-bold rounded-md text-[9px] px-2 py-0.5 tracking-wide"
                style={{ backgroundColor: colors.bg, color: colors.text }}
              >
                {review.priority.toUpperCase()}
              </span>
              <span className="font-bold rounded-md text-[9px] px-2 py-0.5 tracking-wide" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                {review.type.replace('_', ' ')}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-text-muted">{review.sourceSystem}</span>
              <span className="text-xs text-text-muted">{new Date(review.createdAt).toLocaleString()}</span>
            </div>
          </div>

          {!isPending && (
            <span
              className="font-bold rounded-lg text-[11px] px-2.5 py-[3px]"
              style={{
                backgroundColor: review.status === 'approved' ? 'var(--success-light)' : review.status === 'rejected' ? 'var(--error-light)' : 'var(--surface-2)',
                color: review.status === 'approved' ? 'var(--success)' : review.status === 'rejected' ? 'var(--error)' : 'var(--text-muted)',
              }}
            >
              {review.status.charAt(0).toUpperCase() + review.status.slice(1)}
            </span>
          )}
        </div>

        {/* Description */}
        <div className="mt-3">
          <p className={cn('text-sm text-text-secondary', !expanded && 'line-clamp-2')}>
            {review.description}
          </p>
          {review.description.length > 200 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs mt-1 hover:underline"
              style={{ color: 'var(--accent)' }}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>

        {/* Nudge evidence */}
        {review.type === 'nudge' && review.nudgeEvidence && (
          <div className="mt-3 p-3 rounded-xl text-sm space-y-2" style={{ backgroundColor: 'var(--surface-2)' }}>
            <p className="text-xs font-bold text-text-muted uppercase tracking-wide">Nudge Evidence</p>
            <div className="space-y-1">
              {review.nudgeEvidence.metrics.map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-text-primary">{String(m.name ?? '')}:</span>
                  <span className="text-text-secondary">{String(m.current ?? '')}</span>
                  <span className="text-text-muted">→</span>
                  <span style={{ color: Number(m.projected) > Number(m.current) ? 'var(--success)' : 'var(--error)' }}>
                    {String(m.projected ?? '')}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-text-muted">{String(review.nudgeEvidence.reasoning ?? '')}</p>
          </div>
        )}

        {/* Actions */}
        {isPending && (
          <div className="mt-4 space-y-2">
            {expanded && (
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add review notes (optional)..."
                className="w-full px-4 py-2.5 rounded-xl text-sm border border-border bg-surface-3 input-focus"
              />
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleAction('approved')}
                disabled={acting}
                className="px-4 py-2 rounded-xl text-xs font-bold transition-colors text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--success)' }}
              >
                {acting ? '...' : 'Approve'}
              </button>
              <button
                onClick={() => handleAction('rejected')}
                disabled={acting}
                className="px-4 py-2 rounded-xl text-xs font-bold transition-colors text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--error)' }}
              >
                Reject
              </button>
              <button
                onClick={() => handleAction('dismissed')}
                disabled={acting}
                className="px-4 py-2 rounded-xl text-xs font-bold text-text-muted hover:text-text-secondary transition-colors disabled:opacity-50"
              >
                Dismiss
              </button>
              {!expanded && (
                <button
                  onClick={() => setExpanded(true)}
                  className="ml-auto text-xs hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  Add notes
                </button>
              )}
            </div>
          </div>
        )}

        {/* Review notes on resolved items */}
        {review.reviewNotes && !isPending && (
          <p className="mt-3 text-xs text-text-muted italic">
            Note: {review.reviewNotes}
          </p>
        )}
      </div>
    </div>
  )
}
