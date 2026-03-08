'use client'

import { useEffect } from 'react'
import { useAtom } from 'jotai'
import { reviewsAtom, reviewsLoadingAtom, reviewFilterAtom } from '@/atoms/reviews'
import { ReviewCard } from './ReviewCard'
import type { ReviewStatus } from '@/lib/review/types'
import { cn } from '@/lib/utils'

const STATUS_TABS: { label: string; value: ReviewStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
]

export function ReviewsView() {
  const [reviews, setReviews] = useAtom(reviewsAtom)
  const [loading, setLoading] = useAtom(reviewsLoadingAtom)
  const [filter, setFilter] = useAtom(reviewFilterAtom)

  useEffect(() => {
    async function fetchReviews() {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (filter.status !== 'all') params.set('status', filter.status)
        if (filter.priority !== 'all') params.set('priority', filter.priority)

        const res = await fetch(`/api/reviews?${params.toString()}`)
        const data = await res.json()
        setReviews(data)
      } finally {
        setLoading(false)
      }
    }
    fetchReviews()
  }, [filter, setReviews, setLoading])

  const pendingCount = reviews.filter(r => r.status === 'pending').length

  return (
    <div className="flex-1 overflow-y-auto p-8" style={{ backgroundColor: 'var(--background)' }}>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-bold font-display text-text-primary mb-1">Reviews</h1>
        <p className="text-sm text-text-secondary mb-8">
          Human-in-the-loop review queue for approvals, nudges, and escalations.
        </p>

        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-6">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilter(prev => ({ ...prev, status: tab.value }))}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-bold border transition-colors',
                filter.status === tab.value
                  ? 'border-text-primary bg-text-primary text-background'
                  : 'border-border text-text-secondary hover:bg-surface'
              )}
            >
              {tab.label}
              {tab.value === 'pending' && pendingCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full" style={{ backgroundColor: 'var(--warning)', color: 'white' }}>
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Review list */}
        {loading ? (
          <div className="text-text-muted text-sm animate-pulse">Loading reviews...</div>
        ) : reviews.length === 0 ? (
          <div className="rounded-3xl border border-border bg-white p-8 text-center">
            <div className="text-sm text-text-secondary max-w-md mx-auto">
              Nothing to review right now. Review items from campaigns, intelligence, and data quality checks will appear here.
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {reviews.map(review => (
              <ReviewCard
                key={review.id}
                review={review}
                onUpdate={(updated) => {
                  setReviews(prev =>
                    prev.map(r => (r.id === updated.id ? updated : r))
                  )
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
