'use client'

import { useEffect, useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { onboardingDataAtom, onboardingOpenAtom } from '@/atoms/onboarding'
import { cn } from '@/lib/utils'
import type { GTMFramework } from '@/lib/framework/types'

interface Question {
  id: string
  question: string
  field: string
  inputType: 'text' | 'textarea' | 'select' | 'multi-select'
  options?: string[]
}

// Set a value at a dotted/bracket path like "segments[0].painPoints"
function setPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const result = structuredClone(obj)
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let current: Record<string, unknown> = result
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (current[key] === undefined || current[key] === null) {
      current[key] = /^\d+$/.test(keys[i + 1]) ? [] : {}
    }
    current = current[key] as Record<string, unknown>
  }
  current[keys[keys.length - 1]] = value
  return result
}

export function QuestionsStep() {
  const [data, setData] = useAtom(onboardingDataAtom)
  const setOpen = useSetAtom(onboardingOpenAtom)
  const [questions, setQuestions] = useState<Question[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchQuestions() {
      try {
        const res = await fetch('/api/onboarding/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ framework: data.extractedFramework }),
        })
        const json = await res.json()
        if (json.questions?.length > 0) {
          setQuestions(json.questions)
        }
      } catch {
        // If questions fail, allow completing
      } finally {
        setLoading(false)
      }
    }
    fetchQuestions()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const completeOnboarding = async () => {
    setSaving(true)
    setError(null)
    try {
      let framework = data.extractedFramework as Record<string, unknown>
      // Merge follow-up answers into framework using field paths
      if (data.followUpAnswers) {
        for (const [path, value] of Object.entries(data.followUpAnswers)) {
          framework = setPath(framework, path, value)
        }
      }
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ framework }),
      })
      if (!res.ok) throw new Error('Failed to save framework')
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.')
      setSaving(false)
    }
  }

  const handleAnswer = () => {
    if (!answer.trim()) return

    const updatedAnswers = {
      ...data.followUpAnswers,
      [questions[currentIndex].field]: answer.trim(),
    }
    setData({ ...data, followUpAnswers: updatedAnswers })
    setAnswer('')

    if (currentIndex + 1 < questions.length) {
      setCurrentIndex(currentIndex + 1)
    } else {
      completeOnboarding()
    }
  }

  if (loading) {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-2 text-text-primary tracking-[-0.02em]">
          A few more questions...
        </h2>
        <div className="flex items-center gap-3 text-sm mt-8 text-text-muted">
          <span className="animate-pulse text-accent text-[10px]">●</span>
          Generating personalized questions...
        </div>
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-2 text-text-primary tracking-[-0.02em]">
          You&apos;re all set.
        </h2>
        <p className="text-sm leading-relaxed mb-10 text-text-secondary">
          Your GTM context is ready. Every workflow will now be personalized to your business.
        </p>
        {error && (
          <p className="text-sm text-red-500 mb-4">{error}</p>
        )}
        <button
          onClick={completeOnboarding}
          disabled={saving}
          className={cn(
            "w-full py-3.5 rounded-xl text-sm font-bold transition-all duration-150 bg-text-primary text-background",
            saving ? "cursor-wait opacity-70" : "cursor-pointer"
          )}
        >
          {saving ? 'Saving...' : 'Complete Setup'}
        </button>
      </div>
    )
  }

  const current = questions[currentIndex]

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-2xl font-bold text-text-primary tracking-[-0.02em]">
          A few more questions
        </h2>
        <span className="text-sm text-text-muted">
          {currentIndex + 1} of {questions.length}
        </span>
      </div>
      <div className="mb-8 w-full h-0.5 bg-border rounded-full">
        <div
          className="h-full bg-accent rounded-full transition-[width] duration-300"
          style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
        />
      </div>

      <div className="mb-8 fade-in-up" key={currentIndex}>
        <p className="text-base leading-relaxed mb-6 text-text-primary">
          {current.question}
        </p>

        {current.inputType === 'textarea' ? (
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            className="w-full rounded-xl border px-4 py-3.5 text-sm outline-none transition-all duration-200 border-border bg-surface-3 text-text-primary input-focus min-h-[120px] resize-y"
            autoFocus
          />
        ) : current.inputType === 'select' && current.options ? (
          <div className="space-y-2">
            {current.options.map((opt) => (
              <button
                key={opt}
                onClick={() => setAnswer(opt)}
                className={cn(
                  "w-full text-left px-5 py-4 rounded-xl border text-sm transition-all duration-150 text-text-primary",
                  answer === opt
                    ? "border-accent bg-accent-light"
                    : "border-border bg-surface-3"
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <input
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAnswer()
            }}
            className="w-full rounded-xl border px-4 py-3.5 text-sm outline-none transition-all duration-200 border-border bg-surface-3 text-text-primary input-focus"
            autoFocus
          />
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500 mb-4">{error}</p>
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={handleAnswer}
          disabled={!answer.trim()}
          className={cn(
            "flex-1 py-3.5 rounded-xl text-sm font-bold transition-all duration-150",
            answer.trim()
              ? "bg-text-primary text-background cursor-pointer"
              : "bg-surface-2 text-text-muted cursor-not-allowed"
          )}
        >
          {currentIndex + 1 < questions.length ? 'Next' : 'Complete Setup'}
        </button>
        <button
          onClick={completeOnboarding}
          disabled={saving}
          className="text-xs underline cursor-pointer bg-transparent border-none text-text-muted transition-opacity"
        >
          {saving ? 'Saving...' : 'Skip remaining'}
        </button>
      </div>
    </div>
  )
}
