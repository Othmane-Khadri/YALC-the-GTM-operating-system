'use client'

import { useEffect } from 'react'
import { Provider as JotaiProvider, useSetAtom } from 'jotai'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { OnboardingModal } from '@/components/onboarding/OnboardingModal'
import { onboardingOpenAtom } from '@/atoms/onboarding'

function ChatWithOnboarding() {
  const setOnboardingOpen = useSetAtom(onboardingOpenAtom)

  useEffect(() => {
    async function checkFramework() {
      try {
        const res = await fetch('/api/framework')
        const data = await res.json()
        if (!data.framework || !data.onboardingComplete) {
          setOnboardingOpen(true)
        }
      } catch {
        // If check fails, don't block the chat
      }
    }
    checkFramework()
  }, [setOnboardingOpen])

  return (
    <>
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--background)' }}>
        <Sidebar activeItem="chat" />
        <main className="flex flex-1 min-w-0 h-full">
          <ChatPanel />
        </main>
      </div>
      <OnboardingModal />
    </>
  )
}

export default function ChatPage() {
  return (
    <JotaiProvider>
      <ChatWithOnboarding />
    </JotaiProvider>
  )
}
