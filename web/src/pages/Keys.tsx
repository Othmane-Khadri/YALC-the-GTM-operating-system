/**
 * /keys — provider registry view.
 *
 * Lists every registered provider with a status badge (green / red / gray),
 * its capability set, and a Test button that fires `/api/keys/test/:id`.
 *
 * Rotate + Add new are navigation stubs in 0.9.0 — the underlying
 * `keys:connect` route lands in 0.9.D, so the buttons just push the user
 * to the eventual URLs (`/keys/connect`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'

interface KeyEntry {
  id: string
  name: string
  description: string
  type: 'builtin' | 'mcp' | 'mock'
  capabilities: string[]
  status: 'green' | 'red' | 'gray'
  hasHealthProbe: boolean
}

interface ListResponse {
  providers: KeyEntry[]
}

interface TestResult {
  status: string
  detail: string
  ok: boolean
}

function statusColor(status: KeyEntry['status']): string {
  if (status === 'green') return 'bg-[#3F8F5A] text-white border-transparent'
  if (status === 'red') return 'bg-[#C9506E] text-white border-transparent'
  return 'bg-muted text-muted-foreground border-transparent'
}

function statusLabel(status: KeyEntry['status']): string {
  if (status === 'green') return 'configured'
  if (status === 'red') return 'error'
  return 'not configured'
}

export function Keys() {
  const [data, setData] = useState<ListResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await api.get<ListResponse>('/api/keys/list')
      setData(res)
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Failed to load providers (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Failed to load providers'
      setLoadError(msg)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const handleTest = async (id: string) => {
    setBusy((prev) => ({ ...prev, [id]: true }))
    try {
      const res = await api.post<TestResult>(`/api/keys/test/${encodeURIComponent(id)}`, {})
      setTestResults((prev) => ({ ...prev, [id]: res }))
    } catch (err) {
      const detail =
        err instanceof ApiError
          ? typeof err.body === 'object' && err.body && 'detail' in err.body
            ? String((err.body as { detail: unknown }).detail)
            : `Test failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Test failed'
      setTestResults((prev) => ({
        ...prev,
        [id]: { status: 'fail', detail, ok: false },
      }))
    } finally {
      setBusy((prev) => ({ ...prev, [id]: false }))
    }
  }

  const handleRotate = (id: string) => {
    // /keys/connect lands in 0.9.D — for now navigate to the planned URL so
    // the SPA picks it up once the route is live.
    if (typeof window !== 'undefined') {
      window.location.href = `/keys/connect?provider=${encodeURIComponent(id)}`
    }
  }

  const handleAddNew = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/keys/connect'
    }
  }

  const providers = useMemo(() => data?.providers ?? [], [data])

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Keys
            </p>
            <h1 className="font-heading text-3xl font-bold tracking-tight">Providers</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Status of every registered provider. Test runs the provider&apos;s self-health
              probe.
            </p>
          </div>
          <Button
            data-testid="keys-add-new"
            variant="gradient"
            onClick={handleAddNew}
          >
            Add new
          </Button>
        </header>

        {loadError && (
          <Card>
            <CardContent className="pt-6 text-sm text-destructive">{loadError}</CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {providers.map((p) => {
            const tr = testResults[p.id]
            return (
              <Card key={p.id} data-testid={`keys-card-${p.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>{p.name}</CardTitle>
                      <CardDescription className="font-mono text-xs">
                        {p.id} · {p.type}
                      </CardDescription>
                    </div>
                    <Badge
                      data-testid={`keys-status-${p.id}`}
                      className={statusColor(p.status)}
                    >
                      {statusLabel(p.status)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{p.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {p.capabilities.map((cap) => (
                      <Badge key={cap} variant="outline" className="text-[10px]">
                        {cap}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      data-testid={`keys-test-${p.id}`}
                      disabled={!p.hasHealthProbe || !!busy[p.id]}
                      onClick={() => handleTest(p.id)}
                    >
                      {busy[p.id] ? 'Testing…' : 'Test'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`keys-rotate-${p.id}`}
                      onClick={() => handleRotate(p.id)}
                    >
                      Rotate
                    </Button>
                    {!p.hasHealthProbe && (
                      <span className="text-xs text-muted-foreground">no probe</span>
                    )}
                  </div>
                  {tr && (
                    <p
                      data-testid={`keys-test-result-${p.id}`}
                      className={`text-xs font-mono ${tr.ok ? 'text-foreground' : 'text-destructive'}`}
                    >
                      {tr.status} · {tr.detail}
                    </p>
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
