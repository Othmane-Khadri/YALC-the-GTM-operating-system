'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { FrameworkEditor } from '@/components/onboarding/components/FrameworkEditor'
import type { GTMFramework } from '@/lib/framework/types'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function SettingsView() {
  const router = useRouter()
  const [framework, setFramework] = useState<Partial<GTMFramework> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    fetch('/api/framework')
      .then(r => r.json())
      .then(data => {
        setFramework(data.framework || {})
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleSave = useCallback(async () => {
    if (!framework) return
    setSaveState('saving')
    try {
      const res = await fetch('/api/framework', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ framework }),
      })
      if (!res.ok) throw new Error()
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2000)
    } catch {
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 3000)
    }
  }, [framework])

  const handleReset = useCallback(async () => {
    setResetting(true)
    try {
      const res = await fetch('/api/framework/reset', { method: 'POST' })
      if (!res.ok) throw new Error()
      router.push('/chat')
    } catch {
      setResetting(false)
      setShowResetConfirm(false)
    }
  }, [router])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-text-muted border-t-text-primary rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold font-display text-text-primary mb-1">Settings</h1>
        <p className="text-sm text-text-secondary mb-8">
          Edit your company positioning or restart the onboarding flow.
        </p>

        {/* Company & Positioning */}
        <div className="rounded-3xl border border-border bg-white p-8 mb-6">
          <h2 className="text-base font-bold text-text-primary mb-1">Company & Positioning</h2>
          <p className="text-xs text-text-muted mb-5">
            This is what the AI uses to understand your business. Edit any field below.
          </p>

          {framework && (
            <FrameworkEditor
              framework={framework}
              onChange={setFramework}
            />
          )}

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saveState === 'saving'}
              className="px-6 py-3 rounded-xl text-sm font-bold transition-all duration-150 cursor-pointer disabled:opacity-50 bg-text-primary text-background"
            >
              {saveState === 'saving' ? 'Saving...' : 'Save Changes'}
            </button>
            {saveState === 'saved' && (
              <span className="text-sm font-medium text-success">Saved</span>
            )}
            {saveState === 'error' && (
              <span className="text-sm font-medium text-error">Failed to save</span>
            )}
          </div>
        </div>

        {/* Redo Onboarding */}
        <div className="rounded-3xl border border-border bg-white p-8">
          <h2 className="text-base font-bold text-text-primary mb-1">Onboarding</h2>
          <p className="text-xs text-text-muted mb-5">
            Restart the AI-powered onboarding to re-extract your positioning from scratch.
          </p>

          {!showResetConfirm ? (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="px-6 py-3 rounded-xl text-sm font-bold transition-all duration-150 cursor-pointer border border-border text-text-secondary hover:border-error hover:text-error"
            >
              Redo Onboarding
            </button>
          ) : (
            <div className="rounded-xl border border-warning bg-warning-light p-4">
              <p className="text-sm text-text-primary mb-3">
                This will erase your current positioning and restart the onboarding. Continue?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleReset}
                  disabled={resetting}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-150 cursor-pointer disabled:opacity-50 bg-error text-white"
                >
                  {resetting ? 'Resetting...' : 'Yes, restart'}
                </button>
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-150 cursor-pointer text-text-secondary hover:bg-surface"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
