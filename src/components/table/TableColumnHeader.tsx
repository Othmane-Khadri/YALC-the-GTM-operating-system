'use client'

import { useAtom } from 'jotai'
import { tableSortAtom } from '@/atoms/table'
import { cn } from '@/lib/utils'
import { getColumnTypeWidth } from '@/lib/execution/columns'
import type { ColumnDef } from '@/lib/ai/types'

interface TableColumnHeaderProps {
  column: ColumnDef
}

export function TableColumnHeader({ column }: TableColumnHeaderProps) {
  const [sort, setSort] = useAtom(tableSortAtom)

  const isActive = sort?.key === column.key
  const dir = isActive ? sort.dir : null

  const handleClick = () => {
    if (!isActive) {
      setSort({ key: column.key, dir: 'asc' })
    } else if (dir === 'asc') {
      setSort({ key: column.key, dir: 'desc' })
    } else {
      setSort(null)
    }
  }

  return (
    <th
      className={cn(
        "text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted px-3 py-3 cursor-pointer select-none hover:text-text-secondary transition-colors",
        getColumnTypeWidth(column.type),
        column.type === 'number' && "text-right",
      )}
      onClick={handleClick}
    >
      <div className={cn(
        "flex items-center gap-1",
        column.type === 'number' && "justify-end"
      )}>
        <span>{column.label}</span>
        <span className="text-[10px]">
          {isActive ? (dir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </div>
    </th>
  )
}
