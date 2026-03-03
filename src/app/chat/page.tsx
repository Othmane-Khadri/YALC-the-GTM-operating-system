'use client'

import { Provider as JotaiProvider } from 'jotai'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChatPanel } from '@/components/chat/ChatPanel'

export default function ChatPage() {
  return (
    <JotaiProvider>
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--background)' }}>
        <Sidebar activeItem="chat" />
        <main className="flex flex-1 min-w-0 h-full">
          <ChatPanel />
        </main>
      </div>
    </JotaiProvider>
  )
}
