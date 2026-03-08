'use client'

import { Provider as JotaiProvider } from 'jotai'
import { Sidebar } from '@/components/layout/Sidebar'
import { SettingsView } from '@/components/settings/SettingsView'

export default function SettingsPage() {
  return (
    <JotaiProvider>
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--background)' }}>
        <Sidebar activeItem="settings" />
        <main className="flex flex-1 min-w-0 h-full">
          <SettingsView />
        </main>
      </div>
    </JotaiProvider>
  )
}
