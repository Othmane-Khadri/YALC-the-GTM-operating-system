'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface McpServerCardProps {
  server: {
    id: string
    name: string
    transport: string
    status: string
    toolCount: number
    tools: { name: string; description: string }[]
  }
  onReconnect: (id: string) => void
  onRemove: (id: string) => void
}

export function McpServerCard({ server, onReconnect, onRemove }: McpServerCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  const statusColor = server.status === 'connected'
    ? 'var(--matcha-600)'
    : server.status === 'error'
      ? 'var(--pomegranate-600, #dc2626)'
      : 'var(--text-muted)'

  const statusBg = server.status === 'connected'
    ? 'var(--matcha-50)'
    : server.status === 'error'
      ? 'var(--pomegranate-50, #fef2f2)'
      : 'var(--surface-2)'

  async function handleReconnect() {
    setReconnecting(true)
    await onReconnect(server.id)
    setReconnecting(false)
  }

  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden transition-all duration-200">
      <div
        className="flex items-center gap-4 px-6 py-5 cursor-pointer hover:bg-surface/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div
          className="flex items-center justify-center w-10 h-10 rounded-xl"
          style={{ backgroundColor: 'var(--surface-2)' }}
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" style={{ color: statusColor }}>
            <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <div className="flex-1">
          <div className="text-sm font-bold text-text-primary">{server.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="font-bold rounded-md text-[9px] px-2 py-0.5 tracking-wide" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              {server.transport.toUpperCase()}
            </span>
            <span className="text-xs text-text-muted">
              {server.toolCount} tool{server.toolCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <span
          className="font-bold rounded-lg text-[11px] px-2.5 py-[3px]"
          style={{ backgroundColor: statusBg, color: statusColor }}
        >
          {server.status === 'connected' ? 'Connected' : server.status === 'error' ? 'Error' : 'Disconnected'}
        </span>

        <svg
          width="14" height="14" viewBox="0 0 14 14" fill="none"
          className={cn("text-text-muted transition-transform duration-200", expanded && "rotate-180")}
        >
          <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {expanded && (
        <div className="px-6 pb-5 border-t border-border-subtle">
          <div className="pt-4">
            {server.tools.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-bold text-text-muted uppercase tracking-wide mb-2">Discovered Tools</div>
                <div className="space-y-1.5">
                  {server.tools.map(tool => (
                    <div key={tool.name} className="flex items-start gap-2 text-xs">
                      <span className="font-bold text-text-primary mt-0.5 shrink-0">{tool.name}</span>
                      <span className="text-text-muted">{tool.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleReconnect() }}
                disabled={reconnecting}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-border text-text-secondary hover:bg-surface transition-colors"
              >
                {reconnecting ? 'Connecting...' : 'Reconnect'}
              </button>

              {confirmDelete ? (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-text-muted">Remove this server?</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(server.id) }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-[var(--pomegranate-600,#dc2626)] bg-red-50 hover:bg-red-100 transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}
                    className="px-3 py-1.5 rounded-lg text-xs text-text-muted"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
                  className="ml-auto px-3 py-1.5 rounded-lg text-xs text-[var(--pomegranate-600,#dc2626)] hover:bg-red-50 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
