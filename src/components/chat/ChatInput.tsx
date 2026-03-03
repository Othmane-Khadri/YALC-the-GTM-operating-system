'use client'

import { useEffect, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { inputValueAtom, isStreamingAtom } from '@/atoms/conversation'

interface ChatInputProps {
  onSubmit: (message: string) => void
}

export function ChatInput({ onSubmit }: ChatInputProps) {
  const [value, setValue] = useAtom(inputValueAtom)
  const isStreaming = useAtomValue(isStreamingAtom)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Listen for example prompt clicks
  useEffect(() => {
    const handler = (e: Event) => {
      const prompt = (e as CustomEvent<string>).detail
      setValue(prompt)
      textareaRef.current?.focus()
    }
    window.addEventListener('set-input', handler)
    return () => window.removeEventListener('set-input', handler)
  }, [setValue])

  // Auto-resize textarea
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

  return (
    <div
      className="border-t px-4 py-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
    >
      <div
        className="flex items-end gap-3 rounded-lg border px-4 py-3 transition-colors"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
        onFocus={() => {}}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your GTM goal... (⏎ to send, Shift+⏎ for newline)"
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none bg-transparent text-xs leading-relaxed outline-none disabled:opacity-50"
          style={{
            color: 'var(--text-primary)',
            fontFamily: 'Space Mono, monospace',
            caretColor: 'var(--blueberry-600)',
            minHeight: '20px',
            maxHeight: '200px',
          }}
        />

        {/* Send button */}
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || isStreaming}
          className="flex-shrink-0 w-8 h-8 rounded flex items-center justify-center text-sm transition-all disabled:opacity-30"
          style={{
            backgroundColor: value.trim() && !isStreaming
              ? 'var(--blueberry-600)'
              : 'var(--surface-2)',
            color: 'white',
            cursor: value.trim() && !isStreaming ? 'pointer' : 'not-allowed',
          }}
          title="Send (Enter)"
        >
          {isStreaming ? (
            <span className="animate-spin text-xs">◌</span>
          ) : (
            '▲'
          )}
        </button>
      </div>

      <div
        className="flex items-center justify-between mt-1.5 px-1"
        style={{ color: 'var(--text-muted)', fontSize: '10px' }}
      >
        <span>⏎ send · Shift+⏎ newline</span>
        {value.length > 0 && (
          <span>{value.length} chars</span>
        )}
      </div>
    </div>
  )
}
