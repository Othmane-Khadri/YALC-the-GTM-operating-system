import { atom } from 'jotai'
import type { ColumnDef } from '@/lib/ai/types'

// ─── Table Metadata ──────────────────────────────────────────────────────────

export interface TableMeta {
  id: string
  name: string
  workflowId: string
  columns: ColumnDef[]
  rowCount: number
  createdAt: string
}

export interface TableRow {
  id: string
  rowIndex: number
  data: Record<string, unknown>
  feedback: 'approved' | 'rejected' | 'flagged' | null
  tags: string[]
  annotation: string | null
}

export type FeedbackFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'flagged'

export const activeTableMetaAtom = atom<TableMeta | null>(null)
export const tableRowsAtom = atom<TableRow[]>([])
export const tableLoadingAtom = atom<boolean>(false)
export const feedbackFilterAtom = atom<FeedbackFilter>('all')
export const tableSearchAtom = atom<string>('')
export const tableSortAtom = atom<{ key: string; dir: 'asc' | 'desc' } | null>(null)
export const selectedRowIdsAtom = atom<Set<string>>(new Set<string>())
export const focusedRowIndexAtom = atom<number>(0)

// ─── Derived Atoms ───────────────────────────────────────────────────────────

export const feedbackStatsAtom = atom((get) => {
  const rows = get(tableRowsAtom)
  return {
    total: rows.length,
    approved: rows.filter(r => r.feedback === 'approved').length,
    rejected: rows.filter(r => r.feedback === 'rejected').length,
    flagged: rows.filter(r => r.feedback === 'flagged').length,
    pending: rows.filter(r => r.feedback === null).length,
  }
})

export const filteredRowsAtom = atom((get) => {
  const rows = get(tableRowsAtom)
  const filter = get(feedbackFilterAtom)
  const search = get(tableSearchAtom).toLowerCase()
  const sort = get(tableSortAtom)

  let filtered = rows

  // Apply feedback filter
  if (filter === 'pending') {
    filtered = filtered.filter(r => r.feedback === null)
  } else if (filter !== 'all') {
    filtered = filtered.filter(r => r.feedback === filter)
  }

  // Apply text search
  if (search) {
    filtered = filtered.filter(r =>
      Object.values(r.data).some(v =>
        String(v).toLowerCase().includes(search)
      )
    )
  }

  // Apply sort
  if (sort) {
    filtered = [...filtered].sort((a, b) => {
      const aVal = a.data[sort.key]
      const bVal = b.data[sort.key]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sort.dir === 'asc' ? aVal - bVal : bVal - aVal
      }
      const cmp = String(aVal).localeCompare(String(bVal))
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }

  return filtered
})

export const allSelectedAtom = atom((get) => {
  const filtered = get(filteredRowsAtom)
  const selected = get(selectedRowIdsAtom)
  return filtered.length > 0 && filtered.every(r => selected.has(r.id))
})
