/**
 * /keys/connect — provider key entry form (0.9.D).
 *
 * Modes: ?provider=<id> -> schema-driven; agnostic otherwise.
 * ?mode=rotate adds the overwrite banner.
 * type=password autocomplete=off so values never autofill into chat.
 */

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { describeError, eyebrowClass } from '@/lib/feedback'

interface EnvVar { name: string; description: string; example: string; required: boolean }
interface KEntry { id: string; display_name: string; key_acquisition_url: string | null; integration_kind: string; env_vars: EnvVar[] }
interface SaveRes { status: 'configured' | 'failed'; provider: string; healthcheck: { status: string; detail: string; ok: boolean }; sentinel_path: string }

const C = 'rounded-xl border border-border bg-card p-4 shadow-sm'
const I = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
const B = 'inline-flex items-center justify-center rounded-md text-sm font-medium px-4 py-2'

export function KeysConnect() {
  const [k, setK] = useState<KEntry[]>([])
  const [le, setLe] = useState<string | null>(null)
  const [pid, setPid] = useState('')
  const [mode, setMode] = useState('')
  const [show, setShow] = useState(false)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [cv, setCv] = useState<Array<[string, string]>>([['', '']])
  const [busy, setBusy] = useState(false)
  const [r, setR] = useState<SaveRes | null>(null)
  const [se, setSe] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const x = new URLSearchParams(window.location.search)
    setPid(x.get('provider') ?? '')
    setMode(x.get('mode') ?? '')
  }, [])

  useEffect(() => {
    let c = false
    api.get<{ providers: KEntry[] }>('/api/keys/knowledge')
      .then((rr) => { if (!c) setK(rr.providers) })
      .catch((err) => { if (!c) setLe(describeError(err, 'Failed to load knowledge')) })
    return () => { c = true }
  }, [])

  const m = k.find((x) => x.id === pid) ?? null

  function pick(id: string) {
    setPid(id); setShow(false)
    if (typeof window === 'undefined') return
    const u = new URL(window.location.href)
    u.searchParams.set('provider', id)
    window.history.pushState({}, '', u.toString())
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSe(null); setR(null)
    let provider = pid, env: Record<string, string> = {}
    if (m) env = { ...vals }
    else {
      provider = pid.trim().toLowerCase()
      if (!/^[a-z][a-z0-9-]*$/.test(provider)) return setSe('Provider name must be a lowercase slug (a-z0-9-).')
      for (const [n, v] of cv) if (n.trim()) env[n.trim()] = v
      if (!Object.keys(env).length) return setSe('Add at least one env var.')
    }
    setBusy(true)
    api.post<SaveRes>('/api/keys/save', { provider, env }).then(setR)
      .catch((err) => setSe(describeError(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  function done() {
    if (typeof window === 'undefined') return
    if (window.history.length > 1) window.history.back()
    else window.location.href = '/keys'
  }

  function uv(i: number, f: 0 | 1, v: string) {
    setCv((p) => {
      const n = p.slice()
      n[i] = f === 0 ? [v, n[i][1]] : [n[i][0], v]
      if (i === n.length - 1 && v) n.push(['', ''])
      return n
    })
  }

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <header>
          <p className={eyebrowClass}>Keys</p>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Connect a provider</h1>
          <p className="text-sm text-muted-foreground mt-1">Keys land in ~/.gtm-os/.env, never in chat.</p>
        </header>

        {mode === 'rotate' && (
          <div className={C} data-testid="keys-connect-rotate-banner">
            <p className="font-medium">Rotating — this overwrites the existing key.</p>
          </div>
        )}

        {le && <p className="text-sm text-destructive">{le}</p>}

        <form onSubmit={submit} className="space-y-4" data-testid="keys-connect-form">
          <div className={C} data-testid="keys-connect-primary">
            <p className="font-medium mb-2">Provider name (or describe your own)</p>
            <input className={I} data-testid="keys-connect-provider-input" value={pid}
              onChange={(e) => setPid(e.target.value)} placeholder="e.g. crustdata" autoComplete="off" />
          </div>

          {!m && (
            <div className={C} data-testid="keys-connect-suggestions">
              <button type="button" className="text-left w-full" data-testid="keys-connect-suggestions-toggle" onClick={() => setShow((v) => !v)}>
                <p className="text-sm font-medium">we have suggestions for these {k.length} providers</p>
              </button>
              {show && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {k.map((x) => (
                    <button key={x.id} type="button" className={B + ' border border-input bg-background'}
                      data-testid={`keys-connect-suggest-${x.id}`} onClick={() => pick(x.id)}>{x.display_name}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {m ? (
            <div className={C} data-testid="keys-connect-schema">
              <p className="font-medium mb-2">{m.display_name}</p>
              <div className="space-y-3">
                {m.env_vars.map((ev) => (
                  <div key={ev.name} className="space-y-1">
                    <label htmlFor={`kc-${ev.name}`} className="text-sm font-mono">{ev.name}</label>
                    {ev.description && <p className="text-xs text-muted-foreground">{ev.description}</p>}
                    <input id={`kc-${ev.name}`} className={I} data-testid={`keys-connect-input-${ev.name}`}
                      type="password" autoComplete="off" placeholder={ev.example || ev.name}
                      value={vals[ev.name] ?? ''} onChange={(e) => setVals((p) => ({ ...p, [ev.name]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className={C} data-testid="keys-connect-custom">
              <p className="font-medium mb-2">Env vars (UPPER_SNAKE_CASE)</p>
              <div className="space-y-2">
                {cv.map((v, i) => (
                  <div key={i} className="flex gap-2">
                    <input className={I} data-testid={`keys-connect-custom-name-${i}`} placeholder="EXAMPLE_API_KEY"
                      autoComplete="off" value={v[0]} onChange={(e) => uv(i, 0, e.target.value)} />
                    <input className={I} data-testid={`keys-connect-custom-value-${i}`} type="password"
                      autoComplete="off" placeholder="value" value={v[1]} onChange={(e) => uv(i, 1, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" className={B + ' bg-primary text-primary-foreground'} data-testid="keys-connect-submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save key'}
            </button>
            {se && <span className="text-sm text-destructive" data-testid="keys-connect-error">{se}</span>}
          </div>
        </form>

        {r && (
          <div className={C} data-testid="keys-connect-result">
            <p className="font-medium">
              <span className={'rounded px-2 py-0.5 text-xs text-white mr-2 ' + (r.status === 'configured' ? 'bg-[#3F8F5A]' : 'bg-[#C9506E]')}>{r.status}</span>
              {r.provider}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{r.healthcheck.status} · {r.healthcheck.detail}</p>
            <p className="text-xs text-muted-foreground font-mono break-all mt-2">sentinel: {r.sentinel_path}</p>
            <button type="button" className={B + ' border border-input bg-background mt-3'} onClick={done} data-testid="keys-connect-done">Done</button>
          </div>
        )}
      </div>
    </main>
  )
}

export default KeysConnect
