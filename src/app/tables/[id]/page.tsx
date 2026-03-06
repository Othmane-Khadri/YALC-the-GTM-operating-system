'use client'

import { use } from 'react'
import { Provider as JotaiProvider } from 'jotai'
import { Sidebar } from '@/components/layout/Sidebar'
import { TableView } from '@/components/table/TableView'

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  return (
    <JotaiProvider>
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--background)' }}>
        <Sidebar activeItem="tables" />
        <main className="flex flex-1 min-w-0 h-full">
          <TableView tableId={id} />
        </main>
      </div>
    </JotaiProvider>
  )
}
