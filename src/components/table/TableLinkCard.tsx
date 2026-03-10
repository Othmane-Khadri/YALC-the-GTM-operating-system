'use client'

import type { ColumnDef } from '@/lib/ai/types'

interface TableLinkCardProps {
  resultSetId: string
  tableName: string
  rowCount: number
  columns: ColumnDef[]
  previewRows?: Array<Record<string, unknown>>
  usedMock?: boolean
  warnings?: string[]
}

export function TableLinkCard({ resultSetId, tableName, rowCount, columns: rawColumns, previewRows, usedMock, warnings }: TableLinkCardProps) {
  // Defensive: ensure columns is always an array of ColumnDef objects
  const columns = Array.isArray(rawColumns) ? rawColumns.filter(c => c && typeof c.key === 'string') : []

  return (
    <div className="rounded-3xl border overflow-hidden mt-3 animate-slide-up bg-white border-border max-w-2xl shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      {/* Mock data warning */}
      {usedMock && (
        <div className="px-6 py-3 flex items-center gap-2 text-xs font-bold" style={{ backgroundColor: 'var(--warning-light)', color: 'var(--warning-dark)' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1L13 12H1L7 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <path d="M7 5.5V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="7" cy="10" r="0.5" fill="currentColor"/>
          </svg>
          Contains simulated data — a provider fell back to mock results
        </div>
      )}
      {/* Header */}
      <div className="px-6 pt-5 pb-4">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-success">
            <rect x="2" y="2" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <rect x="10" y="2" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <rect x="2" y="10" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.5"/>
            <rect x="10" y="10" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          <h3 className="text-sm font-bold text-text-primary">{String(tableName ?? 'Results')}</h3>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <span className="font-bold rounded-lg bg-surface-2 text-text-muted text-[11px] px-2.5 py-[3px] tabular-nums">
            {rowCount} rows
          </span>
          <span className="font-bold rounded-lg bg-surface-2 text-text-muted text-[11px] px-2.5 py-[3px] tabular-nums">
            {columns.length} columns
          </span>
        </div>
      </div>

      {/* Mini preview */}
      {previewRows && previewRows.length > 0 && (
        <div className="px-6 pb-3">
          <div className="rounded-lg border border-border-subtle overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-surface">
                  {columns.slice(0, 4).map(col => (
                    <th key={col.key} className="text-left px-2.5 py-1.5 font-bold text-text-muted uppercase tracking-wide">
                      {String(col.label ?? col.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 3).map((row, i) => (
                  <tr key={i} className="border-t border-border-subtle">
                    {columns.slice(0, 4).map(col => (
                      <td key={col.key} className="px-2.5 py-1.5 truncate max-w-[120px] text-text-secondary">
                        {String(row[col.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Action */}
      <div className="px-6 py-3 border-t border-border bg-surface">
        <a
          href={`/tables/${resultSetId}`}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-text-primary text-background hover:bg-text-secondary transition-all duration-150"
        >
          View Table
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
      </div>
    </div>
  )
}
