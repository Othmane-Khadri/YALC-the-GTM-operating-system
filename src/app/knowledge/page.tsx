'use client'

import { Provider as JotaiProvider } from 'jotai'
import { Sidebar } from '@/components/layout/Sidebar'
import { KnowledgeView } from '@/components/knowledge/KnowledgeView'

export default function KnowledgePage() {
  return (
    <JotaiProvider>
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--background)' }}>
        <Sidebar activeItem="knowledge" />
        <main className="flex flex-1 min-w-0 h-full">
          <KnowledgeView />
        </main>
      </div>
    </JotaiProvider>
  )
}
