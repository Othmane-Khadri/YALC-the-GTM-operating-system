'use client'

import { useAtom } from 'jotai'
import { sidebarCollapsedAtom } from '@/atoms/conversation'

const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: '⬡',
    href: '/dashboard',
    comingSoon: true,
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: '◎',
    href: '/chat',
    comingSoon: false,
  },
  {
    id: 'knowledge',
    label: 'Knowledge Base',
    icon: '◈',
    href: '/knowledge',
    comingSoon: true,
  },
  {
    id: 'api-keys',
    label: 'API Keys',
    icon: '◆',
    href: '/api-keys',
    comingSoon: true,
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: '◇',
    href: '/settings',
    comingSoon: true,
  },
]

export function Sidebar({ activeItem = 'chat' }: { activeItem?: string }) {
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom)

  return (
    <aside
      className="flex flex-col h-full border-r transition-all duration-200"
      style={{
        width: collapsed ? '56px' : '220px',
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        minWidth: collapsed ? '56px' : '220px',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-4 py-4 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <div
          className="flex-shrink-0 w-7 h-7 rounded flex items-center justify-center text-xs font-bold"
          style={{
            backgroundColor: 'var(--blueberry-600)',
            color: 'white',
            fontFamily: 'Space Mono, monospace',
          }}
        >
          G
        </div>
        {!collapsed && (
          <div>
            <div
              className="text-xs font-bold tracking-wide uppercase"
              style={{ color: 'var(--text-primary)', letterSpacing: '0.08em' }}
            >
              GTM-OS
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
              Day 1 of 30
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeItem
          return (
            <a
              key={item.id}
              href={item.comingSoon ? '#' : item.href}
              className="flex items-center gap-3 px-2 py-2 rounded text-xs transition-colors group"
              style={{
                backgroundColor: isActive ? 'var(--blueberry-50)' : 'transparent',
                color: isActive
                  ? 'var(--blueberry-300)'
                  : item.comingSoon
                  ? 'var(--text-muted)'
                  : 'var(--text-secondary)',
                cursor: item.comingSoon ? 'not-allowed' : 'pointer',
                fontFamily: 'Space Mono, monospace',
              }}
              onClick={(e) => item.comingSoon && e.preventDefault()}
            >
              <span className="flex-shrink-0 text-base leading-none w-5 text-center">
                {item.icon}
              </span>
              {!collapsed && (
                <>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.comingSoon && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: 'var(--oat-100)',
                        color: 'var(--text-muted)',
                        fontSize: '9px',
                        letterSpacing: '0.05em',
                      }}
                    >
                      SOON
                    </span>
                  )}
                </>
              )}
            </a>
          )
        })}
      </nav>

      {/* Collapse toggle */}
      <div
        className="px-2 py-3 border-t"
        style={{ borderColor: 'var(--border)' }}
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center px-2 py-1.5 rounded text-xs transition-colors"
          style={{
            color: 'var(--text-muted)',
            fontFamily: 'Space Mono, monospace',
          }}
        >
          {collapsed ? '→' : '←'}
          {!collapsed && <span className="ml-2">Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
