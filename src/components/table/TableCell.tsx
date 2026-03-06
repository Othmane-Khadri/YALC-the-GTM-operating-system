'use client'

import type { ColumnType } from '@/lib/ai/types'
import { cn } from '@/lib/utils'

interface TableCellProps {
  value: unknown
  type: ColumnType
}

const BADGE_COLORS = [
  { bg: 'var(--blueberry-50)', color: 'var(--blueberry-800)' },
  { bg: 'var(--matcha-50)', color: 'var(--matcha-600)' },
  { bg: 'var(--tangerine-50)', color: 'var(--tangerine-700)' },
  { bg: 'var(--dragonfruit-50)', color: 'var(--dragonfruit-600)' },
  { bg: 'var(--lemon-50)', color: 'var(--lemon-600)' },
]

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return url
  }
}

export function TableCell({ value, type }: TableCellProps) {
  if (value == null || value === '') {
    return <span className="text-text-muted text-xs">—</span>
  }

  const strValue = String(value)

  switch (type) {
    case 'text':
      return (
        <span className="truncate block max-w-[280px]" title={strValue}>
          {strValue}
        </span>
      )

    case 'number':
      return (
        <span className="text-right block tabular-nums">
          {typeof value === 'number' ? value.toLocaleString() : strValue}
        </span>
      )

    case 'url':
      return (
        <a
          href={strValue}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-blueberry-600 hover:underline truncate max-w-[200px]"
        >
          <span className="truncate">{extractDomain(strValue)}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="flex-shrink-0">
            <path d="M3 1h6v6M9 1L4 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
      )

    case 'badge': {
      const colorIndex = hashString(strValue) % BADGE_COLORS.length
      const badge = BADGE_COLORS[colorIndex]
      return (
        <span
          className="inline-block font-bold rounded-md text-[10px] px-2 py-[2px] tracking-wide truncate max-w-[150px]"
          style={{ backgroundColor: badge.bg, color: badge.color }}
          title={strValue}
        >
          {strValue}
        </span>
      )
    }

    case 'score': {
      const numVal = typeof value === 'number' ? value : parseInt(strValue, 10) || 0
      const clamped = Math.max(0, Math.min(100, numVal))
      const barColor = clamped > 70
        ? 'var(--matcha-600)'
        : clamped >= 40
          ? 'var(--tangerine-600)'
          : 'var(--pomegranate-600)'

      return (
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${clamped}%`, backgroundColor: barColor }}
            />
          </div>
          <span className={cn(
            "text-xs font-bold tabular-nums",
            clamped > 70 ? "text-matcha-600" : clamped >= 40 ? "text-tangerine-600" : "text-pomegranate-600"
          )}>
            {clamped}
          </span>
        </div>
      )
    }
  }
}
