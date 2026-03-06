import { atom } from 'jotai'
import type { ReviewRequest, ReviewStatus, ReviewPriority } from '@/lib/review/types'

export const reviewsAtom = atom<ReviewRequest[]>([])
export const reviewsLoadingAtom = atom(false)

export const reviewFilterAtom = atom<{
  status: ReviewStatus | 'all'
  priority: ReviewPriority | 'all'
}>({
  status: 'pending',
  priority: 'all',
})

export const pendingCountAtom = atom((get) => {
  const reviews = get(reviewsAtom)
  const pending = reviews.filter(r => r.status === 'pending')
  return {
    total: pending.length,
    urgent: pending.filter(r => r.priority === 'urgent').length,
    high: pending.filter(r => r.priority === 'high').length,
    normal: pending.filter(r => r.priority === 'normal').length,
    low: pending.filter(r => r.priority === 'low').length,
  }
})
