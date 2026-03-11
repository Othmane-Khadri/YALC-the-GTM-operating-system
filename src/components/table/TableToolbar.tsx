'use client'

import { useAtom, useAtomValue } from 'jotai'
import { useCallback } from 'react'
import {
  feedbackFilterAtom,
  tableSearchAtom,
  filteredRowsAtom,
  feedbackStatsAtom,
  selectedRowIdsAtom,
  tableRowsAtom,
  activeTableMetaAtom,
} from '@/atoms/table'
import type { FeedbackFilter } from '@/atoms/table'
import { cn } from '@/lib/utils'

interface TableToolbarProps {
  onBulkFeedback: (rowIds: string[], feedback: 'approved' | 'rejected') => void
}

const FILTERS: { value: FeedbackFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'flagged', label: 'Flagged' },
]

const FILTER_COLORS: Record<FeedbackFilter, string> = {
  all: 'var(--text-primary)',
  pending: 'var(--text-muted)',
  approved: 'var(--success)',
  rejected: 'var(--error)',
  flagged: 'var(--warning)',
}

function escapeCsvField(value: unknown): string {
  const str = value == null ? '' : String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function TableToolbar({ onBulkFeedback }: TableToolbarProps) {
  const [filter, setFilter] = useAtom(feedbackFilterAtom)
  const [search, setSearch] = useAtom(tableSearchAtom)
  const filteredRows = useAtomValue(filteredRowsAtom)
  const stats = useAtomValue(feedbackStatsAtom)
  const [selectedIds, setSelectedIds] = useAtom(selectedRowIdsAtom)
  const allRows = useAtomValue(tableRowsAtom)
  const meta = useAtomValue(activeTableMetaAtom)

  const hasSelection = selectedIds.size > 0

  const handleExportCSV = useCallback(() => {
    const columns = meta?.columns ?? []
    if (columns.length === 0 || filteredRows.length === 0) return

    const header = columns.map(c => escapeCsvField(c.label)).join(',')
    const rows = filteredRows.map(row =>
      columns.map(c => escapeCsvField(row.data[c.key])).join(',')
    )
    const csv = [header, ...rows].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${meta?.name ?? 'export'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [meta, filteredRows])

  return (
    <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-white">
      {/* Filter pills */}
      <div className="flex items-center gap-1">
        {FILTERS.map(f => {
          const count = f.value === 'all' ? stats.total : stats[f.value]
          const isActive = filter === f.value
          return (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-150",
                isActive
                  ? "bg-surface-2"
                  : "hover:bg-surface"
              )}
              style={{ color: isActive ? FILTER_COLORS[f.value] : 'var(--text-muted)' }}
            >
              {f.label}
              <span className="tabular-nums">{count}</span>
            </button>
          )
        })}
      </div>

      {/* Separator */}
      <div className="w-px h-5 bg-border-subtle" />

      {/* Search */}
      <div className="relative flex-1 max-w-[260px]">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" width="13" height="13" viewBox="0 0 13 13" fill="none">
          <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.3"/>
          <path d="M8.5 8.5L11.5 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        <input
          type="text"
          placeholder="Search rows..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs bg-surface border border-border-subtle input-focus"
        />
      </div>

      {/* Bulk actions */}
      {hasSelection && (
        <>
          <div className="w-px h-5 bg-border-subtle" />
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                onBulkFeedback(Array.from(selectedIds), 'approved')
                setSelectedIds(new Set())
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-success bg-success-light hover:bg-success-light/80 transition-colors"
            >
              Approve {selectedIds.size}
            </button>
            <button
              onClick={() => {
                onBulkFeedback(Array.from(selectedIds), 'rejected')
                setSelectedIds(new Set())
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-error bg-error-light hover:bg-error-light/80 transition-colors"
            >
              Reject {selectedIds.size}
            </button>
          </div>
        </>
      )}

      {/* Export CSV */}
      <div className="ml-auto flex items-center gap-3">
        <button
          onClick={handleExportCSV}
          disabled={filteredRows.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-text-muted hover:text-text-secondary hover:bg-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Export filtered rows as CSV"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 8.5v2a1 1 0 001 1h7a1 1 0 001-1v-2M6.5 2v7M6.5 9L4 6.5M6.5 9L9 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Export CSV
        </button>

        {/* Row count */}
        <div className="text-xs text-text-muted tabular-nums">
          {filteredRows.length} of {allRows.length} rows
        </div>
      </div>
    </div>
  )
}
