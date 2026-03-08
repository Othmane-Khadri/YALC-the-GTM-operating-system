'use client'

import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { onboardingDataAtom, onboardingStepAtom } from '@/atoms/onboarding'
import { cn } from '@/lib/utils'

export function ProcessingStep() {
  const [data, setData] = useAtom(onboardingDataAtom)
  const [, setStep] = useAtom(onboardingStepAtom)
  const [statuses, setStatuses] = useState<Array<{ message: string; done: boolean }>>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function extract() {
      try {
        const response = await fetch('/api/onboarding/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            websiteUrl: data.websiteUrl,
            linkedinUrl: data.linkedinUrl || undefined,
            documents: data.uploadedFiles.length > 0 ? data.uploadedFiles : undefined,
          }),
        })

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response stream')

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6))
              if (cancelled) return

              if (event.type === 'status') {
                setStatuses((prev) => {
                  const updated = prev.map((s) => ({ ...s, done: true }))
                  return [...updated, { message: event.message, done: false }]
                })
              } else if (event.type === 'framework') {
                setData((prev) => ({ ...prev, extractedFramework: event.data }))
              } else if (event.type === 'done') {
                setStatuses((prev) => prev.map((s) => ({ ...s, done: true })))
                setTimeout(() => {
                  if (!cancelled) setStep(3)
                }, 800)
              } else if (event.type === 'error') {
                setError(event.message)
              }
            } catch {
              // Skip malformed lines
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Extraction failed')
        }
      }
    }

    extract()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2 text-text-primary tracking-[-0.02em]">
        Building your GTM context...
      </h2>
      <p className="text-sm leading-relaxed mb-10 text-text-secondary">
        This usually takes 15-30 seconds.
      </p>

      <div className="space-y-4">
        {statuses.map((status, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-3 text-sm fade-in-up",
              status.done ? "text-success" : "text-text-primary"
            )}
            style={{ animationDelay: `${i * 0.15}s`, animationFillMode: 'backwards' }}
          >
            {status.done ? (
              <span className="text-base leading-none">✓</span>
            ) : (
              <span className="animate-pulse text-accent text-[10px]">●</span>
            )}
            <span style={{ fontWeight: status.done ? 400 : 500 }}>{status.message}</span>
          </div>
        ))}

        {statuses.length === 0 && !error && (
          <div className="flex items-center gap-3 text-sm text-text-muted">
            <span className="animate-pulse text-accent text-[10px]">●</span>
            Starting extraction...
          </div>
        )}
      </div>

      {error && (
        <div className="mt-8 p-5 rounded-3xl bg-error/[0.08] border border-error/[0.15]">
          <div className="text-sm font-bold mb-1 text-error">Something went wrong</div>
          <div className="text-xs text-text-secondary">{error}</div>
          <button
            onClick={() => setStep(3)}
            className="mt-3 text-xs underline transition-opacity text-text-muted"
          >
            Continue anyway with empty framework
          </button>
        </div>
      )}
    </div>
  )
}
