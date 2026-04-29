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

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import {
  bucketBadgeClass,
  bucketForConfidence,
  describeError,
  eyebrowClass,
  preBlockClass,
} from '@/lib/feedback'

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

export function Brain() {
  const [data, setData] = useState<ContextResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [errorMap, setErrorMap] = useState<Record<string, string | null>>({})
  const [regenMessage, setRegenMessage] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      setData(await api.get<ContextResponse>('/api/brain/context'))
    } catch (err) {
      setLoadError(describeError(err, 'Failed to load context'))
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const handleRegenerate = async (id: SectionId) => {
    setBusy((p) => ({ ...p, [id]: true }))
    setErrorMap((p) => ({ ...p, [id]: null }))
    setRegenMessage(null)
    try {
      await api.post(`/api/brain/regenerate/${encodeURIComponent(id)}`, {})
      setRegenMessage(
        `Regenerated ${TITLES[id]}. Open /setup/review to commit the new draft.`,
      )
    } catch (err) {
      setErrorMap((p) => ({ ...p, [id]: describeError(err, 'Regenerate failed') }))
    } finally {
      setBusy((p) => ({ ...p, [id]: false }))
    }
  }

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

  const sections = data?.sections ?? []
  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <p className={eyebrowClass}>Brain</p>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Context viewer</h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-1">
              tenant {data.tenant} · {data.live_root}
            </p>
          )}
        </header>

        {regenMessage && (
          <p className="text-sm" data-testid="brain-regen-message">{regenMessage}</p>
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
                        className={bucketBadgeClass(bucket)}
                      >
                        {bucket} · {s.confidence!.toFixed(2)}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {s.files.map((f) => (
                    <pre
                      key={f.canonical}
                      data-testid={`brain-content-${f.canonical}`}
                      className={preBlockClass}
                    >
                      {f.content}
                    </pre>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`brain-regen-${s.id}`}
                    disabled={!!busy[s.id]}
                    onClick={() => handleRegenerate(s.id)}
                  >
                    {busy[s.id] ? 'Regenerating…' : 'Regenerate this section'}
                  </Button>
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
