/**
 * /today — daily feed of framework runs and pending human-gate items.
 *
 * Consumes /api/today/feed. Approve / Reject for awaiting-gate items posts
 * to /api/gates/<run-id>/{approve,reject}; the payload preview is editable
 * (textarea over JSON) and on Approve the parsed object is sent as `edits`.
 */

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { describeError, eyebrowClass } from '@/lib/feedback'
import { StructuredValue, tryParseJson } from '@/lib/render'
import { TriggerNowButton } from '@/components/TriggerNowButton'
import { openSseClient } from '@/lib/sse'
import { shouldShowViewEditsLink } from '@/components/gates/GateDiffView'
import { GateDiffModal } from '@/components/gates/GateDiffModal'

interface RunItem {
  type: 'run'
  framework: string
  title: string
  summary: string
  ranAt: string
  rowCount: number
  error: string | null
  path: string
  /** Surfaced by the server so we can show the Trigger now button (D4). */
  mode?: 'on-demand' | 'scheduled'
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
  /** Resolved timeout window for this gate's framework, in hours. */
  timeout_hours?: number
  /** Server-side flag: gate is in the last 20% of the timeout window. */
  stale?: boolean
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

/**
 * Apply an SSE event to the local feed list.
 *
 * Splice rules:
 *   gate_awaiting / run_started / run_completed / run_failed → upsert by
 *     (type + framework + run_id|ranAt) at the head of the list.
 *   gate_approved / gate_rejected → drop the matching awaiting_gate item.
 *   gate_stale → flip `stale: true` on the matching awaiting_gate item.
 */
export function applyTodayEvent(
  items: FeedItem[],
  eventName: string,
  payload: Record<string, unknown>,
): FeedItem[] {
  if (eventName === 'gate_approved' || eventName === 'gate_rejected') {
    const runId = String(payload.run_id ?? '')
    return items.filter(
      (it) => !(it.type === 'awaiting_gate' && it.run_id === runId),
    )
  }
  if (eventName === 'gate_stale') {
    const runId = String(payload.run_id ?? '')
    return items.map((it) =>
      it.type === 'awaiting_gate' && it.run_id === runId
        ? { ...it, stale: true }
        : it,
    )
  }
  if (eventName === 'gate_awaiting') {
    const runId = String(payload.run_id ?? '')
    const next = items.filter(
      (it) => !(it.type === 'awaiting_gate' && it.run_id === runId),
    )
    return [payload as unknown as GateItem, ...next]
  }
  if (
    eventName === 'run_started' ||
    eventName === 'run_completed' ||
    eventName === 'run_failed'
  ) {
    const framework = String(payload.framework ?? '')
    const ranAt = String(payload.ranAt ?? '')
    const next = items.filter(
      (it) => !(it.type === 'run' && it.framework === framework && it.ranAt === ranAt),
    )
    return [payload as unknown as RunItem, ...next]
  }
  return items
}

export function Today() {
  const [data, setData] = useState<FeedResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryBusy, setRetryBusy] = useState<Record<string, boolean>>({})
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [triggerBusy, setTriggerBusy] = useState<Record<string, boolean>>({})
  // Per-gate state — keyed by run_id so concurrent gates don't clobber.
  const [payloadDrafts, setPayloadDrafts] = useState<Record<string, string>>({})
  const [payloadEditing, setPayloadEditing] = useState<Record<string, boolean>>({})
  const [rejectDrafts, setRejectDrafts] = useState<Record<string, string>>({})
  const [gateBusy, setGateBusy] = useState<Record<string, boolean>>({})
  const [diffOpenFor, setDiffOpenFor] = useState<string | null>(null)
  const [gateMessage, setGateMessage] = useState<string | null>(null)
  const [gateError, setGateError] = useState<string | null>(null)

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

