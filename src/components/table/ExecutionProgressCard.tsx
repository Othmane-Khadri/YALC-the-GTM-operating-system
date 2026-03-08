'use client'

import { useAtomValue } from 'jotai'
import { executionStateAtom } from '@/atoms/conversation'
import { cn } from '@/lib/utils'

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-success">
          <circle cx="7" cy="7" r="6" fill="var(--success-light)" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M4.5 7L6 8.5L9.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )
    case 'running':
      return (
        <div className="w-3.5 h-3.5 rounded-full bg-accent-light border-2 border-accent animate-pulse" />
      )
    case 'failed':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-error">
          <circle cx="7" cy="7" r="6" fill="var(--error-light)" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M5 5L9 9M9 5L5 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      )
    default:
      return (
        <div className="w-3.5 h-3.5 rounded-full bg-surface-2 border border-border" />
      )
  }
}

export function ExecutionProgressCard() {
  const execution = useAtomValue(executionStateAtom)

  if (execution.status === 'idle') return null

  const currentStep = execution.steps.find(s => s.status === 'running')

  return (
    <div className="rounded-3xl border overflow-hidden mt-3 animate-slide-up bg-white border-border max-w-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <svg className="animate-spin text-accent" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" opacity="0.25"/>
            <path d="M12.5 7a5.5 5.5 0 00-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <h3 className="text-sm font-bold text-text-primary">Running workflow...</h3>
        </div>
        {currentStep && (
          <p className="text-xs text-text-muted mt-1.5">
            Generating row {execution.totalRows} — {currentStep.title}
          </p>
        )}
      </div>

      {/* Steps */}
      <div className="px-6 py-3">
        {execution.steps.map((step) => (
          <div
            key={step.index}
            className={cn(
              "flex items-center gap-3 py-2",
              step.status === 'pending' && "opacity-40"
            )}
          >
            <StepIcon status={step.status} />
            <span className={cn(
              "text-sm",
              step.status === 'running' ? "text-text-primary font-bold" : "text-text-secondary"
            )}>
              {step.title}
            </span>
            {step.rowsOut != null && step.status === 'completed' && (
              <span className="text-xs text-text-muted tabular-nums ml-auto">
                {step.rowsOut} rows
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Progress bar */}
      {execution.totalRows > 0 && (
        <div className="px-6 pb-4">
          <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${Math.min(100, (execution.steps.filter(s => s.status === 'completed').length / execution.steps.length) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
