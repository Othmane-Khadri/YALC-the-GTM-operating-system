'use client'

import { Provider as JotaiProvider } from 'jotai'
import { Sidebar } from '@/components/layout/Sidebar'
import { TablesListView } from '@/components/table/TablesListView'

export default function TablesPage() {
  return (
    <JotaiProvider>
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--background)' }}>
        <Sidebar activeItem="tables" />
        <main className="flex flex-1 min-w-0 h-full">
          <TablesListView />
        </main>
      </div>
    </JotaiProvider>
  )
}
