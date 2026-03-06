'use client'

import { useEffect, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { inputValueAtom, isStreamingAtom } from '@/atoms/conversation'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  onSubmit: (message: string) => void
}

export function ChatInput({ onSubmit }: ChatInputProps) {
  const [value, setValue] = useAtom(inputValueAtom)
  const isStreaming = useAtomValue(isStreamingAtom)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
    onSubmit(trimmed)
    setValue('')
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

  const canSubmit = value.trim() && !isStreaming

  return (
    <div className="border-t px-8 py-5 border-border bg-white">
      <div className="flex items-end gap-3 rounded-2xl border px-5 py-4 transition-all duration-200 shadow-sm bg-surface-3 border-border focus-within:border-blueberry-600 focus-within:shadow-[0_0_0_3px_rgba(56,89,249,0.06)]">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your GTM goal..."
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none disabled:opacity-50 text-text-primary caret-blueberry-600 min-h-[28px] max-h-[200px]"
        />

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            "flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-xl text-sm font-bold transition-all duration-150",
            canSubmit
              ? "bg-text-primary text-background cursor-pointer hover:scale-105"
              : "bg-surface-2 text-text-muted cursor-not-allowed"
          )}
          title="Send (Enter)"
        >
          {isStreaming ? (
            <span className="animate-spin text-sm">◌</span>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 13V3M8 3L3 8M8 3L13 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>

      <div className="flex items-center mt-2.5 px-1 text-text-muted text-[11px] opacity-50">
        <span>⏎ send · Shift+⏎ newline</span>
      </div>
    </div>
  )
}
