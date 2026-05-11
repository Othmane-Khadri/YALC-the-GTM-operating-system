/**
 * /visualizations — directory of saved generated pages.
 *
 * Reads `/api/visualize/list` and renders one card per saved view (with an
 * iframe thumbnail) plus one card per installed framework that declares a
 * `default_visualization` but hasn't been generated yet (so the user can
 * trigger it from their terminal).
 */

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { describeError, eyebrowClass } from '@/lib/feedback'
import { openSseClient } from '@/lib/sse'

interface VisualizationItem {
  view_id: string
  intent: string
  idiom: string
  data_paths: string[]
  last_generated_at: string
  summary?: string
}

interface FrameworkDefault {
  framework: string
  view_id: string
  intent: string
  generated: boolean
}

interface ListResponse {
  items: VisualizationItem[]
  total: number
  frameworks: FrameworkDefault[]
}

/** Apply an SSE event to the local visualizations list. */
export function applyVisualizeEvent(
  prev: ListResponse | null,
  eventName: string,
  payload: Record<string, unknown>,
): ListResponse | null {
  if (!prev) return prev
  if (eventName === 'visualization_completed') {
    const viewId = String(payload.view_id ?? '')
    if (!viewId) return prev
    const incoming = payload as unknown as VisualizationItem
    const items = prev.items.filter((it) => it.view_id !== viewId)
    items.unshift(incoming)
    // Mark matching framework default as generated.
    const frameworks = prev.frameworks.map((f) =>
      f.view_id === viewId ? { ...f, generated: true } : f,
    )
    return { ...prev, items, total: items.length, frameworks }
  }
  return prev
}

export function Visualizations() {
  const [data, setData] = useState<ListResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .get<ListResponse>('/api/visualize/list')
      .then(setData)
      .catch((err) => setLoadError(describeError(err, 'Failed to load visualizations')))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // Live updates via SSE — completed visualizations splice into the grid.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return
    }
    const splice = (eventName: string) => (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      setData((prev) =>
        applyVisualizeEvent(prev, eventName, payload as Record<string, unknown>),
      )
    }
    const client = openSseClient('/api/visualize/stream', {
      handlers: {
        visualization_started: splice('visualization_started'),
        visualization_completed: splice('visualization_completed'),
        visualization_failed: splice('visualization_failed'),
      },
      onReconnect: () => reload(),
    })
    return () => client.close()
  }, [reload])

  const items = data?.items ?? []
  const frameworks = data?.frameworks ?? []
  const ungenerated = frameworks.filter((f) => !f.generated)

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <p className={eyebrowClass}>Visualizations</p>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Saved views</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tailored interactive pages generated from your local data. Re-run
            <code className="font-mono mx-1">yalc-gtm visualize &lt;view_id&gt;</code>
            to refresh any view.
          </p>
        </header>

        {loadError && <p className="text-sm text-destructive">{loadError}</p>}

        {items.length === 0 && !loadError && (
          <p className="text-sm" data-testid="visualizations-empty">
            No visualizations saved yet. Try{' '}
            <code className="font-mono">yalc-gtm visualize &lt;view_id&gt; --data &lt;glob&gt; --intent "..."</code>
            .
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((item) => (
            <Card key={item.view_id} data-testid={`viz-${item.view_id}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{item.view_id}</CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {item.idiom} · {new Date(item.last_generated_at).toLocaleString()}
                    </CardDescription>
                  </div>
                  <Badge className="bg-primary text-primary-foreground border-transparent">{item.idiom}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {item.summary && <p className="text-sm">{item.summary}</p>}
                <p className="text-xs text-muted-foreground">{item.intent}</p>
                <a
                  href={`/visualize/${encodeURIComponent(item.view_id)}`}
                  className="block rounded-md border overflow-hidden"
                  target="_blank"
                  rel="noreferrer"
                  data-testid={`viz-link-${item.view_id}`}
                >
                  <iframe
                    src={`/visualize/${encodeURIComponent(item.view_id)}`}
                    title={item.view_id}
                    className="w-full h-48 pointer-events-none"
                    loading="lazy"
                  />
                </a>
              </CardContent>
            </Card>
          ))}
        </div>

        {ungenerated.length > 0 && (
          <section className="space-y-3 pt-4">
            <h2 className="font-heading text-lg font-semibold">Pending defaults</h2>
            <div className="space-y-2">
              {ungenerated.map((f) => (
                <Card key={f.framework} data-testid={`viz-pending-${f.framework}`}>
                  <CardHeader>
                    <CardTitle className="text-base">{f.framework}</CardTitle>
                    <CardDescription>{f.intent}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <code className="block font-mono text-xs text-muted-foreground">
                      yalc-gtm visualize {f.view_id} --data
                      "~/.gtm-os/agents/{f.framework}.runs/*.json" --intent
                      "{f.intent}" --open
                    </code>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
