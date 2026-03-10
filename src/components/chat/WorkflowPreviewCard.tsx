'use client'

import type { WorkflowDefinition, WorkflowStepType } from '@/lib/ai/types'
import { cn } from '@/lib/utils'

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function IconBolt() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7.5 1.5L3 8h4l-.5 4.5L11 6H7l.5-4.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconBrain() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 12V7.5M5 7.5C3.5 7.5 2 6.5 2 5s1.5-3 3-3c.4 0 .8.1 1.1.2A2.5 2.5 0 019 2c1.5 0 3 1.5 3 3s-1.5 2.5-3 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4.5 9.5L7 7.5l2.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconFunnel() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 3h10L8.5 7.5V11L5.5 12V7.5L2 3z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconExport() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 9V2M7 2L4 5M7 2l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 9v2.5h10V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" opacity="0.25"/>
      <path d="M12.5 7a5.5 5.5 0 00-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function IconPlay() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 1.5l7 4.5-7 4.5V1.5z" fill="currentColor"/>
    </svg>
  )
}

const STEP_ICONS: Record<WorkflowStepType, React.ReactNode> = {
  search: <IconSearch />,
  enrich: <IconBolt />,
  qualify: <IconBrain />,
  filter: <IconFunnel />,
  export: <IconExport />,
}

interface WorkflowPreviewCardProps {
  workflow: WorkflowDefinition
  onApprove: () => void
  onEdit?: () => void
  isRunning?: boolean
}

const STEP_TYPE_STYLES: Record<WorkflowStepType, { bg: string; color: string; label: string }> = {
  search:  { bg: 'var(--accent-light)',   color: 'var(--accent-dark)', label: 'SEARCH' },
  enrich:  { bg: 'var(--success-light)',      color: 'var(--success)',    label: 'ENRICH' },
  qualify: { bg: 'var(--accent-light)', color: 'var(--accent-dark)', label: 'QUALIFY' },
  filter:  { bg: 'var(--warning-light)',   color: 'var(--warning-dark)', label: 'FILTER' },
  export:  { bg: 'var(--warning-light)',       color: 'var(--warning-dark)',     label: 'EXPORT' },
}

const PROVIDER_COLORS: Record<string, string> = {
  // Registered providers (actual IDs in the registry)
  'mock':                       '#525A69',
  'apify-leads':                '#FF6B35',
  'apify-linkedin-engagement':  '#0077B5',
  // Legacy names (kept for graceful degradation)
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
  // Defensive: coerce all dynamic fields to strings — Claude's tool output isn't validated
  const apiKeys = Array.isArray(workflow.requiredApiKeys) ? workflow.requiredApiKeys : []
  const steps = Array.isArray(workflow.steps) ? workflow.steps : []

  return (
    <div className="rounded-3xl border overflow-hidden mt-3 animate-slide-up bg-white border-border max-w-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border-subtle">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold leading-tight text-text-primary tracking-[-0.01em]">
              {String(workflow.title ?? '')}
            </h3>
            <p className="text-sm mt-1.5 leading-relaxed text-text-secondary">
              {String(workflow.description ?? '')}
            </p>
          </div>
          <div className="flex-shrink-0 font-bold rounded-lg bg-surface-2 text-text-muted whitespace-nowrap text-[11px] px-3 py-[5px]">
            {String(workflow.estimatedTime ?? '')}
          </div>
        </div>

        {apiKeys.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            <span className="text-text-muted text-[11px]">
              Requires:
            </span>
            {apiKeys.map((key, i) => (
              <span
                key={typeof key === 'string' ? key : i}
                className="font-bold rounded-lg bg-accent-light text-[var(--accent-dark)] text-[11px] px-2.5 py-[3px] tracking-wide"
              >
                {String(key)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Steps */}
      <div>
        {steps.map((step, index) => {
          const typeStyle = STEP_TYPE_STYLES[step.stepType] ?? STEP_TYPE_STYLES.search
          const providerStr = String(step.provider ?? 'mock')
          const providerColor = PROVIDER_COLORS[providerStr] ?? 'var(--text-muted)'

          return (
            <div
              key={index}
              className={cn(
                "flex items-start gap-3.5 px-6 py-4",
                index < steps.length - 1 && "border-b border-border-subtle"
              )}
            >
              <div
                className="flex-shrink-0 flex items-center justify-center rounded-lg font-bold w-7 h-7 text-xs mt-px"
                style={{ backgroundColor: typeStyle.bg, color: typeStyle.color }}
              >
                {(step.stepIndex ?? index) + 1}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm flex items-center" style={{ color: typeStyle.color }}>
                    {STEP_ICONS[step.stepType]}
                  </span>
                  <span className="text-sm font-bold text-text-primary">
                    {String(step.title ?? '')}
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
                    {providerStr}
                  </span>
                  {step.estimatedRows && (
                    <span className="text-xs text-text-muted">
                      ~{step.estimatedRows} rows
                    </span>
                  )}
                </div>
                <p className="text-sm mt-1.5 leading-relaxed text-text-secondary">
                  {String(step.description ?? '')}
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
              <Spinner />
              Running...
            </>
          ) : (
            <>
              <IconPlay />
              Run this workflow
            </>
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
