'use client'

import { useState, useEffect } from 'react'
import { McpServerCard } from './McpServerCard'
import { AddServerForm } from './AddServerForm'
import McpServerSettings from './McpServerSettings'

interface ServerData {
  id: string
  name: string
  transport: string
  status: string
  toolCount: number
  tools: { name: string; description: string }[]
}

export function McpsView() {
  const [servers, setServers] = useState<ServerData[]>([])
  const [loading, setLoading] = useState(true)

  async function fetchServers() {
    try {
      const res = await fetch('/api/mcps')
      const data = await res.json()
      setServers(data.servers || [])
    } catch {
      // Failed to fetch
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchServers()
  }, [])

  async function handleReconnect(id: string) {
    await fetch(`/api/mcps/${id}/connect`, { method: 'POST' })
    await fetchServers()
  }

  async function handleRemove(id: string) {
    await fetch(`/api/mcps/${id}`, { method: 'DELETE' })
    await fetchServers()
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
        <h1 className="text-xl font-bold font-display text-text-primary mb-1">MCP Servers</h1>
        <p className="text-sm text-text-secondary mb-8">
          Connect external tools and data sources via the Model Context Protocol.
        </p>

        {servers.length > 0 ? (
          <div className="grid gap-4 mb-8">
            {servers.map(server => (
              <McpServerCard
                key={server.id}
                server={server}
                onReconnect={handleReconnect}
                onRemove={handleRemove}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-border bg-white p-8 text-center mb-8">
            <div className="text-sm text-text-secondary max-w-md mx-auto">
              MCP (Model Context Protocol) lets GTM-OS connect to external tools and data sources.
              Add an MCP server to unlock new providers for your workflows.
            </div>
          </div>
        )}

        <AddServerForm onAdded={fetchServers} />

        <div className="mt-12">
          <McpServerSettings />
        </div>
      </div>
    </div>
  )
}