  const handleTrigger = async (framework: string) => {
    setTriggerBusy((prev) => ({ ...prev, [framework]: true }))
    setRetryError(null)
    setRetryMessage(null)
    try {
      const r = await api.post<{ run_id: string }>(
        `/api/today/trigger/${encodeURIComponent(framework)}`,
        {},
      )
      setRetryMessage(`Triggered ${framework} (run ${r.run_id}).`)
      // Poll once after a short delay; SSE will pick up subsequent transitions.
      setTimeout(() => {
        void reload()
        setTriggerBusy((prev) => ({ ...prev, [framework]: false }))
      }, 1500)
    } catch (err) {
      setRetryError(`${framework}: ${describeError(err, 'Trigger failed')}`)
      setTriggerBusy((prev) => ({ ...prev, [framework]: false }))
    }
  }

  // Live updates — splice in events without re-fetching, and on reconnect
  // re-fetch to recover any events emitted while disconnected.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return
    }
    const splice = (eventName: string) => (data: unknown) => {
      if (!data || typeof data !== 'object') return
      setData((prev) => {
        const items = prev?.items ?? []
        const next = applyTodayEvent(items, eventName, data as Record<string, unknown>)
        return {
          items: next,
          total: next.length,
          limit: prev?.limit ?? 50,
        }
      })
    }
    const client = openSseClient('/api/today/stream', {
      handlers: {
        gate_awaiting: splice('gate_awaiting'),
        gate_approved: splice('gate_approved'),
        gate_rejected: splice('gate_rejected'),
        gate_stale: splice('gate_stale'),
        run_started: splice('run_started'),
        run_completed: splice('run_completed'),
        run_failed: splice('run_failed'),
      },
      onReconnect: () => {
        void reload()
      },
    })
    return () => client.close()
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

  const handleApprove = async (item: GateItem) => {
    const key = item.run_id
    setGateBusy((prev) => ({ ...prev, [key]: true }))
    setGateError(null)
    setGateMessage(null)
    try {
      const draft = payloadDrafts[key]
      let edits: unknown = undefined
      if (typeof draft === 'string' && draft.trim().length > 0) {
        try {
          edits = JSON.parse(draft)
        } catch {
          throw new Error('Payload is not valid JSON. Fix it before approving.')
        }
      }
      await api.post(`/api/gates/${encodeURIComponent(key)}/approve`, { edits })
      setGateMessage(`Approved gate ${item.gate_id} on ${item.framework}.`)
      await reload()
    } catch (err) {
      setGateError(`${item.framework}: ${describeError(err, 'Approve failed')}`)
    } finally {
      setGateBusy((prev) => ({ ...prev, [key]: false }))
    }
  }

  const handleReject = async (item: GateItem) => {
    const key = item.run_id
    const reason = (rejectDrafts[key] ?? '').trim()
    if (reason.length === 0) {
      setGateError(`${item.framework}: rejection reason is required.`)
      return
    }
    setGateBusy((prev) => ({ ...prev, [key]: true }))
    setGateError(null)
    setGateMessage(null)
    try {
      await api.post(`/api/gates/${encodeURIComponent(key)}/reject`, { reason })
      setGateMessage(`Rejected gate ${item.gate_id} on ${item.framework}.`)
      await reload()
    } catch (err) {
      setGateError(`${item.framework}: ${describeError(err, 'Reject failed')}`)
    } finally {
      setGateBusy((prev) => ({ ...prev, [key]: false }))
    }
  }

  const draftFor = (item: GateItem): string => {
    const key = item.run_id
    if (key in payloadDrafts) return payloadDrafts[key]
    try {
      return JSON.stringify(item.payload, null, 2)
    } catch {
      return ''
    }
  }

  // Render the JSON draft as a structured tree. The draft is the source of
  // truth (so edits round-trip through the textarea), but the user reads
  // it through the structured view by default.
  function PayloadPreview({ draft }: { draft: string }): JSX.Element {
    if (!draft.trim()) {
      return <p className="text-muted-foreground italic text-sm">No payload attached to this gate.</p>
    }
    const parsed = tryParseJson(draft)
    if (!parsed.ok) {
      return (
        <p className="text-destructive text-xs">
          Could not parse payload: {parsed.error}. Switch to "Edit raw JSON" to fix.
        </p>
      )
    }
    return <StructuredValue value={parsed.value} />
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
        {gateMessage && (
          <p className="text-sm" data-testid="today-gate-message">{gateMessage}</p>
        )}
        {gateError && (
          <p className="text-sm text-destructive" data-testid="today-gate-error">{gateError}</p>
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
              const busy = !!gateBusy[item.run_id]
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
                      <div className="flex flex-col gap-1 items-end">
                        <Badge className="bg-confidence-medium text-white border-transparent">awaiting gate</Badge>
                        {item.stale && (
                          <Badge
                            data-testid={`today-gate-stale-${item.framework}`}
                            className="bg-confidence-low text-white border-transparent"
                          >
                            stale
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm">{item.prompt}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTime(item.created_at)}
                      {item.timeout_hours !== undefined ? (
                        <> · auto-rejects after {item.timeout_hours}h</>
                      ) : null}
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Payload (Approve sends this back as your edits)
                        </label>
                        <div className="flex items-center gap-2">
                          {shouldShowViewEditsLink(item.payload, draftFor(item)) && (
                            <button
                              type="button"
                              data-testid={`today-view-edits-${item.framework}`}
                              className="text-xs px-2 py-1 rounded text-primary hover:underline"
                              onClick={() => setDiffOpenFor(item.run_id)}
                            >
                              View edits
                            </button>
                          )}
                          <button
                            type="button"
                            data-testid={`today-payload-mode-${item.framework}`}
                            className="text-xs px-2 py-1 rounded text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              setPayloadEditing((prev) => ({
                                ...prev,
                                [item.run_id]: !prev[item.run_id],
                              }))
                            }
                          >
                            {payloadEditing[item.run_id] ? 'Reading view' : 'Edit raw JSON'}
                          </button>
                        </div>
                      </div>
                      {payloadEditing[item.run_id] ? (
                        <textarea
                          id={`payload-${item.run_id}`}
                          data-testid={`today-payload-${item.framework}`}
                          className="w-full h-48 rounded-md border bg-background p-2 font-mono text-xs"
                          value={draftFor(item)}
                          onChange={(e) =>
                            setPayloadDrafts((prev) => ({ ...prev, [item.run_id]: e.target.value }))
                          }
                        />
                      ) : (
                        <div
                          data-testid={`today-payload-pretty-${item.framework}`}
                          className="rounded-md border border-border bg-background/40 p-3 max-h-72 overflow-y-auto"
                        >
                          <PayloadPreview draft={draftFor(item)} />
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium" htmlFor={`reason-${item.run_id}`}>
                        Rejection reason (required to Reject)
                      </label>
                      <input
                        id={`reason-${item.run_id}`}
                        data-testid={`today-reason-${item.framework}`}
                        className="w-full rounded-md border bg-background p-2 text-sm"
                        value={rejectDrafts[item.run_id] ?? ''}
                        onChange={(e) =>
                          setRejectDrafts((prev) => ({ ...prev, [item.run_id]: e.target.value }))
                        }
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        data-testid={`today-approve-${item.framework}`}
                        disabled={busy}
                        onClick={() => handleApprove(item)}
                      >
                        {busy ? 'Working…' : 'Approve'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`today-reject-${item.framework}`}
                        disabled={busy}
                        onClick={() => handleReject(item)}
                      >
                        Reject
                      </Button>
                    </div>
                    {diffOpenFor === item.run_id && (
                      <GateDiffModal item={item} draft={draftFor(item)} onClose={() => setDiffOpenFor(null)} />
                    )}
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
                          ? 'bg-confidence-low text-white border-transparent'
                          : 'bg-confidence-high text-white border-transparent'
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
                  <div className="flex gap-2">
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
                    <TriggerNowButton
                      framework={item.framework}
                      mode={item.mode}
                      busy={!!triggerBusy[item.framework]}
                      onClick={() => handleTrigger(item.framework)}
                    />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </main>
  )
}
