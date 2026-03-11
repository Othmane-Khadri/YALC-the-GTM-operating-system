'use client'

import { useEffect, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { messagesAtom, isStreamingAtom, streamingTextAtom, executionStateAtom } from '@/atoms/conversation'
import { MessageBubble } from './MessageBubble'
import { ExecutionProgressCard } from '../table/ExecutionProgressCard'
import type { ChatMessage } from '@/lib/ai/types'

interface MessageListProps {
  onApproveWorkflow?: (
    workflow: NonNullable<ChatMessage['workflowDefinition']>
  ) => void
}

const ACTION_CARDS = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M10 7v6M7 10h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    iconBg: 'var(--success-light)',
    iconColor: 'var(--success)',
    accent: 'var(--success)',
    title: 'Find leads',
    description: 'Find 50 SaaS companies in France hiring for sales roles',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 8h6M7 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    iconBg: 'var(--accent-light)',
    iconColor: 'var(--accent)',
    accent: 'var(--accent)',
    title: 'Scrape & qualify',
    description: 'Scrape product pages from a list of URLs and qualify against my ICP',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M14 10v2.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 016 12.5V10M10 4v7M10 4L7.5 6.5M10 4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    iconBg: 'var(--accent-light)',
    iconColor: 'var(--accent-dark)',
    accent: 'var(--accent-dark)',
    title: 'Upload & qualify',
    description: 'Upload a CSV of leads and qualify them against my ICP criteria',
  },
]

export function MessageList({ onApproveWorkflow }: MessageListProps) {
  const messages = useAtomValue(messagesAtom)
  const isStreaming = useAtomValue(isStreamingAtom)
  const streamingText = useAtomValue(streamingTextAtom)
  const execution = useAtomValue(executionStateAtom)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-10 px-8 py-16">
        {/* Wordmark */}
        <div className="text-center flex flex-col gap-3">
          <div className="font-bold font-display text-text-primary tracking-[-0.04em] text-[60px] leading-none">
            Yalc
          </div>
          <div className="text-text-muted text-base italic tracking-wide">
            Clay in reverse. Open source. And AI native.
          </div>
          <p className="leading-relaxed text-text-secondary max-w-[380px] mx-auto mt-1 text-sm">
            Describe your GTM goal. I&apos;ll propose the best workflow to get there.
          </p>
        </div>

        {/* Action cards */}
        <div className="grid grid-cols-3 gap-4 w-full max-w-[760px]">
          {ACTION_CARDS.map((card) => (
            <button
              key={card.title}
              className="text-left rounded-3xl border transition-all duration-200 bg-surface-3 border-border p-6 hover:bg-white hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] hover:-translate-y-0.5"
              style={{ '--accent': card.accent } as React.CSSProperties}
              onClick={() => {
                const event = new CustomEvent('set-input', { detail: card.description })
                window.dispatchEvent(event)
              }}
            >
              <div
                className="flex items-center justify-center rounded-xl mb-4 w-12 h-12"
                style={{ backgroundColor: card.iconBg, color: card.iconColor }}
              >
                {card.icon}
              </div>
              <div className="text-sm font-bold mb-1.5 text-text-primary">
                {card.title}
              </div>
              <div className="text-xs leading-relaxed text-text-muted">
                {card.description}
              </div>
            </button>
          ))}
        </div>

        <div className="text-xs text-text-muted opacity-40">
          or type anything below
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8 space-y-6">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          onApproveWorkflow={onApproveWorkflow}
        />
      ))}

      {execution.status === 'running' && (
        <ExecutionProgressCard />
      )}

      {isStreaming && streamingText && (
        <div className="flex justify-start message-enter">
          <div className="px-1 py-2 text-sm leading-relaxed max-w-2xl streaming-cursor text-text-primary whitespace-pre-wrap">
            {streamingText}
          </div>
        </div>
      )}

      {isStreaming && !streamingText && (
        <div className="flex justify-start">
          <div className="px-1 py-2 text-sm flex items-center gap-2 text-text-muted">
            <span className="animate-pulse text-success">●</span>
            <span>thinking...</span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
