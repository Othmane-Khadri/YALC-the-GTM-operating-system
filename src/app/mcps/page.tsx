'use client'

import { Provider as JotaiProvider } from 'jotai'
import { Sidebar } from '@/components/layout/Sidebar'
import { McpsView } from '@/components/mcps/McpsView'

export default function McpsPage() {
  return (
    <JotaiProvider>
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--background)' }}>
        <Sidebar activeItem="mcps" />
        <main className="flex flex-1 min-w-0 h-full">
          <McpsView />
        </main>
      </div>
    </JotaiProvider>
  )
}
