'use client'

import type { ChatMessage } from '@/lib/ai/types'
import { WorkflowPreviewCard } from './WorkflowPreviewCard'

interface MessageBubbleProps {
  message: ChatMessage
  onApproveWorkflow?: (workflowDef: NonNullable<ChatMessage['workflowDefinition']>) => void
}

export function MessageBubble({ message, onApproveWorkflow }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isWorkflow = message.type === 'workflow_proposal'

  if (isWorkflow && message.workflowDefinition) {
    return (
      <div className="flex flex-col gap-1 message-enter">
        {/* Introductory text before the card */}
        {message.content && (
          <div
            className="text-xs leading-relaxed"
            style={{ color: 'var(--text-secondary)', maxWidth: '580px' }}
          >
            {message.content}
          </div>
        )}
        <WorkflowPreviewCard
          workflow={message.workflowDefinition}
          onApprove={() => onApproveWorkflow?.(message.workflowDefinition!)}
        />
      </div>
    )
  }

  return (
    <div
      className={`flex message-enter ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className="px-4 py-2.5 rounded-lg text-xs leading-relaxed max-w-xl"
        style={{
          backgroundColor: isUser ? 'var(--blueberry-50)' : 'var(--surface)',
          color: isUser ? 'var(--text-primary)' : 'var(--text-secondary)',
          border: isUser ? '1px solid var(--blueberry-600)' : '1px solid var(--border-subtle)',
          fontFamily: 'Space Mono, monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {message.content}
      </div>
    </div>
  )
}
