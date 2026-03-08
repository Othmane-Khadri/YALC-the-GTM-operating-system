import { atom } from 'jotai'

export interface KnowledgeItem {
  id: string
  title: string
  type: 'icp' | 'template' | 'competitive' | 'learning' | 'other'
  fileName: string
  extractedText: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

export type KnowledgeTypeFilter = 'all' | 'icp' | 'template' | 'competitive' | 'learning' | 'other'

export const knowledgeItemsAtom = atom<KnowledgeItem[]>([])
export const knowledgeLoadingAtom = atom<boolean>(true)
export const knowledgeTypeFilterAtom = atom<KnowledgeTypeFilter>('all')
export const knowledgeSearchAtom = atom<string>('')

// Derived: filtered items
export const filteredKnowledgeAtom = atom((get) => {
  const items = get(knowledgeItemsAtom)
  const typeFilter = get(knowledgeTypeFilterAtom)
  const search = get(knowledgeSearchAtom).toLowerCase()

  return items.filter(item => {
    if (typeFilter !== 'all' && item.type !== typeFilter) return false
    if (search) {
      return (
        item.title.toLowerCase().includes(search) ||
        item.fileName.toLowerCase().includes(search) ||
        item.extractedText.toLowerCase().includes(search)
      )
    }
    return true
  })
})
