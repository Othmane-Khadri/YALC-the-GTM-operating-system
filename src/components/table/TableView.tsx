'use client'

import { useEffect, useCallback, useState } from 'react'
import { useSetAtom, useAtomValue, useAtom } from 'jotai'
import {
  activeTableMetaAtom,
  tableRowsAtom,
  tableLoadingAtom,
  focusedRowIndexAtom,
  filteredRowsAtom,
  feedbackStatsAtom,
} from '@/atoms/table'
import type { TableRow, TableMeta } from '@/atoms/table'
import { TableHeader } from './TableHeader'
import { TableToolbar } from './TableToolbar'
import { TableGrid } from './TableGrid'
import { LearningsPanel } from './LearningsPanel'

interface TableViewProps {
  tableId: string
}

interface LearningPattern {
  insight: string
  confidence: 'hypothesis' | 'validated' | 'proven'
  segment?: string
  evidence_count: number
  confirmed: boolean
  edited?: string
}

export function TableView({ tableId }: TableViewProps) {
  const setMeta = useSetAtom(activeTableMetaAtom)
  const setRows = useSetAtom(tableRowsAtom)
  const [loading, setLoading] = useAtom(tableLoadingAtom)
  const [focusedIndex, setFocusedIndex] = useAtom(focusedRowIndexAtom)
  const filteredRows = useAtomValue(filteredRowsAtom)
  const stats = useAtomValue(feedbackStatsAtom)
  const [error, setError] = useState<string | null>(null)

  const [showLearnings, setShowLearnings] = useState(false)
  const [patterns, setPatterns] = useState<LearningPattern[]>([])
  const [isLearning, setIsLearning] = useState(false)

  // Fetch table data
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/tables/${tableId}`)
        if (!res.ok) throw new Error('Failed to load table')
        const data = await res.json()
        setMeta({
          id: data.table.id,
          name: data.table.name,
          workflowId: data.table.workflowId,
          columns: Array.isArray(data.table.columns) ? data.table.columns : [],
          rowCount: data.table.rowCount,
          createdAt: data.table.createdAt,
        } as TableMeta)
        setRows(data.rows as TableRow[])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load table')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [tableId, setMeta, setRows, setLoading])

  // Feedback handler
  const handleFeedback = useCallback(async (rowId: string, feedback: 'approved' | 'rejected' | 'flagged' | null) => {
    // Optimistic update
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, feedback } : r))

    await fetch(`/api/tables/${tableId}/rows/${rowId}/feedback`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    })
  }, [tableId, setRows])

  // Bulk feedback
  const handleBulkFeedback = useCallback(async (rowIds: string[], feedback: 'approved' | 'rejected') => {
    setRows(prev => prev.map(r => rowIds.includes(r.id) ? { ...r, feedback } : r))

    await Promise.all(
      rowIds.map(rowId =>
        fetch(`/api/tables/${tableId}/rows/${rowId}/feedback`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback }),
        })
      )
    )
  }, [tableId, setRows])

  // Done Reviewing → extract learnings
  const handleDoneReviewing = useCallback(async () => {
    setIsLearning(true)
    try {
      const res = await fetch(`/api/tables/${tableId}/learn`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to extract learnings')
      const data = await res.json()
      setPatterns(data.patterns.map((p: Omit<LearningPattern, 'confirmed'>) => ({ ...p, confirmed: true })))
      setShowLearnings(true)
    } catch {
      // Learning extraction failed
    } finally {
      setIsLearning(false)
    }
  }, [tableId])

  // Save learnings
  const handleSaveLearnings = useCallback(async (confirmed: LearningPattern[]) => {
    await fetch(`/api/tables/${tableId}/learn/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patterns: confirmed }),
    })
    setShowLearnings(false)
    setPatterns([])
  }, [tableId])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      const rows = filteredRows
      if (rows.length === 0) return

      if (e.key === 'j') {
        setFocusedIndex(Math.min(focusedIndex + 1, rows.length - 1))
      } else if (e.key === 'k') {
        setFocusedIndex(Math.max(focusedIndex - 1, 0))
      } else if (e.key === 'a' || e.key === 'r' || e.key === 'f') {
        const focused = rows[focusedIndex]
        if (!focused) return
        const feedbackMap = { a: 'approved', r: 'rejected', f: 'flagged' } as const
        const newFeedback = focused.feedback === feedbackMap[e.key] ? null : feedbackMap[e.key]
        handleFeedback(focused.id, newFeedback)
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [filteredRows, focusedIndex, setFocusedIndex, handleFeedback])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted text-sm animate-pulse">Loading table...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 text-sm font-medium mb-2">Failed to load table</p>
          <p className="text-text-muted text-xs">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 bg-white">
      <TableHeader onDoneReviewing={handleDoneReviewing} isLearning={isLearning} />
      <TableToolbar onBulkFeedback={handleBulkFeedback} />
      <TableGrid onFeedback={handleFeedback} />

      {showLearnings && (
        <LearningsPanel
          patterns={patterns}
          stats={stats}
          onSave={handleSaveLearnings}
          onDismiss={() => { setShowLearnings(false); setPatterns([]) }}
          onUpdatePatterns={setPatterns}
        />
      )}
    </div>
  )
}
