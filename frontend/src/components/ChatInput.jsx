import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'

// Rough local estimate, no tokenizer downloaded: ~4 chars per token.
export function estimateTokens(text) {
  const t = String(text || '')
  if (!t.trim()) return 0
  return Math.max(1, Math.ceil(t.length / 4))
}

export default function ChatInput({ streaming, onSend, onStop, onDraftChange }) {
  const [value, setValue] = useState('')
  const ref = useRef(null)

  // Auto-grow (up to a comfortable cap) and keep focus after each send.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    if (!streaming) el.focus()
  }, [value, streaming])

  const change = (e) => {
    setValue(e.target.value)
    onDraftChange?.(e.target.value)
  }

  const submit = () => {
    const text = value.trim()
    if (!text || streaming) return
    onSend(text)
    setValue('')
    onDraftChange?.('')
  }

  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    if (e.shiftKey && !e.ctrlKey && !e.metaKey) return // Shift+Enter = newline
    e.preventDefault()
    submit()
  }

  const tokens = estimateTokens(value)

  return (
    <div className="flex items-end gap-2 rounded-3xl border border-neutral-300 bg-white p-2 shadow-sm transition focus-within:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-within:border-neutral-500">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={change}
        onKeyDown={onKeyDown}
        placeholder="Message OpenBin"
        className="scroll-slim max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-6 outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
      />
      {streaming ? (
        <button
          onClick={onStop}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          aria-label="Stop generating"
          title="Stop"
        >
          <Square size={14} fill="currentColor" />
        </button>
      ) : (
        <button
          onClick={submit}
          disabled={!value.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          aria-label="Send message"
          title="Send"
        >
          <ArrowUp size={18} />
        </button>
      )}
    </div>
  )
}
