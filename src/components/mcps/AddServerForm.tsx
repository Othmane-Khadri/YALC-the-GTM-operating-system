'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface AddServerFormProps {
  onAdded: () => void
}

export function AddServerForm({ onAdded }: AddServerFormProps) {
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'sse'>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)

  const isValid = name.trim() && (
    (transport === 'stdio' && command.trim()) ||
    (transport === 'sse' && url.trim())
  )

  async function handleSubmit() {
    if (!isValid) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = { name, transport }
      if (transport === 'stdio') {
        body.command = command
        body.args = args.split(',').map(a => a.trim()).filter(Boolean)
      } else {
        body.url = url
      }

      await fetch('/api/mcps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      setName('')
      setCommand('')
      setArgs('')
      setUrl('')
      onAdded()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-white p-6">
      <h2 className="text-sm font-bold text-text-primary mb-4">Add MCP Server</h2>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-bold text-text-muted uppercase tracking-wide block mb-1.5">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Filesystem, Search API"
            className="w-full px-4 py-2.5 rounded-xl text-sm border border-border bg-surface-3 input-focus"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-text-muted uppercase tracking-wide block mb-1.5">Transport</label>
          <div className="flex gap-2">
            {(['stdio', 'sse'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTransport(t)}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-bold border transition-colors",
                  transport === t
                    ? "border-text-primary bg-text-primary text-background"
                    : "border-border text-text-secondary hover:bg-surface"
                )}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {transport === 'stdio' ? (
          <>
            <div>
              <label className="text-xs font-bold text-text-muted uppercase tracking-wide block mb-1.5">Command</label>
              <input
                type="text"
                value={command}
                onChange={e => setCommand(e.target.value)}
                placeholder="e.g. npx"
                className="w-full px-4 py-2.5 rounded-xl text-sm border border-border bg-surface-3 input-focus"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-text-muted uppercase tracking-wide block mb-1.5">
                Args <span className="font-normal">(comma-separated)</span>
              </label>
              <input
                type="text"
                value={args}
                onChange={e => setArgs(e.target.value)}
                placeholder="e.g. @modelcontextprotocol/server-filesystem, /tmp"
                className="w-full px-4 py-2.5 rounded-xl text-sm border border-border bg-surface-3 input-focus"
              />
            </div>
          </>
        ) : (
          <div>
            <label className="text-xs font-bold text-text-muted uppercase tracking-wide block mb-1.5">URL</label>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="e.g. http://localhost:3001/mcp"
              className="w-full px-4 py-2.5 rounded-xl text-sm border border-border bg-surface-3 input-focus"
            />
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!isValid || saving}
          className={cn(
            "px-6 py-2.5 rounded-xl text-xs font-bold transition-all duration-150",
            isValid
              ? "bg-text-primary text-background hover:bg-text-secondary"
              : "bg-surface-2 text-text-muted cursor-not-allowed"
          )}
        >
          {saving ? 'Adding...' : 'Add Server'}
        </button>
      </div>
    </div>
  )
}
