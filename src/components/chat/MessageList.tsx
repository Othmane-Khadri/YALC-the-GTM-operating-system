'use client'

import { useEffect, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { messagesAtom, isStreamingAtom, streamingTextAtom } from '@/atoms/conversation'
import { MessageBubble } from './MessageBubble'
import type { ChatMessage } from '@/lib/ai/types'

interface MessageListProps {
  onApproveWorkflow?: (
    workflow: NonNullable<ChatMessage['workflowDefinition']>
  ) => void
}

export function MessageList({ onApproveWorkflow }: MessageListProps) {
  const messages = useAtomValue(messagesAtom)
  const isStreaming = useAtomValue(isStreamingAtom)
  const streamingText = useAtomValue(streamingTextAtom)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        {/* Empty state */}
        <div className="text-center space-y-3">
          <div
            className="text-4xl font-bold tracking-tight"
            style={{ color: 'var(--text-primary)', fontFamily: 'Space Mono, monospace' }}
          >
            GTM-OS
          </div>
          <p
            className="text-sm max-w-sm leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            Describe your GTM goal. I'll propose the best workflow to get there.
          </p>
        </div>

        {/* Example prompts */}
        <div className="grid gap-2 w-full max-w-lg">
          {[
            'Find 50 SaaS companies in France hiring for sales roles',
            'Enrich my lead list with tech stack and decision maker emails',
            'Qualify 200 companies against my ICP for enterprise accounts',
          ].map((prompt) => (
            <button
              key={prompt}
              className="text-left px-4 py-3 rounded-lg border text-xs transition-colors"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--text-secondary)',
                fontFamily: 'Space Mono, monospace',
              }}
              onClick={() => {
                const event = new CustomEvent('set-input', { detail: prompt })
                window.dispatchEvent(event)
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          onApproveWorkflow={onApproveWorkflow}
        />
      ))}

      {/* Streaming indicator */}
      {isStreaming && streamingText && (
        <div className="flex justify-start message-enter">
          <div
            className="px-4 py-2.5 rounded-lg text-xs leading-relaxed max-w-xl streaming-cursor"
            style={{
              backgroundColor: 'var(--surface)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              fontFamily: 'Space Mono, monospace',
              whiteSpace: 'pre-wrap',
            }}
          >
            {streamingText}
          </div>
        </div>
      )}

      {/* Thinking indicator (before text starts streaming) */}
      {isStreaming && !streamingText && (
        <div className="flex justify-start">
          <div
            className="px-4 py-2.5 rounded-lg text-xs"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-muted)',
              fontFamily: 'Space Mono, monospace',
            }}
          >
            <span className="animate-pulse-slow">thinking...</span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
