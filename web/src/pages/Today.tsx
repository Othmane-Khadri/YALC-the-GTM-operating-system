/**
 * /today — daily feed of framework runs and pending human-gate items.
 *
 * Consumes /api/today/feed. Read-only in 0.9.0 (the awaiting-gate writer
 * lands in 0.9.E and an Approve button lands in 1.0.0; the structural
 * support is here today so the view "just works" once gates are populated).
 */

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { describeError, eyebrowClass } from '@/lib/feedback'

interface RunItem {
  type: 'run'
  framework: string
  title: string
  summary: string
  ranAt: string
  rowCount: number
  error: string | null
  path: string
}

interface GateItem {
  type: 'awaiting_gate'
  framework: string
  run_id: string
  step_index: number
  gate_id: string
  prompt: string
  payload: unknown
  created_at: string
}

type FeedItem = RunItem | GateItem

interface FeedResponse {
  items: FeedItem[]
  total: number
  limit: number
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

export function Today() {
  const [data, setData] = useState<FeedResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryBusy, setRetryBusy] = useState<Record<string, boolean>>({})
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      setData(await api.get<FeedResponse>('/api/today/feed'))
    } catch (err) {
      setLoadError(describeError(err, 'Failed to load feed'))
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const handleRetry = async (framework: string) => {
    setRetryBusy((prev) => ({ ...prev, [framework]: true }))
    setRetryError(null)
    setRetryMessage(null)
    try {
      await api.post(`/api/today/retry/${encodeURIComponent(framework)}`, {})
      setRetryMessage(`Retried ${framework}.`)
      await reload()
    } catch (err) {
      setRetryError(`${framework}: ${describeError(err, 'Retry failed')}`)
    } finally {
      setRetryBusy((prev) => ({ ...prev, [framework]: false }))
    }
  }

  const items = data?.items ?? []
  const isEmpty = !loadError && data !== null && items.length === 0

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <p className={eyebrowClass}>Today</p>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Daily feed</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Latest framework runs and pending human-gate approvals.
          </p>
        </header>

        {retryMessage && (
          <p className="text-sm" data-testid="today-retry-message">{retryMessage}</p>
        )}
        {retryError && (
          <p className="text-sm text-destructive" data-testid="today-retry-error">{retryError}</p>
        )}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {isEmpty && (
          <p className="text-sm" data-testid="today-empty">
            No frameworks installed yet. Try{' '}
            <code className="font-mono">yalc-gtm framework:list</code>.
          </p>
        )}

        <div className="space-y-4">
          {items.map((item, i) => {
            if (item.type === 'awaiting_gate') {
              const key = `gate-${i}-${item.framework}`
              return (
                <Card key={key} data-testid={`today-gate-${item.framework}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle>{item.framework}</CardTitle>
                        <CardDescription className="font-mono text-xs">
                          step {item.step_index} · {item.gate_id}
                        </CardDescription>
                      </div>
                      <Badge className="bg-[#D4A23A] text-white border-transparent">awaiting gate</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm">{item.prompt}</p>
                    <p className="text-xs text-muted-foreground">{formatTime(item.created_at)}</p>
                    <Button
                      size="sm"
                      data-testid={`today-approve-${item.framework}`}
                      disabled
                      title="Approval lands in 1.0.0"
                    >
                      Approve gate
                    </Button>
                  </CardContent>
                </Card>
              )
            }
            const key = `run-${i}-${item.framework}`
            const failed = !!item.error
            return (
              <Card key={key} data-testid={`today-run-${item.framework}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>{item.title}</CardTitle>
                      <CardDescription className="font-mono text-xs">
                        {item.framework} · {item.rowCount} rows
                      </CardDescription>
                    </div>
                    <Badge
                      className={
                        failed
                          ? 'bg-[#C9506E] text-white border-transparent'
                          : 'bg-[#3F8F5A] text-white border-transparent'
                      }
                    >
                      {failed ? 'failed' : 'ok'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {item.summary && <p className="text-sm">{item.summary}</p>}
                  {failed && (
                    <p
                      className="text-xs text-destructive font-mono"
                      data-testid={`today-error-${item.framework}`}
                    >
                      {item.error}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{formatTime(item.ranAt)}</p>
                  {failed && (
                    <Button
                      size="sm"
                      data-testid={`today-retry-${item.framework}`}
                      disabled={!!retryBusy[item.framework]}
                      onClick={() => handleRetry(item.framework)}
                    >
                      {retryBusy[item.framework] ? 'Retrying…' : 'Retry'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </main>
  )
}
