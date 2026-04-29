/**
 * /brain — read-only context viewer.
 *
 * Reads `~/.gtm-os/{company_context.yaml, framework.yaml, voice/, ...}`
 * via /api/brain/context. Each section becomes a card with the rendered
 * yaml/markdown body, a confidence badge (when known), and a Regenerate
 * button that proxies to `start --regenerate`.
 *
 * Syntax highlighting uses a plain monospace `<pre>` block — adding a
 * highlighter (highlight.js / shiki) at this stage would push the SPA
 * past the 200KB raw bundle budget. 0.9.G can revisit if needed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'

type SectionId =
  | 'company_context'
  | 'framework'
  | 'voice'
  | 'icp'
  | 'positioning'
  | 'qualification_rules'
  | 'campaign_templates'
  | 'search_queries'
  | 'config'

interface BrainSectionFile {
  canonical: string
  abs: string
  content: string
  format: 'yaml' | 'markdown' | 'text'
}

interface BrainSection {
  id: SectionId
  files: BrainSectionFile[]
  confidence: number | null
  confidence_signals: {
    input_chars: number
    llm_self_rating: number
    has_metadata_anchors: boolean
  } | null
}

interface ContextResponse {
  tenant: string
  live_root: string
  sections: BrainSection[]
}

const TITLES: Record<SectionId, string> = {
  company_context: 'Company context',
  framework: 'GTM framework',
  voice: 'Voice & tone',
  icp: 'ICP segments',
  positioning: 'Positioning',
  qualification_rules: 'Qualification rules',
  campaign_templates: 'Campaign templates',
  search_queries: 'Search queries',
  config: 'Config',
}

function bucketForConfidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.85) return 'high'
  if (score >= 0.6) return 'medium'
  return 'low'
}

function badgeColorFor(bucket: 'high' | 'medium' | 'low'): string {
  if (bucket === 'high') return 'bg-[#3F8F5A] text-white border-transparent'
  if (bucket === 'medium') return 'bg-[#D4A23A] text-white border-transparent'
  return 'bg-[#C9506E] text-white border-transparent'
}

export function Brain() {
  const [data, setData] = useState<ContextResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [errorMap, setErrorMap] = useState<Record<string, string | null>>({})
  const [regenMessage, setRegenMessage] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await api.get<ContextResponse>('/api/brain/context')
      setData(res)
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Failed to load context (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Failed to load context'
      setLoadError(msg)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const handleRegenerate = async (id: SectionId) => {
    setBusy((prev) => ({ ...prev, [id]: true }))
    setErrorMap((prev) => ({ ...prev, [id]: null }))
    setRegenMessage(null)
    try {
      await api.post(`/api/brain/regenerate/${encodeURIComponent(id)}`, {})
      setRegenMessage(
        `Regenerated ${TITLES[id]}. Open /setup/review to commit the new draft.`,
      )
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? typeof err.body === 'object' && err.body && 'message' in err.body
            ? String((err.body as { message: unknown }).message)
            : `Regenerate failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Regenerate failed'
      setErrorMap((prev) => ({ ...prev, [id]: msg }))
    } finally {
      setBusy((prev) => ({ ...prev, [id]: false }))
    }
  }

  const sections = useMemo(() => data?.sections ?? [], [data])

  if (loadError) {
    return (
      <main className="min-h-screen px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <h1 className="font-heading text-3xl font-bold mb-4">Brain</h1>
          <Card>
            <CardContent className="pt-6">
              <p className="text-destructive">{loadError}</p>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Brain
          </p>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Context viewer</h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-1">
              tenant {data.tenant} · {data.live_root}
            </p>
          )}
        </header>

        {regenMessage && (
          <Card>
            <CardContent className="pt-6 text-sm" data-testid="brain-regen-message">
              {regenMessage}
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {sections.map((s) => {
            const bucket = s.confidence == null ? null : bucketForConfidence(s.confidence)
            const tooltip = s.confidence_signals
              ? `input_chars=${s.confidence_signals.input_chars}\nllm_self_rating=${s.confidence_signals.llm_self_rating}\nhas_metadata_anchors=${s.confidence_signals.has_metadata_anchors}`
              : 'no signals captured'
            return (
              <Card key={s.id} data-testid={`brain-card-${s.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>{TITLES[s.id]}</CardTitle>
                      <CardDescription className="font-mono text-xs">
                        {s.files.map((f) => f.canonical).join(' · ')}
                      </CardDescription>
                    </div>
                    {bucket && (
                      <Badge
                        data-testid={`brain-confidence-${s.id}`}
                        title={tooltip}
                        className={badgeColorFor(bucket)}
                      >
                        {bucket} · {s.confidence!.toFixed(2)}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {s.files.map((f) => (
                    <div key={f.canonical} className="space-y-1">
                      <p className="font-mono text-[11px] text-muted-foreground">{f.canonical}</p>
                      <pre
                        data-testid={`brain-content-${f.canonical}`}
                        className="rounded-md border border-border bg-background p-3 font-mono text-xs whitespace-pre-wrap break-words max-h-[280px] overflow-auto"
                      >
                        {f.content}
                      </pre>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`brain-regen-${s.id}`}
                      disabled={!!busy[s.id]}
                      onClick={() => handleRegenerate(s.id)}
                    >
                      {busy[s.id] ? 'Regenerating…' : 'Regenerate this section'}
                    </Button>
                  </div>
                  {errorMap[s.id] && (
                    <p
                      data-testid={`brain-error-${s.id}`}
                      className="text-xs text-destructive"
                    >
                      {errorMap[s.id]}
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
