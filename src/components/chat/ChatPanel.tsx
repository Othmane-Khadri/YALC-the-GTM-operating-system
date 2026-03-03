'use client'

import { useSetAtom, useAtomValue } from 'jotai'
import {
  messagesAtom,
  isStreamingAtom,
  streamingTextAtom,
  activeConversationIdAtom,
} from '@/atoms/conversation'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import type { ChatMessage, WorkflowDefinition, StreamEvent } from '@/lib/ai/types'

export function ChatPanel() {
  const setMessages = useSetAtom(messagesAtom)
  const setIsStreaming = useSetAtom(isStreamingAtom)
  const setStreamingText = useSetAtom(streamingTextAtom)
  const setConversationId = useSetAtom(activeConversationIdAtom)
  const conversationId = useAtomValue(activeConversationIdAtom)

  const handleSubmit = async (userInput: string) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userInput,
      type: 'text',
      createdAt: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setIsStreaming(true)
    setStreamingText('')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userInput,
          conversationId,
        }),
      })

      if (!res.ok || !res.body) {
        throw new Error(`API error: ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      let buffer = ''
      let accumulatedText = ''
      let finalWorkflow: WorkflowDefinition | undefined
      let newConversationId: string | undefined

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const event: StreamEvent & { conversationId?: string } = JSON.parse(data)

            if (event.conversationId) {
              newConversationId = event.conversationId
            }

            if (event.type === 'text_delta' && event.content) {
              accumulatedText += event.content
              setStreamingText(accumulatedText)
            } else if (event.type === 'workflow_proposal' && event.workflow) {
              finalWorkflow = event.workflow
            }
          } catch {
            // Ignore parse errors in stream
          }
        }
      }

      // Finalize: add assistant message to state
      if (newConversationId) {
        setConversationId(newConversationId)
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: finalWorkflow
          ? "Here's a workflow I'd suggest for your goal:"
          : accumulatedText,
        type: finalWorkflow ? 'workflow_proposal' : 'text',
        workflowDefinition: finalWorkflow,
        createdAt: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
        type: 'text',
        createdAt: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsStreaming(false)
      setStreamingText('')
    }
  }

  const handleApproveWorkflow = async (workflow: WorkflowDefinition) => {
    // Stub for Day 1 — execution will be implemented in upcoming days
    const stubMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `Workflow approved: "${workflow.title}"\n\nExecution engine is being built (Day 2+). For now, your workflow definition has been saved and will run when the execution layer is ready.`,
      type: 'text',
      createdAt: new Date(),
    }
    setMessages((prev) => [...prev, stubMessage])
  }

  return (
    <div
      className="flex flex-col flex-1 h-full min-h-0"
      style={{ backgroundColor: 'var(--background)' }}
    >
      <MessageList onApproveWorkflow={handleApproveWorkflow} />
      <ChatInput onSubmit={handleSubmit} />
    </div>
  )
}
