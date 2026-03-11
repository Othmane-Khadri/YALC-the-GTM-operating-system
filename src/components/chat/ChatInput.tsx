'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { inputValueAtom, isStreamingAtom } from '@/atoms/conversation'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  onSubmit: (message: string, csvRows?: Record<string, unknown>[]) => void
}

function parseCSV(text: string): Record<string, unknown>[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const row: Record<string, unknown> = {}
    headers.forEach((h, i) => { row[h] = values[i] ?? '' })
    return row
  })
}

export function ChatInput({ onSubmit }: ChatInputProps) {
  const [value, setValue] = useAtom(inputValueAtom)
  const isStreaming = useAtomValue(isStreamingAtom)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [csvFile, setCsvFile] = useState<{ name: string; rows: Record<string, unknown>[] } | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const prompt = (e as CustomEvent<string>).detail
      setValue(prompt)
      textareaRef.current?.focus()
    }
    window.addEventListener('set-input', handler)
    return () => window.removeEventListener('set-input', handler)
  }, [setValue])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [value])

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed || isStreaming) return
    onSubmit(trimmed, csvFile?.rows)
    setValue('')
    setCsvFile(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target?.result as string
      const rows = parseCSV(text)
      if (rows.length > 0) {
        setCsvFile({ name: file.name, rows })
      }
    }
    reader.readAsText(file)
    // Reset file input so the same file can be re-selected
    e.target.value = ''
  }, [])

  const canSubmit = value.trim() && !isStreaming

  return (
    <div className="border-t px-8 py-5 border-border bg-white">
      {/* CSV file chip */}
      {csvFile && (
        <div className="flex items-center gap-2 mb-3 px-1">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-accent-light text-accent">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="1" width="8" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4 4h4M4 6h4M4 8h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
            {csvFile.name} ({csvFile.rows.length} rows)
            <button
              onClick={() => setCsvFile(null)}
              className="ml-1 hover:text-error transition-colors"
              title="Remove file"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-3 rounded-3xl border px-5 py-4 transition-all duration-200 shadow-sm bg-surface-3 border-border focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(214,51,132,0.06)]">
        {/* Paperclip / upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isStreaming}
          className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-50"
          title="Upload CSV"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M14 10v2.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5V10M11 5L8 2M8 2L5 5M8 2v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="hidden"
        />

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your GTM goal..."
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none disabled:opacity-50 text-text-primary caret-accent min-h-[28px] max-h-[200px]"
        />

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            "flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl text-sm font-bold transition-colors duration-150",
            canSubmit
              ? "bg-text-primary text-background cursor-pointer hover:bg-text-secondary"
              : "bg-surface-2 text-text-muted cursor-not-allowed"
          )}
          title="Send (Enter)"
        >
          {isStreaming ? (
            <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.25"/>
              <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 13V3M8 3L3 8M8 3L13 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>

      <div className="flex items-center mt-2.5 px-1 text-text-muted text-[11px] opacity-50">
        <span>⏎ send · Shift+⏎ newline · CSV upload supported</span>
      </div>
    </div>
  )
}
