'use client'

import { useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { sidebarCollapsedAtom } from '@/atoms/conversation'
import { cn } from '@/lib/utils'

function IconDashboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="9" y="2" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="2" y="9" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="9" y="9" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}

function IconChat() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 3h10a1 1 0 011 1v6a1 1 0 01-1 1H6l-3 2.5V11H3a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  )
}

function IconKnowledge() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 3h4L8 4.5l1.5-1.5h4v10h-4.5L8 14l-1-1H2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M8 4.5V14" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}

function IconKey() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="6" cy="10" r="3" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8.5 8L13 3.5M11.5 3.5L13 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function IconReviews() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5C5.5 1.5 4 3.5 4 5.5V8L3 10H13L12 8V5.5C12 3.5 10.5 1.5 8 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6.5 10V11C6.5 11.83 7.17 12.5 8 12.5C8.83 12.5 9.5 11.83 9.5 11V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconMcp() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function IconTable() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M2 6h12M2 10h12M6 6v8M10 6v8" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
}

function IconCampaigns() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1L10.5 6.5L14 8L10.5 9.5L8 15L5.5 9.5L2 8L5.5 6.5L8 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  )
}

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: <IconDashboard />, href: '/dashboard', comingSoon: true, accentColor: 'var(--text-muted)', accentBg: 'var(--blueberry-50)' },
  { id: 'chat', label: 'Chat', icon: <IconChat />, href: '/chat', comingSoon: false, accentColor: 'var(--blueberry-600)', accentBg: 'var(--blueberry-50)' },
  { id: 'campaigns', label: 'Campaigns', icon: <IconCampaigns />, href: '/campaigns', comingSoon: false, accentColor: 'var(--dragonfruit-600)', accentBg: 'var(--dragonfruit-50)' },
  { id: 'tables', label: 'Tables', icon: <IconTable />, href: '/tables', comingSoon: false, accentColor: 'var(--matcha-600)', accentBg: 'var(--matcha-50)' },
  { id: 'reviews', label: 'Reviews', icon: <IconReviews />, href: '/reviews', comingSoon: false, accentColor: 'var(--tangerine-600)', accentBg: 'var(--tangerine-50)' },
  { id: 'knowledge', label: 'Knowledge Base', icon: <IconKnowledge />, href: '/knowledge', comingSoon: true, accentColor: 'var(--matcha-600)', accentBg: 'var(--matcha-50)' },
  { id: 'api-keys', label: 'API Keys', icon: <IconKey />, href: '/api-keys', comingSoon: false, accentColor: 'var(--dragonfruit-600)', accentBg: 'var(--dragonfruit-50)' },
  { id: 'mcps', label: 'MCPs', icon: <IconMcp />, href: '/mcps', comingSoon: false, accentColor: 'var(--tangerine-700)', accentBg: 'var(--tangerine-50)' },
  { id: 'settings', label: 'Settings', icon: <IconSettings />, href: '/settings', comingSoon: true, accentColor: 'var(--text-muted)', accentBg: 'var(--surface-2)' },
]

function ReviewsBadge() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    fetch('/api/reviews?status=pending')
      .then(r => r.json())
      .then(data => setCount(Array.isArray(data.reviews) ? data.reviews.length : 0))
      .catch(() => {})
  }, [])

  if (count === 0) return null

  return (
    <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-tangerine text-white text-[10px] font-bold px-1">
      {count}
    </span>
  )
}

export function Sidebar({ activeItem = 'chat' }: { activeItem?: string }) {
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom)

  return (
    <aside
      className="flex flex-col h-full border-r transition-all duration-200 bg-white border-border"
      style={{ width: collapsed ? '60px' : '228px', minWidth: collapsed ? '60px' : '228px' }}
    >
      <div className="flex items-center gap-3 border-b border-border p-4">
        <div className="flex-shrink-0 flex items-center justify-center font-bold rounded-xl w-8 h-8 bg-text-primary text-background text-[13px]">
          Y
        </div>
        {!collapsed && (
          <div>
            <div className="font-bold uppercase text-text-primary tracking-[0.15em] text-[11px]">Yalc</div>
            <div className="text-text-muted text-[10px] mt-0.5">Day 4 of 30</div>
          </div>
        )}
      </div>

      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeItem
          return (
            <a
              key={item.id}
              href={item.comingSoon ? '#' : item.href}
              className={cn(
                "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                isActive ? "" : item.comingSoon ? "cursor-not-allowed" : "hover:bg-surface cursor-pointer"
              )}
              style={{
                backgroundColor: isActive ? item.accentBg : undefined,
                color: isActive ? item.accentColor : item.comingSoon ? 'var(--text-muted)' : 'var(--text-secondary)',
              }}
              onClick={(e) => item.comingSoon && e.preventDefault()}
            >
              {isActive && (
                <div
                  className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
                  style={{ backgroundColor: item.accentColor }}
                />
              )}
              <div
                className="flex-shrink-0 flex items-center justify-center rounded-lg w-7 h-7"
                style={{ color: isActive ? item.accentColor : 'var(--text-muted)' }}
              >
                {item.icon}
              </div>
              {!collapsed && (
                <>
                  <span className="flex-1 truncate text-sm">{item.label}</span>
                  {item.id === 'reviews' && <ReviewsBadge />}
                  {item.comingSoon && (
                    <span className="font-bold rounded-md bg-oat-200 text-text-muted text-[9px] px-2 py-0.5 tracking-wide">SOON</span>
                  )}
                </>
              )}
            </a>
          )
        })}
      </nav>

      <div className="px-2 py-3 border-t border-border">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center px-3 py-2 rounded-xl text-xs transition-colors duration-150 text-text-muted hover:bg-surface"
        >
          {collapsed ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span className="ml-2 text-[11px]">Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
