'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface FeedbackStats {
  total: number
  approved: number
  rejected: number
  flagged: number
  pending: number
}

interface TableSummary {
  id: string
  name: string
  rowCount: number
  createdAt: string
  feedbackStats: FeedbackStats
}

export function TablesListView() {
  const [tables, setTables] = useState<TableSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/tables')
      .then(r => r.json())
      .then(data => setTables(data.tables ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted text-sm animate-pulse">Loading tables...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-8" style={{ backgroundColor: 'var(--background)' }}>
      <div className="max-w-5xl mx-auto">
        <h1 className="text-xl font-bold font-display text-text-primary mb-1">Tables</h1>
        <p className="text-sm text-text-secondary mb-8">
          Result tables from your workflow executions. Review, filter, and export your leads.
        </p>

        {tables.length === 0 ? (
          <div className="rounded-3xl border border-border bg-white p-8 text-center shadow-card">
            <div className="text-sm text-text-secondary max-w-md mx-auto">
              No tables yet. Start a chat and run a workflow to create your first result table.
            </div>
            <Link
              href="/chat"
              className="inline-block mt-4 px-5 py-2.5 rounded-xl text-sm font-bold bg-text-primary text-background hover:bg-text-secondary transition-all duration-150"
            >
              Go to Chat
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tables.map(table => {
              const { feedbackStats: stats } = table
              const total = stats.total || 1
              const approvedPct = (stats.approved / total) * 100
              const rejectedPct = (stats.rejected / total) * 100
              const flaggedPct = (stats.flagged / total) * 100

              return (
                <Link
                  key={table.id}
                  href={`/tables/${table.id}`}
                  className="group rounded-3xl border border-border bg-white p-6 transition-all duration-200 shadow-card hover:shadow-card-hover"
                >
                  <h3 className="text-sm font-bold font-display text-text-primary group-hover:text-accent transition-colors truncate">
                    {table.name}
                  </h3>

                  <div className="flex items-center gap-2 mt-2">
                    <span className="font-bold rounded-lg bg-surface-2 text-text-muted text-[11px] px-2.5 py-[3px] tabular-nums">
                      {table.rowCount} rows
                    </span>
                    <span className="text-[11px] text-text-muted">
                      {new Date(table.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Feedback progress bar */}
                  <div className="mt-4">
                    <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden flex">
                      {approvedPct > 0 && (
                        <div
                          className="h-full transition-all duration-300"
                          style={{ width: `${approvedPct}%`, backgroundColor: 'var(--success)' }}
                        />
                      )}
                      {rejectedPct > 0 && (
                        <div
                          className="h-full transition-all duration-300"
                          style={{ width: `${rejectedPct}%`, backgroundColor: 'var(--error)' }}
                        />
                      )}
                      {flaggedPct > 0 && (
                        <div
                          className="h-full transition-all duration-300"
                          style={{ width: `${flaggedPct}%`, backgroundColor: 'var(--warning)' }}
                        />
                      )}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-text-muted tabular-nums">
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--success)' }} />
                      {stats.approved}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--error)' }} />
                      {stats.rejected}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--warning)' }} />
                      {stats.flagged}
                    </span>
                    {stats.pending > 0 && (
                      <span className="ml-auto text-text-muted">
                        {stats.pending} pending
                      </span>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
