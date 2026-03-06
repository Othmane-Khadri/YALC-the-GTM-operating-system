'use client'

import { useState } from 'react'
import type { CampaignStep } from '@/lib/campaign/types'
import { cn } from '@/lib/utils'
import Link from 'next/link'

const STATUS_ICON: Record<string, { color: string; label: string }> = {
  pending: { color: 'bg-muted', label: 'Pending' },
  waiting_approval: { color: 'bg-tangerine animate-pulse', label: 'Needs Review' },
  approved: { color: 'bg-blueberry', label: 'Approved' },
  running: { color: 'bg-blueberry animate-pulse', label: 'Running' },
  completed: { color: 'bg-matcha', label: 'Completed' },
  failed: { color: 'bg-pomegranate', label: 'Failed' },
  skipped: { color: 'bg-muted', label: 'Skipped' },
}

interface CampaignStepCardProps {
  step: CampaignStep
  isLast: boolean
  onExecute: () => void
}

export function CampaignStepCard({ step, isLast, onExecute }: CampaignStepCardProps) {
  const [expanded, setExpanded] = useState(false)
  const statusInfo = STATUS_ICON[step.status] ?? STATUS_ICON.pending

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={cn('w-3 h-3 rounded-full mt-1.5 shrink-0', statusInfo.color)} />
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>

      <div className="flex-1 pb-4">
        <div
          className="border rounded-lg p-3 bg-card cursor-pointer hover:border-blueberry/30 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Step {step.stepIndex + 1}</span>
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted">{step.skillId}</span>
              {step.channel && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-blueberry/10 text-blueberry">{step.channel}</span>
              )}
            </div>
            <span className={cn(
              'text-xs px-2 py-0.5 rounded-full',
              step.status === 'completed' && 'bg-matcha/20 text-matcha',
              step.status === 'failed' && 'bg-pomegranate/20 text-pomegranate',
              step.status === 'running' && 'bg-blueberry/20 text-blueberry',
              step.status === 'waiting_approval' && 'bg-tangerine/20 text-tangerine',
              (step.status === 'pending' || step.status === 'approved' || step.status === 'skipped') && 'bg-muted text-muted-foreground',
            )}>
              {statusInfo.label}
            </span>
          </div>

          {step.status === 'waiting_approval' && (
            <Link
              href="/reviews"
              className="inline-block mt-2 text-xs text-tangerine hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              View in Reviews queue
            </Link>
          )}

          {expanded && (
            <div className="mt-3 pt-3 border-t space-y-2 text-xs text-muted-foreground">
              <div>
                <span className="font-medium">Config:</span>
                <pre className="mt-1 p-2 rounded bg-muted overflow-x-auto text-[11px]">
                  {JSON.stringify(step.skillInput, null, 2)}
                </pre>
              </div>
              {step.resultSetId && (
                <div>
                  <span className="font-medium">Result Set:</span>{' '}
                  <span className="font-mono">{step.resultSetId}</span>
                </div>
              )}
              {step.approvalRequired && (
                <div className="text-tangerine">Approval required before execution</div>
              )}
              {step.completedAt && (
                <div>Completed: {new Date(step.completedAt).toLocaleString()}</div>
              )}
              {step.status === 'pending' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onExecute() }}
                  className="px-3 py-1 text-xs rounded bg-blueberry text-white hover:bg-blueberry/90"
                >
                  Execute Step
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
