'use client'

import { Provider as JotaiProvider } from 'jotai'
import { Sidebar } from '@/components/layout/Sidebar'
import { ApiKeysView } from '@/components/api-keys/ApiKeysView'

export default function ApiKeysPage() {
  return (
    <JotaiProvider>
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--background)' }}>
        <Sidebar activeItem="api-keys" />
        <main className="flex flex-1 min-w-0 h-full">
          <ApiKeysView />
        </main>
      </div>
    </JotaiProvider>
  )
}
