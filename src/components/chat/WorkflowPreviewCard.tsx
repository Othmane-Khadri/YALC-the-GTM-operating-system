'use client'

import type { WorkflowDefinition } from '@/lib/ai/types'
import { STEP_TYPE_ICONS } from '@/lib/ai/types'

interface WorkflowPreviewCardProps {
  workflow: WorkflowDefinition
  onApprove: () => void
  onEdit?: () => void
  isRunning?: boolean
}

const PROVIDER_COLORS: Record<string, string> = {
  apollo: '#f97316',
  firecrawl: '#22c578',
  anthropic: '#4b72f5',
  builtwith: '#ca8a04',
  hunter: '#be185d',
  clay: '#8b91a8',
  internal: '#4e5470',
  manual: '#4e5470',
}

export function WorkflowPreviewCard({
  workflow,
  onApprove,
  onEdit,
  isRunning = false,
}: WorkflowPreviewCardProps) {
  return (
    <div
      className="rounded-lg border overflow-hidden mt-2 animate-slide-up"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        maxWidth: '580px',
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3
              className="text-sm font-bold leading-tight"
              style={{ color: 'var(--text-primary)', fontFamily: 'Space Mono, monospace' }}
            >
              {workflow.title}
            </h3>
            <p
              className="text-xs mt-0.5 leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              {workflow.description}
            </p>
          </div>
          <div
            className="flex-shrink-0 text-xs px-2 py-1 rounded"
            style={{
              backgroundColor: 'var(--surface-2)',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            {workflow.estimatedTime}
          </div>
        </div>

        {/* Required API keys */}
        {workflow.requiredApiKeys.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {workflow.requiredApiKeys.map((key) => (
              <span
                key={key}
                className="text-xs px-2 py-0.5 rounded"
                style={{
                  backgroundColor: 'var(--blueberry-50)',
                  color: 'var(--blueberry-300)',
                  fontSize: '10px',
                  letterSpacing: '0.04em',
                }}
              >
                {key}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
        {workflow.steps.map((step, index) => (
          <div key={index} className="flex items-start gap-3 px-4 py-2.5">
            {/* Step number + type icon */}
            <div className="flex-shrink-0 flex items-center gap-1.5 pt-0.5">
              <span
                className="text-xs w-5 h-5 rounded flex items-center justify-center font-bold"
                style={{
                  backgroundColor: 'var(--surface-2)',
                  color: 'var(--text-muted)',
                  fontSize: '10px',
                }}
              >
                {step.stepIndex + 1}
              </span>
              <span className="text-sm" title={step.stepType}>
                {STEP_TYPE_ICONS[step.stepType]}
              </span>
            </div>

            {/* Step content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-bold truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {step.title}
                </span>
                {/* Provider badge */}
                <span
                  className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-bold"
                  style={{
                    backgroundColor: `${PROVIDER_COLORS[step.provider] ?? '#4e5470'}22`,
                    color: PROVIDER_COLORS[step.provider] ?? 'var(--text-muted)',
                    fontSize: '9px',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {step.provider}
                </span>
                {step.estimatedRows && (
                  <span
                    className="flex-shrink-0 text-xs"
                    style={{ color: 'var(--text-muted)', fontSize: '10px' }}
                  >
                    ~{step.estimatedRows} rows
                  </span>
                )}
              </div>
              <p
                className="text-xs mt-0.5 leading-relaxed"
                style={{ color: 'var(--text-secondary)' }}
              >
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Action bar */}
      <div
        className="px-4 py-3 flex items-center gap-2 border-t"
        style={{ borderColor: 'var(--border)' }}
      >
        <button
          onClick={onApprove}
          disabled={isRunning}
          className="flex items-center gap-2 px-4 py-2 rounded text-xs font-bold transition-colors disabled:opacity-50"
          style={{
            backgroundColor: isRunning ? 'var(--surface-2)' : 'var(--matcha-600)',
            color: 'white',
            fontFamily: 'Space Mono, monospace',
            cursor: isRunning ? 'not-allowed' : 'pointer',
          }}
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
            className="px-4 py-2 rounded text-xs transition-colors"
            style={{
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              fontFamily: 'Space Mono, monospace',
            }}
          >
            Edit steps
          </button>
        )}

        {workflow.estimatedResultCount && (
          <span
            className="ml-auto text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            ~{workflow.estimatedResultCount} results expected
          </span>
        )}
      </div>
    </div>
  )
}
