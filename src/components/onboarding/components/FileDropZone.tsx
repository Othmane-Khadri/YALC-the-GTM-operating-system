'use client'

import { useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface FileDropZoneProps {
  files: Array<{ name: string; content: string }>
  onFilesChange: (files: Array<{ name: string; content: string }>) => void
}

const ACCEPTED_TYPES = ['.pdf', '.md', '.txt', '.docx']

export function FileDropZone({ files, onFilesChange }: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)

  const readFile = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => resolve('')
      reader.readAsText(file)
    })
  }, [])

  const handleFiles = useCallback(async (fileList: FileList) => {
    const newFiles: Array<{ name: string; content: string }> = []
    for (const file of Array.from(fileList)) {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase()
      if (ACCEPTED_TYPES.includes(ext)) {
        const content = await readFile(file)
        if (content) newFiles.push({ name: file.name, content })
      }
    }
    if (newFiles.length > 0) {
      onFilesChange([...files, ...newFiles])
    }
  }, [files, onFilesChange, readFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index))
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => {
          const input = document.createElement('input')
          input.type = 'file'
          input.multiple = true
          input.accept = ACCEPTED_TYPES.join(',')
          input.onchange = () => {
            if (input.files) handleFiles(input.files)
          }
          input.click()
        }}
        className={cn(
          "rounded-3xl border-2 border-dashed cursor-pointer transition-all duration-200 p-12 text-center",
          isDragOver
            ? "border-accent bg-accent/[0.04]"
            : "border-border-subtle bg-surface"
        )}
      >
        <div className="text-4xl mb-3 opacity-80">
          {isDragOver ? '⬇' : '📄'}
        </div>
        <div className="text-sm font-bold text-text-primary">
          {isDragOver ? 'Drop files here' : 'Drop files or click to browse'}
        </div>
        <div className="text-xs mt-1.5 text-text-muted">
          PDF, Markdown, TXT, DOCX
        </div>
      </div>

      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          {files.map((file, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl px-4 py-3 bg-surface border border-border"
            >
              <span className="text-sm truncate text-text-primary">
                📎 {file.name}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                className="text-xs px-2.5 py-1 rounded-lg transition-colors duration-150 text-error hover:bg-error/[0.08]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
