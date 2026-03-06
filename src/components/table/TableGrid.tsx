'use client'

import { useAtomValue } from 'jotai'
import { activeTableMetaAtom, filteredRowsAtom } from '@/atoms/table'
import { TableColumnHeader } from './TableColumnHeader'
import { TableRowComponent } from './TableRow'

interface TableGridProps {
  onFeedback: (rowId: string, feedback: 'approved' | 'rejected' | 'flagged' | null) => void
}

export function TableGrid({ onFeedback }: TableGridProps) {
  const meta = useAtomValue(activeTableMetaAtom)
  const rows = useAtomValue(filteredRowsAtom)

  if (!meta) return null

  return (
    <div className="flex-1 overflow-x-auto overflow-y-auto">
      <table className="w-full border-collapse min-w-max">
        <thead className="sticky top-0 z-10 bg-surface border-b border-border">
          <tr>
            {/* Checkbox header */}
            <th className="px-3 py-3 w-10" />
            {/* Row index header */}
            <th className="px-2 py-3 w-10 text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted text-left">
              #
            </th>
            {/* Column headers */}
            {meta.columns.map((col) => (
              <TableColumnHeader key={col.key} column={col} />
            ))}
            {/* Feedback header — sticky right */}
            <th className="px-3 py-3 sticky right-0 bg-surface border-l border-border-subtle text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted text-left min-w-[100px]">
              Review
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TableRowComponent
              key={row.id}
              row={row}
              columns={meta.columns}
              onFeedback={onFeedback}
            />
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={meta.columns.length + 3}
                className="text-center py-12 text-text-muted text-sm"
              >
                No rows match your filters
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
