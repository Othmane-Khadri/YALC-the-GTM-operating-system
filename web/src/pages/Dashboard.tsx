/**
 * /dashboard/<archetype> — archetype-specific dashboard surface (C3).
 *
 * Each of the four owner archetypes (a/b/c/d) has its own first-class
 * page. The page consumes /api/dashboard/<archetype>, renders the active
 * runs / last successful pass / awaiting gates / recent runs / linked
 * visualizations, and exposes a switcher so the user can flip to any of
 * the other three archetype dashboards without going back to /today.
 */

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { describeError, eyebrowClass } from '@/lib/feedback'

type ArchetypeId = 'a' | 'b' | 'c' | 'd'

interface ArchetypeMeta {
  id: ArchetypeId
  framework: string
  title: string
  description: string
}

interface AwaitingGate {
  run_id: string
  framework: string
  step_index: number
  gate_id: string
  prompt: string
  payload: unknown
  created_at: string
  timeout_hours: number
  stale: boolean
}

interface RecentRun {
  ranAt: string
  title: string
  summary: string
  rowCount: number
  error: string | null
}

interface VisualizationEntry {
  view_id: string
  intent: string
  generated: boolean
  last_generated_at: string | null
}

interface DashboardResponse {
  archetype: ArchetypeMeta
  installed: boolean
  active_runs: number
  last_successful_pass: string | null
  awaiting_gates: AwaitingGate[]
  recent_runs: RecentRun[]
  visualizations: VisualizationEntry[]
}

const PEERS: ArchetypeId[] = ['a', 'b', 'c', 'd']

function formatTime(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function navigateTo(path: string) {
  if (typeof window === 'undefined') return
  try {
    window.history.pushState(null, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch {
    // Fallback for environments without PopStateEvent (older test stubs).
    try {
      window.location.href = path
    } catch {
      // No-op — markup will still reflect the intended route via the URL.
    }
  }
}

export interface DashboardProps {
  archetypeId: ArchetypeId
}

export function Dashboard({ archetypeId }: DashboardProps) {
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      setData(await api.get<DashboardResponse>(`/api/dashboard/${archetypeId}`))
    } catch (err) {
      setLoadError(describeError(err, 'Failed to load dashboard'))
    }
  }, [archetypeId])

  useEffect(() => {
    reload()
  }, [reload])

  return (
    <main
      className="min-h-screen px-6 py-12"
      data-testid="dashboard-page"
      data-archetype={archetypeId}
    >
      <div className="max-w-3xl mx-auto space-y-6">
        <header data-testid={`archetype-${archetypeId}`}>
          <p className={eyebrowClass}>Archetype {archetypeId.toUpperCase()}</p>
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            {data?.archetype.title ?? `Dashboard ${archetypeId.toUpperCase()}`}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.archetype.description ??
              'Loading the archetype-specific framework view.'}
          </p>
        </header>

        <div
          className="flex flex-wrap gap-2 border-b border-border pb-4"
          data-testid="dashboard-switcher"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground self-center mr-2">
            Switch dashboard
          </span>
          {PEERS.map((id) => {
            const active = id === archetypeId
            return (
              <Button
                key={id}
                size="sm"
                variant={active ? 'default' : 'outline'}
                data-testid={`dashboard-switch-${id}`}
                aria-pressed={active}
                disabled={active}
                onClick={() => navigateTo(`/dashboard/${id}`)}
              >
                {id.toUpperCase()}
              </Button>
            )
          })}
          <Button
            size="sm"
            variant="ghost"
            data-testid="dashboard-switch-today"
            onClick={() => navigateTo('/today')}
          >
            Back to Today
          </Button>
        </div>

        {loadError && <p className="text-sm text-destructive">{loadError}</p>}

        <section className="grid grid-cols-2 gap-4" data-testid="dashboard-metrics">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wide">
                Active runs
              </CardDescription>
              <CardTitle className="text-2xl">{data?.active_runs ?? 0}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {data?.installed
                  ? 'Framework installed.'
                  : 'Framework not installed yet.'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wide">
                Last successful pass
              </CardDescription>
              <CardTitle className="text-base font-mono">
                {formatTime(data?.last_successful_pass ?? null)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {data?.awaiting_gates?.length
                  ? `${data.awaiting_gates.length} awaiting gate${
                      data.awaiting_gates.length === 1 ? '' : 's'
                    }`
                  : 'No gates awaiting approval.'}
              </p>
            </CardContent>
          </Card>
        </section>

        {data?.awaiting_gates?.length ? (
          <section className="space-y-3" data-testid="dashboard-gates">
            <h2 className="font-heading text-lg font-semibold">Awaiting gates</h2>
            {data.awaiting_gates.map((g) => (
              <Card key={g.run_id} data-testid={`dashboard-gate-${g.run_id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>{g.gate_id}</CardTitle>
                      <CardDescription className="font-mono text-xs">
                        step {g.step_index} · {g.framework}
                      </CardDescription>
                    </div>
                    <Badge className="bg-confidence-medium text-white border-transparent">
                      awaiting gate
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{g.prompt}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {formatTime(g.created_at)} · auto-rejects after {g.timeout_hours}h
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => navigateTo('/today')}
                  >
                    Resolve in Today
                  </Button>
                </CardContent>
              </Card>
            ))}
          </section>
        ) : null}

        {data?.recent_runs?.length ? (
          <section className="space-y-3" data-testid="dashboard-runs">
            <h2 className="font-heading text-lg font-semibold">Recent runs</h2>
            {data.recent_runs.map((r, i) => {
              const failed = !!r.error
              return (
                <Card key={`${r.ranAt}-${i}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle>{r.title}</CardTitle>
                        <CardDescription className="font-mono text-xs">
                          {r.rowCount} rows · {formatTime(r.ranAt)}
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
                  <CardContent className="space-y-2">
                    {r.summary && <p className="text-sm">{r.summary}</p>}
                    {failed && (
                      <p className="text-xs text-destructive font-mono">{r.error}</p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </section>
        ) : null}

        {data?.visualizations?.length ? (
          <section className="space-y-3" data-testid="dashboard-visualizations">
            <h2 className="font-heading text-lg font-semibold">Visualizations</h2>
            {data.visualizations.map((v) => (
              <Card key={v.view_id}>
                <CardHeader>
                  <CardTitle className="text-base">{v.view_id}</CardTitle>
                  <CardDescription>
                    {v.intent || 'No intent declared.'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {v.generated
                      ? `Generated ${formatTime(v.last_generated_at)}`
                      : 'Not generated yet.'}
                  </p>
                  {v.generated && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onClick={() => navigateTo(`/visualize/${v.view_id}`)}
                    >
                      Open visualization
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </section>
        ) : null}
      </div>
    </main>
  )
}
