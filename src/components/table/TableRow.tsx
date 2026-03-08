'use client'

import { useAtom, useAtomValue } from 'jotai'
import { selectedRowIdsAtom, focusedRowIndexAtom } from '@/atoms/table'
import type { TableRow as TableRowType } from '@/atoms/table'
import type { ColumnDef } from '@/lib/ai/types'
import { TableCell } from './TableCell'
import { FeedbackActions } from './FeedbackActions'
import { cn } from '@/lib/utils'

interface TableRowProps {
  row: TableRowType
  columns: ColumnDef[]
  onFeedback: (rowId: string, feedback: 'approved' | 'rejected' | 'flagged' | null) => void
}

export function TableRowComponent({ row, columns, onFeedback }: TableRowProps) {
  const [selectedIds, setSelectedIds] = useAtom(selectedRowIdsAtom)
  const focusedIndex = useAtomValue(focusedRowIndexAtom)

  const isSelected = selectedIds.has(row.id)
  const isFocused = focusedIndex === row.rowIndex

  const toggleSelect = () => {
    const next = new Set(selectedIds)
    if (isSelected) {
      next.delete(row.id)
    } else {
      next.add(row.id)
    }
    setSelectedIds(next)
  }

  return (
    <tr
      className={cn(
        "group transition-all duration-150 border-b border-border-subtle",
        row.feedback === 'approved' && "border-l-[3px] border-l-success",
        row.feedback === 'rejected' && "border-l-[3px] border-l-error opacity-60",
        row.feedback === 'flagged' && "border-l-[3px] border-l-warning",
        !row.feedback && "border-l-[3px] border-l-transparent",
        isSelected && "bg-accent-light",
        !isSelected && "hover:bg-surface",
        isFocused && "ring-2 ring-inset ring-accent",
      )}
    >
      {/* Checkbox */}
      <td className="px-3 py-2.5 w-10">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={toggleSelect}
          className="w-3.5 h-3.5 rounded border-border accent-accent"
        />
      </td>

      {/* Row index */}
      <td className="px-2 py-2.5 w-10 text-xs text-text-muted tabular-nums">
        {row.rowIndex + 1}
      </td>

      {/* Data cells */}
      {columns.map((col) => (
        <td key={col.key} className="px-3 py-2.5 text-sm">
          <TableCell value={row.data[col.key]} type={col.type} />
        </td>
      ))}

      {/* Feedback actions — sticky right */}
      <td className="px-3 py-2.5 sticky right-0 bg-white group-hover:bg-surface border-l border-border-subtle"
        style={isSelected ? { backgroundColor: 'var(--accent-light)' } : undefined}
      >
        <FeedbackActions
          feedback={row.feedback}
          onFeedback={(val) => onFeedback(row.id, val)}
        />
      </td>
    </tr>
  )
}
