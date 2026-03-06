'use client'

import type { WorkflowDefinition, WorkflowStepType } from '@/lib/ai/types'
import { STEP_TYPE_ICONS } from '@/lib/ai/types'
import { cn } from '@/lib/utils'

interface WorkflowPreviewCardProps {
  workflow: WorkflowDefinition
  onApprove: () => void
  onEdit?: () => void
  isRunning?: boolean
}

const STEP_TYPE_STYLES: Record<WorkflowStepType, { bg: string; color: string; label: string }> = {
  search:  { bg: 'var(--blueberry-50)',   color: 'var(--blueberry-800)', label: 'SEARCH' },
  enrich:  { bg: 'var(--matcha-50)',      color: 'var(--matcha-600)',    label: 'ENRICH' },
  qualify: { bg: 'var(--dragonfruit-50)', color: 'var(--dragonfruit-600)', label: 'QUALIFY' },
  filter:  { bg: 'var(--tangerine-50)',   color: 'var(--tangerine-700)', label: 'FILTER' },
  export:  { bg: 'var(--lemon-50)',       color: 'var(--lemon-600)',     label: 'EXPORT' },
}

const PROVIDER_COLORS: Record<string, string> = {
  apollo:     '#C34E1B',
  firecrawl:  '#02693E',
  anthropic:  '#3859F9',
  builtwith:  '#6B4F00',
  hunter:     '#8B045C',
  clearbit:   '#0053B5',
  clay:       '#525A69',
  internal:   '#525A69',
  manual:     '#7B7974',
}

export function WorkflowPreviewCard({
  workflow,
  onApprove,
  onEdit,
  isRunning = false,
}: WorkflowPreviewCardProps) {
  return (
    <div className="rounded-2xl border overflow-hidden mt-3 animate-slide-up bg-white border-border max-w-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border-subtle">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold leading-tight text-text-primary tracking-[-0.01em]">
              {workflow.title}
            </h3>
            <p className="text-sm mt-1.5 leading-relaxed text-text-secondary">
              {workflow.description}
            </p>
          </div>
          <div className="flex-shrink-0 font-bold rounded-lg bg-surface-2 text-text-muted whitespace-nowrap text-[11px] px-3 py-[5px]">
            {workflow.estimatedTime}
          </div>
        </div>

        {workflow.requiredApiKeys.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            <span className="text-text-muted text-[11px]">
              Requires:
            </span>
            {workflow.requiredApiKeys.map((key) => (
              <span
                key={key}
                className="font-bold rounded-lg bg-blueberry-50 text-[var(--blueberry-800)] text-[11px] px-2.5 py-[3px] tracking-wide"
              >
                {key}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Steps */}
      <div>
        {workflow.steps.map((step, index) => {
          const typeStyle = STEP_TYPE_STYLES[step.stepType]
          const providerColor = PROVIDER_COLORS[step.provider] ?? 'var(--text-muted)'

          return (
            <div
              key={index}
              className={cn(
                "flex items-start gap-3.5 px-6 py-4",
                index < workflow.steps.length - 1 && "border-b border-border-subtle"
              )}
            >
              <div
                className="flex-shrink-0 flex items-center justify-center rounded-lg font-bold w-7 h-7 text-xs mt-px"
                style={{ backgroundColor: typeStyle.bg, color: typeStyle.color }}
              >
                {step.stepIndex + 1}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm">
                    {STEP_TYPE_ICONS[step.stepType]}
                  </span>
                  <span className="text-sm font-bold text-text-primary">
                    {step.title}
                  </span>
                  <span
                    className="font-bold rounded text-[10px] px-[7px] py-[2px] tracking-[0.06em]"
                    style={{ backgroundColor: typeStyle.bg, color: typeStyle.color }}
                  >
                    {typeStyle.label}
                  </span>
                  <span
                    className="font-bold rounded text-[10px] px-[7px] py-[2px] tracking-[0.05em] uppercase"
                    style={{ backgroundColor: `${providerColor}14`, color: providerColor }}
                  >
                    {step.provider}
                  </span>
                  {step.estimatedRows && (
                    <span className="text-xs text-text-muted">
                      ~{step.estimatedRows} rows
                    </span>
                  )}
                </div>
                <p className="text-sm mt-1.5 leading-relaxed text-text-secondary">
                  {step.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Action bar */}
      <div className="px-6 py-4 flex items-center gap-3 border-t border-border bg-surface">
        <button
          onClick={onApprove}
          disabled={isRunning}
          className={cn(
            "flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all duration-150",
            isRunning
              ? "bg-text-muted text-background cursor-not-allowed opacity-50"
              : "bg-text-primary text-background cursor-pointer hover:bg-text-secondary"
          )}
        >
          {isRunning ? (
            <>
              <span className="animate-spin">◌</span>
              Running...
            </>
          ) : (
            <>▶ Run this workflow</>
          )}
        </button>

        {onEdit && !isRunning && (
          <button
            onClick={onEdit}
            className="px-4 py-3 rounded-xl text-sm transition-colors duration-150 bg-transparent text-text-secondary border border-border"
          >
            Edit steps
          </button>
        )}

        {workflow.estimatedResultCount && (
          <span className="ml-auto text-xs text-text-muted">
            ~{workflow.estimatedResultCount} results expected
          </span>
        )}
      </div>
    </div>
  )
}
