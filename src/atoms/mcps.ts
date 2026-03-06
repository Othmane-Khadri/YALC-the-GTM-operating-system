import { atom } from 'jotai'

export interface McpServerState {
  id: string
  name: string
  transport: 'stdio' | 'sse'
  status: string
  toolCount: number
  tools: { name: string; description: string }[]
}

export const mcpServersAtom = atom<McpServerState[]>([])
export const mcpLoadingAtom = atom<boolean>(false)
