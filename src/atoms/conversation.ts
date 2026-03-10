import { atom } from 'jotai'
import type { ChatMessage } from '@/lib/ai/types'

// Active conversation ID — null = no conversation loaded
export const activeConversationIdAtom = atom<string | null>(null)

// Messages in the active conversation
export const messagesAtom = atom<ChatMessage[]>([])

// Streaming state — true while Claude is responding
export const isStreamingAtom = atom<boolean>(false)

// Current streaming text (partial assistant message being built)
export const streamingTextAtom = atom<string>('')

// Input field value
export const inputValueAtom = atom<string>('')

// Sidebar collapsed state
export const sidebarCollapsedAtom = atom<boolean>(false)

// Derived: is there an active conversation?
export const hasConversationAtom = atom(
  (get) => get(activeConversationIdAtom) !== null
)

// Derived: last message in the conversation
export const lastMessageAtom = atom((get) => {
  const messages = get(messagesAtom)
  return messages[messages.length - 1] ?? null
})

// ─── Execution State ─────────────────────────────────────────────────────────

export interface StepStatus {
  index: number
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  rowsOut?: number
  warning?: string
}

export interface ExecutionState {
  status: 'idle' | 'running' | 'complete'
  workflowId?: string
  resultSetId?: string
  steps: StepStatus[]
  totalRows: number
}

export const executionStateAtom = atom<ExecutionState>({
  status: 'idle',
  steps: [],
  totalRows: 0,
})
