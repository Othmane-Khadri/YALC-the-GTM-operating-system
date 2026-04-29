/**
 * /today — daily feed of framework runs and pending human-gate items.
 *
 * Consumes /api/today/feed. Read-only in 0.9.0 (the awaiting-gate writer
 * lands in 0.9.E and an Approve button lands in 1.0.0; the structural
 * support is here today so the view "just works" once gates are populated).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'

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
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  } catch {
    return iso
  }
}

export function Today() {
  const [data, setData] = useState<FeedResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryBusy, setRetryBusy] = useState<Record<string, boolean>>({})
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await api.get<FeedResponse>('/api/today/feed')
      setData(res)
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Failed to load feed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Failed to load feed'
      setLoadError(msg)
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
      const msg =
        err instanceof ApiError
          ? typeof err.body === 'object' && err.body && 'message' in err.body
            ? String((err.body as { message: unknown }).message)
            : `Retry failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Retry failed'
      setRetryError(`${framework}: ${msg}`)
    } finally {
      setRetryBusy((prev) => ({ ...prev, [framework]: false }))
    }
  }

  const items = useMemo(() => data?.items ?? [], [data])
  const isEmpty = !loadError && data !== null && items.length === 0

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Today
          </p>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Daily feed</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Latest framework runs and pending human-gate approvals.
          </p>
        </header>

        {retryMessage && (
          <Card>
            <CardContent className="pt-6 text-sm" data-testid="today-retry-message">
              {retryMessage}
            </CardContent>
          </Card>
        )}
        {retryError && (
          <Card>
            <CardContent className="pt-6 text-sm text-destructive" data-testid="today-retry-error">
              {retryError}
            </CardContent>
          </Card>
        )}
        {loadError && (
          <Card>
            <CardContent className="pt-6 text-sm text-destructive">{loadError}</CardContent>
          </Card>
        )}
        {isEmpty && (
          <Card>
            <CardContent className="pt-6 text-sm" data-testid="today-empty">
              No frameworks installed yet. Try{' '}
              <code className="font-mono">yalc-gtm framework:list</code>.
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {items.map((item, i) => {
            const key =
              item.type === 'run' ? `run-${item.path}-${i}` : `gate-${item.framework}-${item.run_id}-${i}`
            if (item.type === 'awaiting_gate') {
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
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        data-testid={`today-approve-${item.framework}`}
                        disabled
                        title="Approval lands in 1.0.0"
                      >
                        Approve gate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
                      >
                        {expanded[key] ? 'Hide details' : 'View details'}
                      </Button>
                    </div>
                    {expanded[key] && (
                      <pre className="rounded-md border border-border bg-background p-3 font-mono text-xs overflow-x-auto">
                        {JSON.stringify(item.payload, null, 2)}
                      </pre>
                    )}
                  </CardContent>
                </Card>
              )
            }

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
                    {failed ? (
                      <Badge className="bg-[#C9506E] text-white border-transparent">failed</Badge>
                    ) : (
                      <Badge className="bg-[#3F8F5A] text-white border-transparent">ok</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {item.summary && <p className="text-sm">{item.summary}</p>}
                  {failed && (
                    <p className="text-xs text-destructive font-mono" data-testid={`today-error-${item.framework}`}>
                      {item.error}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{formatTime(item.ranAt)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
                      }
                    >
                      {expanded[key] ? 'Hide details' : 'View details'}
                    </Button>
                    {failed && (
                      <Button
                        size="sm"
                        variant="default"
                        data-testid={`today-retry-${item.framework}`}
                        disabled={!!retryBusy[item.framework]}
                        onClick={() => handleRetry(item.framework)}
                      >
                        {retryBusy[item.framework] ? 'Retrying…' : 'Retry'}
                      </Button>
                    )}
                  </div>
                  {expanded[key] && (
                    <pre className="rounded-md border border-border bg-background p-3 font-mono text-xs overflow-x-auto">
                      path: {item.path}
                    </pre>
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
