'use client'

import { useEffect, useState } from 'react'
import { CampaignStepCard } from './CampaignStepCard'
import type { Campaign, SuccessMetric } from '@/lib/campaign/types'
import { cn } from '@/lib/utils'

interface CampaignDetailProps {
  campaignId: string
}

export function CampaignDetail({ campaignId }: CampaignDetailProps) {
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [nudgeCount, setNudgeCount] = useState<number | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/campaigns/${campaignId}`)
        const data = await res.json()
        setCampaign(data)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [campaignId])

  async function handleAction(action: 'pause' | 'resume') {
    await fetch(`/api/campaigns/${campaignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const res = await fetch(`/api/campaigns/${campaignId}`)
    setCampaign(await res.json())
  }

  async function handleAnalyze() {
    setAnalyzing(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/analyze`, { method: 'POST' })
      const data = await res.json()
      setNudgeCount(data.nudges?.length ?? 0)
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleExecuteStep(stepId: string) {
    await fetch(`/api/campaigns/${campaignId}/steps/${stepId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await fetch(`/api/campaigns/${campaignId}`)
    setCampaign(await res.json())
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading campaign...</div>
  }

  if (!campaign) {
    return <div className="p-6 text-sm text-pomegranate">Campaign not found</div>
  }

  const nextStep = campaign.steps.find(s => s.status === 'pending' || s.status === 'approved')

  return (
    <div className="flex flex-col h-full p-6 space-y-6 overflow-y-auto">
      <div className="border rounded-lg p-5 bg-card">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold font-mono">{campaign.title}</h1>
          <div className="flex items-center gap-2">
            {(campaign.status === 'active' || campaign.status === 'paused') && (
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="px-3 py-1.5 text-sm rounded bg-blueberry text-white hover:bg-blueberry/90 disabled:opacity-50"
              >
                {analyzing ? 'Analyzing...' : 'Analyze Campaign'}
              </button>
            )}
            {nudgeCount !== null && nudgeCount > 0 && (
              <a
                href="/reviews"
                className="px-2 py-1 text-xs rounded-full bg-dragonfruit/20 text-dragonfruit"
              >
                {nudgeCount} nudge{nudgeCount !== 1 ? 's' : ''}
              </a>
            )}
            {campaign.status === 'active' && (
              <button
                onClick={() => handleAction('pause')}
                className="px-3 py-1.5 text-sm rounded bg-tangerine text-white hover:bg-tangerine/90"
              >
                Pause
              </button>
            )}
            {campaign.status === 'paused' && (
              <button
                onClick={() => handleAction('resume')}
                className="px-3 py-1.5 text-sm rounded bg-matcha text-white hover:bg-matcha/90"
              >
                Resume
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground italic">Hypothesis: {campaign.hypothesis}</p>
        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
          {campaign.targetSegment && <span>Segment: {campaign.targetSegment}</span>}
          {campaign.channels.length > 0 && <span>Channels: {campaign.channels.join(', ')}</span>}
        </div>
      </div>

      {campaign.successMetrics.length > 0 && (
        <div className="border rounded-lg p-4 bg-card">
          <h2 className="text-sm font-medium font-mono mb-3">Success Metrics</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {campaign.successMetrics.map((m: SuccessMetric, i: number) => (
              <div key={i} className="flex items-center justify-between p-2 rounded bg-muted/50">
                <span className="text-sm">{m.metric}</span>
                <div className="text-right">
                  <span className="text-sm font-mono">
                    {m.actual ?? '---'} / {m.target}
                  </span>
                  {m.baseline !== null && (
                    <span className="text-xs text-muted-foreground ml-2">(baseline: {m.baseline})</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium font-mono">Steps</h2>
          {nextStep && (
            <button
              onClick={() => handleExecuteStep(nextStep.id)}
              className="px-3 py-1.5 text-sm font-medium rounded bg-blueberry text-white hover:bg-blueberry/90"
            >
              Execute Next Step
            </button>
          )}
        </div>
        <div className="space-y-0">
          {campaign.steps.map((step, i) => (
            <CampaignStepCard
              key={step.id}
              step={step}
              isLast={i === campaign.steps.length - 1}
              onExecute={() => handleExecuteStep(step.id)}
            />
          ))}
        </div>
      </div>

      {campaign.verdict && (
        <div className={cn(
          'border rounded-lg p-4',
          campaign.verdict.result === 'confirmed' && 'border-matcha bg-matcha/5',
          campaign.verdict.result === 'disproven' && 'border-pomegranate bg-pomegranate/5',
          campaign.verdict.result === 'inconclusive' && 'border-tangerine bg-tangerine/5',
        )}>
          <h2 className="text-sm font-medium font-mono mb-1">
            Verdict: {campaign.verdict.result.toUpperCase()}
          </h2>
          <p className="text-sm text-muted-foreground">{campaign.verdict.evidence}</p>
        </div>
      )}
    </div>
  )
}
