'use client'

import { useRef } from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import {
  messagesAtom,
  isStreamingAtom,
  streamingTextAtom,
  activeConversationIdAtom,
  executionStateAtom,
} from '@/atoms/conversation'
import type { StepStatus } from '@/atoms/conversation'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import type { ChatMessage, WorkflowDefinition, StreamEvent, ExecutionEvent, ColumnDef } from '@/lib/ai/types'

export function ChatPanel() {
  const setMessages = useSetAtom(messagesAtom)
  const setIsStreaming = useSetAtom(isStreamingAtom)
  const setStreamingText = useSetAtom(streamingTextAtom)
  const setConversationId = useSetAtom(activeConversationIdAtom)
  const setExecutionState = useSetAtom(executionStateAtom)
  const conversationId = useAtomValue(activeConversationIdAtom)

  // Track attached CSV rows and seedRows from workflow proposals
  const attachedRowsRef = useRef<Record<string, unknown>[]>([])
  const pendingSeedRowsRef = useRef<Record<string, unknown>[]>([])

  const handleSubmit = async (userInput: string, csvRows?: Record<string, unknown>[]) => {
    // Store attached rows for this request
    attachedRowsRef.current = csvRows ?? []
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
          ...(attachedRowsRef.current.length > 0 ? { attachedRows: attachedRowsRef.current } : {}),
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
              // Capture seedRows from event (sent by server when CSV was attached)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const seedRows = (event as any).seedRows as Record<string, unknown>[] | undefined
              if (seedRows && seedRows.length > 0) {
                pendingSeedRowsRef.current = seedRows
              } else if (attachedRowsRef.current.length > 0) {
                // Fallback: use attached CSV rows as seedRows
                pendingSeedRowsRef.current = attachedRowsRef.current
              }
            } else if (event.type === 'error' && event.error) {
              accumulatedText += `Error: ${event.error}`
              setStreamingText(accumulatedText)
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
          ? "Here's what I'll do:"
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
    // Initialize execution state with steps
    const steps: StepStatus[] = workflow.steps.map(s => ({
      index: s.stepIndex,
      title: s.title,
      status: 'pending' as const,
    }))
    setExecutionState({ status: 'running', steps, totalRows: 0 })

    // Use pending seedRows if available (from CSV upload)
    const seedRows = pendingSeedRowsRef.current.length > 0 ? pendingSeedRowsRef.current : undefined
    pendingSeedRowsRef.current = []
    attachedRowsRef.current = []

    try {
      const res = await fetch('/api/workflows/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId || 'default',
          workflow,
          ...(seedRows ? { seedRows } : {}),
        }),
      })

      if (!res.ok || !res.body) throw new Error(`Execution error: ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalResultSetId: string | undefined
      let finalTotalRows = 0
      let finalColumns: ColumnDef[] = []
      const allRows: Record<string, unknown>[] = []
      let usedMock = false
      const warnings: string[] = []

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
            const event: ExecutionEvent = JSON.parse(data)

            if (event.type === 'execution_start') {
              finalResultSetId = event.resultSetId
            } else if (event.type === 'step_start') {
              setExecutionState(prev => ({
                ...prev,
                steps: prev.steps.map(s =>
                  s.index === event.stepIndex ? { ...s, status: 'running' as const } : s
                ),
              }))
            } else if (event.type === 'row_batch') {
              if (event.rows) allRows.push(...event.rows)
              setExecutionState(prev => ({
                ...prev,
                totalRows: event.totalSoFar ?? prev.totalRows,
              }))
            } else if (event.type === 'step_complete') {
              setExecutionState(prev => ({
                ...prev,
                steps: prev.steps.map(s =>
                  s.index === event.stepIndex ? { ...s, status: 'completed' as const, rowsOut: event.rowsOut } : s
                ),
              }))
            } else if (event.type === 'columns_updated') {
              if (event.columns) finalColumns = event.columns
            } else if (event.type === 'execution_complete') {
              finalResultSetId = event.resultSetId
              finalTotalRows = event.totalRows ?? 0
            } else if (event.type === 'step_warning') {
              console.warn(`[step ${event.stepIndex}]`, event.message)
              if (String(event.message ?? '').includes('mock')) usedMock = true
              warnings.push(String(event.message ?? ''))
              setExecutionState(prev => ({
                ...prev,
                steps: prev.steps.map(s =>
                  s.index === event.stepIndex ? { ...s, warning: String(event.message ?? '') } : s
                ),
              }))
            } else if (event.type === 'error') {
              console.error('Workflow error:', event.error)
              // Surface the error visibly — stop execution and show message
              setExecutionState({ status: 'idle', steps: [], totalRows: 0 })
              const errorMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: `Workflow failed: ${event.error ?? 'Unknown error'}`,
                type: 'text',
                createdAt: new Date(),
              }
              setMessages(prev => [...prev, errorMsg])
              return // Stop processing further events
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // Fetch columns from the result set
      if (finalResultSetId) {
        try {
          const tableRes = await fetch(`/api/tables/${finalResultSetId}`)
          if (tableRes.ok) {
            const tableData = await tableRes.json()
            finalColumns = tableData.table?.columns || []
          }
        } catch {
          // Ignore — columns will be empty in card
        }
      }

      setExecutionState(prev => ({
        ...prev,
        status: 'complete',
        resultSetId: finalResultSetId,
      }))

      // Add table link message
      const tableMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: JSON.stringify({
          tableName: workflow.title,
          rowCount: finalTotalRows,
          columns: finalColumns,
          previewRows: allRows.slice(0, 3),
          usedMock,
          warnings,
        }),
        type: 'table',
        resultSetId: finalResultSetId,
        createdAt: new Date(),
      }
      setMessages(prev => [...prev, tableMessage])

      // Reset execution state
      setTimeout(() => {
        setExecutionState({ status: 'idle', steps: [], totalRows: 0 })
      }, 500)
    } catch (err) {
      setExecutionState({ status: 'idle', steps: [], totalRows: 0 })
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: err instanceof Error ? err.message : 'Workflow execution failed.',
        type: 'text',
        createdAt: new Date(),
      }
      setMessages(prev => [...prev, errorMessage])
    }
  }

  return (
    <div
      className="flex flex-col flex-1 h-full min-h-0"
      style={{ backgroundColor: 'var(--background)' }}
    >
      <MessageList onApproveWorkflow={handleApproveWorkflow} />
      <ChatInput onSubmit={(msg, csvRows) => handleSubmit(msg, csvRows)} />
    </div>
  )
}
