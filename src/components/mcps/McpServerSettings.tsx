'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

const TOOLS = [
  { id: 'search_leads', label: 'search_leads' },
  { id: 'get_framework', label: 'get_framework' },
  { id: 'get_learnings', label: 'get_learnings' },
  { id: 'qualify_lead', label: 'qualify_lead' },
  { id: 'get_available_providers', label: 'get_available_providers' },
]

export default function McpServerSettings() {
  const [enabled, setEnabled] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const connectionUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/mcp-server`
    : ''

  const handleToggle = () => {
    if (!enabled) {
      const newToken = crypto.randomUUID()
      setToken(newToken)
      setEnabled(true)
    } else {
      setEnabled(false)
      setToken(null)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-2xl border border-border bg-white p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-text-primary">GTM-OS as MCP Server</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Allow external AI agents to access your GTM-OS data and capabilities.
          </p>
        </div>
        <button
          onClick={handleToggle}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
            enabled ? 'bg-[var(--matcha-600)]' : 'bg-[var(--surface-2)]'
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
              enabled ? 'translate-x-6' : 'translate-x-1'
            )}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-4 pt-4 mt-4 border-t border-border-subtle">
          <div>
            <label className="text-xs font-bold text-text-muted uppercase tracking-wide block mb-1.5">Connection URL</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-[var(--surface-2)] rounded-xl text-xs truncate">
                {connectionUrl}
              </code>
              <button
                onClick={() => copyToClipboard(connectionUrl)}
                className="px-3 py-2 text-xs font-bold border border-border rounded-xl hover:bg-surface transition-colors"
              >
                Copy
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-text-muted uppercase tracking-wide block mb-1.5">Auth Token</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-[var(--surface-2)] rounded-xl text-xs truncate">
                {token ? `${token.slice(0, 8)}...${token.slice(-4)}` : '---'}
              </code>
              <button
                onClick={() => token && copyToClipboard(token)}
                className="px-3 py-2 text-xs font-bold border border-border rounded-xl hover:bg-surface transition-colors"
              >
                {copied ? 'Copied' : 'Copy Token'}
              </button>
            </div>
            <p className="text-[10px] text-text-muted mt-1">
              Set MCP_SERVER_TOKEN in .env.local to match this token.
            </p>
          </div>

          <div>
            <label className="text-xs font-bold text-text-muted uppercase tracking-wide block mb-1.5">Exposed Tools</label>
            <div className="space-y-1.5 mt-1">
              {TOOLS.map(tool => (
                <div key={tool.id} className="flex items-center gap-2 text-xs">
                  <div className="w-2 h-2 rounded-full bg-[var(--matcha-600)]" />
                  <code className="text-text-primary">{tool.label}</code>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-full bg-[var(--matcha-600)]" />
            <span className="text-text-muted">Server active</span>
          </div>
        </div>
      )}
    </div>
  )
}
