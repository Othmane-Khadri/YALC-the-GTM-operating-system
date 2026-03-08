'use client'

import { useEffect } from 'react'
import { useAtom } from 'jotai'
import { campaignsAtom, campaignsLoadingAtom, campaignFilterAtom } from '@/atoms/campaigns'
import type { CampaignStatus } from '@/lib/campaign/types'
import { cn } from '@/lib/utils'
import Link from 'next/link'

const STATUS_TABS: { label: string; value: CampaignStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'Completed', value: 'completed' },
]

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-surface-2 text-text-muted',
  planning: 'bg-accent/20 text-accent',
  active: 'bg-success/20 text-success',
  paused: 'bg-warning/20 text-warning',
  completed: 'bg-surface-2 text-text-muted',
  failed: 'bg-error/20 text-error',
}

export function CampaignsView() {
  const [campaignsList, setCampaigns] = useAtom(campaignsAtom)
  const [loading, setLoading] = useAtom(campaignsLoadingAtom)
  const [filter, setFilter] = useAtom(campaignFilterAtom)

  useEffect(() => {
    async function fetchCampaigns() {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (filter !== 'all') params.set('status', filter)
        const res = await fetch(`/api/campaigns?${params.toString()}`)
        const data = await res.json()
        setCampaigns(data)
      } finally {
        setLoading(false)
      }
    }
    fetchCampaigns()
  }, [filter, setCampaigns, setLoading])

  return (
    <div className="flex flex-col h-full p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">Campaigns</h1>
          <p className="text-sm text-text-muted mt-1">
            Hypothesis-driven campaigns that compose skills into multi-step execution.
          </p>
        </div>
        <Link
          href="/"
          className="px-4 py-2 text-sm font-medium rounded-md bg-text-primary text-white hover:bg-accent/90"
        >
          New Campaign
        </Link>
      </div>

      <div className="flex items-center gap-2">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              filter === tab.value
                ? 'bg-text-primary text-white'
                : 'bg-surface-2 text-text-muted hover:bg-surface-2/80'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3">
        {loading ? (
          <div className="text-sm text-text-muted animate-pulse">Loading campaigns...</div>
        ) : campaignsList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-text-muted">
            <p className="text-lg font-display">No campaigns yet</p>
            <p className="text-sm mt-1">Start a chat and describe a multi-step outreach effort to create your first campaign.</p>
          </div>
        ) : (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          campaignsList.map((campaign: any) => {
            const completedSteps = campaign.steps?.filter((s: { status: string }) => s.status === 'completed').length ?? 0
            const totalSteps = campaign.steps?.length ?? 0
            const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0

            return (
              <Link
                key={campaign.id}
                href={`/campaigns/${campaign.id}`}
                className="block border rounded-lg p-4 hover:border-accent/50 transition-colors bg-white"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-sm truncate">{campaign.title}</h3>
                      <span className={cn('text-xs px-2 py-0.5 rounded-full', STATUS_COLORS[campaign.status])}>
                        {campaign.status}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted mt-1 line-clamp-1">
                      {campaign.hypothesis}
                    </p>
                  </div>
                  <div className="text-right text-xs text-text-muted whitespace-nowrap">
                    {campaign.channels?.join(', ')}
                  </div>
                </div>

                {totalSteps > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                      <span>{completedSteps}/{totalSteps} steps</span>
                      <span>{progressPct}%</span>
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-success rounded-full transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {campaign.metrics && (campaign.metrics.sent > 0 || campaign.metrics.totalLeads > 0) && (
                  <div className="mt-2 flex items-center gap-4 text-xs text-text-muted">
                    <span>{campaign.metrics.totalLeads} leads</span>
                    <span>{campaign.metrics.sent} sent</span>
                    <span>{campaign.metrics.replied} replied</span>
                    <span>{campaign.metrics.converted} converted</span>
                  </div>
                )}
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
