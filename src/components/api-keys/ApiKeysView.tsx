'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface ProviderConfig {
  id: string
  name: string
  icon: JSX.Element
  description: string
}

interface ConnectionStatus {
  provider: string
  status: 'active' | 'invalid' | 'expired'
  lastTestedAt: string | null
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'apollo',
    name: 'Apollo.io',
    description: 'Contact & company enrichment',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description: 'Website scraping & tech stack detection',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 3c0 3-4 5-4 8a4 4 0 108 0c0-3-4-5-4-8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'hunter',
    name: 'Hunter.io',
    description: 'Email discovery & verification',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M3 7l7 4 7-4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'clearbit',
    name: 'Clearbit',
    description: 'Company intelligence & firmographics',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="4" y="4" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M8 10h4M10 8v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'builtwith',
    name: 'BuiltWith',
    description: 'Technology detection & analytics',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M4 16V8l6-5 6 5v8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <rect x="8" y="11" width="4" height="5" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Alternative AI provider',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 10c0-1.7 1.3-3 3-3s3 1.3 3 3-1.3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
]

const STATUS_STYLES = {
  active: { bg: 'var(--matcha-50)', color: 'var(--matcha-600)', label: 'Connected' },
  invalid: { bg: 'var(--pomegranate-50, #fef2f2)', color: 'var(--pomegranate-600)', label: 'Invalid' },
  expired: { bg: 'var(--pomegranate-50, #fef2f2)', color: 'var(--pomegranate-600)', label: 'Expired' },
  none: { bg: 'var(--surface-2)', color: 'var(--text-muted)', label: 'Not Connected' },
}

export function ApiKeysView() {
  const [connections, setConnections] = useState<ConnectionStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    fetchConnections()
  }, [])

  async function fetchConnections() {
    try {
      const res = await fetch('/api/api-keys')
      const data = await res.json()
      setConnections(data.connections || [])
    } catch {
      // Failed to load
    } finally {
      setLoading(false)
    }
  }

  function getStatus(providerId: string): 'active' | 'invalid' | 'expired' | 'none' {
    const conn = connections.find(c => c.provider === providerId)
    return conn ? (conn.status as 'active' | 'invalid' | 'expired') : 'none'
  }

  async function handleSave(providerId: string) {
    if (!keyInput.trim()) return
    setSaving(true)
    try {
      await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, key: keyInput }),
      })
      setKeyInput('')
      setExpandedProvider(null)
      await fetchConnections()
    } finally {
      setSaving(false)
    }
  }

  async function handleTest(providerId: string) {
    setTesting(providerId)
    try {
      await fetch(`/api/api-keys/${providerId}`, { method: 'POST' })
      await fetchConnections()
    } finally {
      setTesting(null)
    }
  }

  async function handleDelete(providerId: string) {
    await fetch(`/api/api-keys/${providerId}`, { method: 'DELETE' })
    setConfirmDelete(null)
    await fetchConnections()
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted text-sm animate-pulse">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-8" style={{ backgroundColor: 'var(--background)' }}>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-bold text-text-primary mb-1">API Keys</h1>
        <p className="text-sm text-text-secondary mb-8">
          Connect your data providers. Keys are encrypted with AES-256-GCM.
        </p>

        <div className="grid gap-4">
          {PROVIDERS.map((provider) => {
            const status = getStatus(provider.id)
            const style = STATUS_STYLES[status]
            const isExpanded = expandedProvider === provider.id
            const isConfirmingDelete = confirmDelete === provider.id

            return (
              <div
                key={provider.id}
                className="rounded-2xl border border-border bg-white overflow-hidden transition-all duration-200"
              >
                {/* Provider card header */}
                <div
                  className="flex items-center gap-4 px-6 py-5 cursor-pointer hover:bg-surface/50 transition-colors"
                  onClick={() => {
                    setExpandedProvider(isExpanded ? null : provider.id)
                    setKeyInput('')
                    setConfirmDelete(null)
                  }}
                >
                  <div
                    className="flex items-center justify-center w-10 h-10 rounded-xl"
                    style={{ backgroundColor: status === 'active' ? 'var(--matcha-50)' : 'var(--surface-2)', color: status === 'active' ? 'var(--matcha-600)' : 'var(--text-muted)' }}
                  >
                    {provider.icon}
                  </div>

                  <div className="flex-1">
                    <div className="text-sm font-bold text-text-primary">{provider.name}</div>
                    <div className="text-xs text-text-muted mt-0.5">{provider.description}</div>
                  </div>

                  <span
                    className="font-bold rounded-lg text-[11px] px-2.5 py-[3px]"
                    style={{ backgroundColor: style.bg, color: style.color }}
                  >
                    {style.label}
                  </span>

                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    className={cn(
                      "text-text-muted transition-transform duration-200",
                      isExpanded && "rotate-180"
                    )}
                  >
                    <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>

                {/* Expanded form */}
                {isExpanded && (
                  <div className="px-6 pb-5 border-t border-border-subtle">
                    <div className="pt-4 space-y-3">
                      <div>
                        <label className="text-xs font-bold text-text-muted uppercase tracking-wide block mb-1.5">
                          API Key
                        </label>
                        <input
                          type="password"
                          value={keyInput}
                          onChange={e => setKeyInput(e.target.value)}
                          placeholder={status === 'active' ? '••••••••••• (key stored)' : 'Enter your API key'}
                          className="w-full px-4 py-2.5 rounded-xl text-sm border border-border bg-surface-3 input-focus"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSave(provider.id)}
                          disabled={!keyInput.trim() || saving}
                          className={cn(
                            "px-4 py-2 rounded-xl text-xs font-bold transition-all duration-150",
                            keyInput.trim()
                              ? "bg-text-primary text-background hover:bg-text-secondary"
                              : "bg-surface-2 text-text-muted cursor-not-allowed"
                          )}
                        >
                          {saving ? 'Saving...' : 'Save Key'}
                        </button>

                        {status !== 'none' && (
                          <>
                            <button
                              onClick={() => handleTest(provider.id)}
                              disabled={testing === provider.id}
                              className="px-4 py-2 rounded-xl text-xs font-bold border border-border text-text-secondary hover:bg-surface transition-colors"
                            >
                              {testing === provider.id ? 'Testing...' : 'Test Connection'}
                            </button>

                            {isConfirmingDelete ? (
                              <div className="flex items-center gap-2 ml-auto">
                                <span className="text-xs text-text-muted">Remove this key?</span>
                                <button
                                  onClick={() => handleDelete(provider.id)}
                                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-pomegranate-600 bg-red-50 hover:bg-red-100 transition-colors"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setConfirmDelete(null)}
                                  className="px-3 py-1.5 rounded-lg text-xs text-text-muted"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDelete(provider.id)}
                                className="ml-auto px-3 py-1.5 rounded-lg text-xs text-pomegranate-600 hover:bg-red-50 transition-colors"
                              >
                                Remove
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
