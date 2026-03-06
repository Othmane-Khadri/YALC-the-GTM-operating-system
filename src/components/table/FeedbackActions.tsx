'use client'

import { cn } from '@/lib/utils'

interface FeedbackActionsProps {
  feedback: 'approved' | 'rejected' | 'flagged' | null
  onFeedback: (value: 'approved' | 'rejected' | 'flagged' | null) => void
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 7.5L5.5 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconX() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M4 4L10 10M10 4L4 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

function IconFlag() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 2v10M3 2h7l-2 3 2 3H3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function FeedbackActions({ feedback, onFeedback }: FeedbackActionsProps) {
  const handleClick = (value: 'approved' | 'rejected' | 'flagged') => {
    onFeedback(feedback === value ? null : value)
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => handleClick('approved')}
        className={cn(
          "flex items-center justify-center w-6 h-6 rounded-md transition-all duration-150",
          feedback === 'approved'
            ? "bg-matcha-50 text-matcha-600"
            : "text-text-muted hover:text-matcha-600 hover:bg-matcha-50"
        )}
        title="Approve"
      >
        <IconCheck />
      </button>
      <button
        onClick={() => handleClick('rejected')}
        className={cn(
          "flex items-center justify-center w-6 h-6 rounded-md transition-all duration-150",
          feedback === 'rejected'
            ? "bg-red-50 text-pomegranate-600"
            : "text-text-muted hover:text-pomegranate-600 hover:bg-red-50"
        )}
        title="Reject"
      >
        <IconX />
      </button>
      <button
        onClick={() => handleClick('flagged')}
        className={cn(
          "flex items-center justify-center w-6 h-6 rounded-md transition-all duration-150",
          feedback === 'flagged'
            ? "bg-tangerine-50 text-tangerine-600"
            : "text-text-muted hover:text-tangerine-600 hover:bg-tangerine-50"
        )}
        title="Flag for review"
      >
        <IconFlag />
      </button>
    </div>
  )
}
