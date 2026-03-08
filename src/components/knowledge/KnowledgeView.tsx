'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  knowledgeItemsAtom,
  knowledgeLoadingAtom,
  knowledgeTypeFilterAtom,
  knowledgeSearchAtom,
  filteredKnowledgeAtom,
  type KnowledgeTypeFilter,
  type KnowledgeItem,
} from '@/atoms/knowledge'
import { cn } from '@/lib/utils'

const ACCEPTED_EXTENSIONS = ['.md', '.txt', '.pdf', '.csv']

const TYPE_FILTERS: { value: KnowledgeTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'icp', label: 'ICP' },
  { value: 'template', label: 'Template' },
  { value: 'competitive', label: 'Competitive' },
  { value: 'learning', label: 'Learning' },
  { value: 'other', label: 'Other' },
]

const TYPE_BADGE_STYLES: Record<string, { bg: string; color: string }> = {
  icp: { bg: 'var(--accent-light)', color: 'var(--accent)' },
  template: { bg: 'var(--success-light)', color: 'var(--success)' },
  competitive: { bg: 'var(--warning-light)', color: 'var(--warning-dark)' },
  learning: { bg: 'var(--accent-light)', color: 'var(--accent-dark)' },
  other: { bg: 'var(--surface-2)', color: 'var(--text-muted)' },
}

export function KnowledgeView() {
  const [items, setItems] = useAtom(knowledgeItemsAtom)
  const [loading, setLoading] = useAtom(knowledgeLoadingAtom)
  const [typeFilter, setTypeFilter] = useAtom(knowledgeTypeFilterAtom)
  const [search, setSearch] = useAtom(knowledgeSearchAtom)
  const filteredItems = useAtomValue(filteredKnowledgeAtom)
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    fetch('/api/knowledge')
      .then(r => r.json())
      .then(data => setItems(data.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [setItems, setLoading])

  const uploadFile = useCallback(async (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ACCEPTED_EXTENSIONS.includes(ext)) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', 'other')
      const res = await fetch('/api/knowledge', { method: 'POST', body: formData })
      const newItem = await res.json()
      if (newItem.id) {
        setItems(prev => [newItem, ...prev])
      }
    } finally {
      setUploading(false)
    }
  }, [setItems])

  const handleFiles = useCallback(async (fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      await uploadFile(file)
    }
  }, [uploadFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  const handleClickUpload = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = ACCEPTED_EXTENSIONS.join(',')
    input.onchange = () => {
      if (input.files) handleFiles(input.files)
    }
    input.click()
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/knowledge/${id}`, { method: 'DELETE' })
    setItems(prev => prev.filter(item => item.id !== id))
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted text-sm animate-pulse">Loading knowledge base...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-8" style={{ backgroundColor: 'var(--background)' }}>
      <div className="max-w-5xl mx-auto">
        <h1 className="text-xl font-bold font-display text-text-primary mb-1">Knowledge Base</h1>
        <p className="text-sm text-text-secondary mb-6">
          Upload ICP docs, templates, competitive intel, and learnings to power smarter workflows.
        </p>

        {/* Upload zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={handleClickUpload}
          className={cn(
            "rounded-3xl border-2 border-dashed cursor-pointer transition-all duration-200 p-10 text-center mb-6",
            isDragOver
              ? "border-accent bg-accent/[0.04]"
              : "border-border-subtle bg-surface hover:bg-white"
          )}
        >
          {uploading ? (
            <div className="text-sm text-text-muted animate-pulse">Uploading...</div>
          ) : (
            <>
              <div className="text-3xl mb-2 opacity-70">
                {isDragOver ? '\u2B07' : '\uD83D\uDCC4'}
              </div>
              <div className="text-sm font-bold text-text-primary">
                {isDragOver ? 'Drop files here' : 'Drop files or click to browse'}
              </div>
              <div className="text-xs mt-1 text-text-muted">
                .md, .txt, .pdf, .csv
              </div>
            </>
          )}
        </div>

        {/* Filter pills + search */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center gap-1">
            {TYPE_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-150",
                  typeFilter === f.value
                    ? "bg-text-primary text-white"
                    : "text-text-muted hover:bg-surface-2"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-border-subtle" />

          <div className="relative flex-1 max-w-[260px]">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M8.5 8.5L11.5 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              placeholder="Search documents..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs bg-surface border border-border-subtle input-focus"
            />
          </div>
        </div>

        {/* Card grid */}
        {filteredItems.length === 0 ? (
          <div className="rounded-3xl border border-border bg-white p-8 text-center shadow-card">
            <div className="text-sm text-text-secondary">
              {items.length === 0
                ? 'No documents yet. Upload your first file above.'
                : 'No documents match your filters.'}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map((item: KnowledgeItem) => {
              const badge = TYPE_BADGE_STYLES[item.type] ?? TYPE_BADGE_STYLES.other
              return (
                <div
                  key={item.id}
                  className="group rounded-3xl border border-border bg-white p-5 transition-all duration-200 shadow-card hover:shadow-card-hover relative"
                >
                  {/* Type badge */}
                  <span
                    className="inline-block font-bold rounded-md text-[10px] px-2 py-[2px] tracking-wide uppercase mb-3"
                    style={{ backgroundColor: badge.bg, color: badge.color }}
                  >
                    {item.type}
                  </span>

                  {/* Title */}
                  <h3 className="text-sm font-bold font-display text-text-primary truncate">
                    {item.title}
                  </h3>

                  {/* Filename */}
                  <div className="text-[11px] text-text-muted mt-1 truncate">
                    {item.fileName}
                  </div>

                  {/* Preview */}
                  {item.extractedText && (
                    <p className="text-xs text-text-secondary mt-2 line-clamp-2 leading-relaxed">
                      {item.extractedText.slice(0, 200)}
                    </p>
                  )}

                  {/* Date + delete */}
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-[11px] text-text-muted">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded-lg text-error hover:bg-error-light"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
