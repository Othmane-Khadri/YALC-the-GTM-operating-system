'use client'

import { useState } from 'react'

interface CampaignProposal {
  title: string
  hypothesis: string
  targetSegment: string
  channels: string[]
  successMetrics: { metric: string; target: number }[]
  steps: { skillId: string; channel?: string; approvalRequired?: boolean }[]
}

interface CampaignPreviewCardProps {
  proposal: CampaignProposal
  conversationId: string
  onCreated?: (campaignId: string) => void
}

export function CampaignPreviewCard({ proposal, conversationId, onCreated }: CampaignPreviewCardProps) {
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(false)
  const [campaignId, setCampaignId] = useState<string | null>(null)

  async function handleStart() {
    setCreating(true)
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          title: proposal.title,
          hypothesis: proposal.hypothesis,
          targetSegment: proposal.targetSegment,
          channels: proposal.channels,
          successMetrics: proposal.successMetrics.map(m => ({
            ...m,
            baseline: null,
            actual: null,
          })),
          steps: proposal.steps.map(s => ({
            skillId: s.skillId,
            skillInput: {},
            channel: s.channel ?? null,
            approvalRequired: s.approvalRequired ?? true,
          })),
        }),
      })
      const campaign = await res.json()
      setCampaignId(campaign.id)
      setCreated(true)
      onCreated?.(campaign.id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="border rounded-lg p-4 bg-white my-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium uppercase tracking-wider text-accent">Campaign Proposal</span>
      </div>
      <h3 className="font-medium text-sm">{String(proposal.title ?? '')}</h3>
      <p className="text-xs text-text-muted mt-1 italic">{String(proposal.hypothesis ?? '')}</p>

      <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
        <span>Segment: {String(proposal.targetSegment ?? '')}</span>
        <span>Channels: {Array.isArray(proposal.channels) ? proposal.channels.join(', ') : String(proposal.channels ?? '')}</span>
      </div>

      <div className="mt-3 space-y-1">
        <p className="text-xs font-medium">Success Metrics:</p>
        {proposal.successMetrics.map((m, i) => (
          <div key={i} className="text-xs text-text-muted flex items-center gap-2">
            <span>{String(m.metric ?? '')}</span>
            <span className="font-mono">target: {String(m.target ?? '')}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-1">
        <p className="text-xs font-medium">Steps:</p>
        {proposal.steps.map((s, i) => (
          <div key={i} className="text-xs text-text-muted flex items-center gap-2">
            <span className="w-4 text-right font-mono">{i + 1}.</span>
            <span className="font-mono">{String(s.skillId ?? '')}</span>
            {s.channel && <span className="text-accent">[{String(s.channel)}]</span>}
            {s.approvalRequired !== false && <span className="text-warning">(approval)</span>}
          </div>
        ))}
      </div>

      <div className="mt-4">
        {created ? (
          <a
            href={`/campaigns/${campaignId}`}
            className="inline-block px-4 py-2 text-sm font-medium rounded bg-success text-white hover:bg-success/90"
          >
            View Campaign
          </a>
        ) : (
          <button
            onClick={handleStart}
            disabled={creating}
            className="px-4 py-2 text-sm font-medium rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Start Campaign'}
          </button>
        )}
      </div>
    </div>
  )
}
