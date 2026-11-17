import { useEffect, useRef } from 'react'
import { Menu, TriangleAlert, X } from 'lucide-react'
import ChatInput from './ChatInput.jsx'
import Message from './Message.jsx'

export default function ChatWindow({
  title,
  messages,
  streaming,
  error,
  onDismissError,
  onSend,
  onStop,
  onOpenSidebar,
}) {
  const scrollRef = useRef(null)

  // Auto-scroll while the answer grows (and on every new message).
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800 md:px-6">
        <button
          onClick={onOpenSidebar}
          className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200 md:hidden dark:hover:bg-neutral-800"
          aria-label="Open sidebar"
        >
          <Menu size={18} />
        </button>
        <span className="truncate text-sm font-medium">{title}</span>
      </header>

      {error && (
        <div className="mx-auto mt-3 flex w-full max-w-3xl items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 md:mx-6 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{error}</p>
          <button onClick={onDismissError} className="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/50" aria-label="Dismiss error">
            <X size={15} />
          </button>
        </div>
      )}

      <div ref={scrollRef} className="scroll-slim flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-6">
          {messages.length === 0 ? (
            <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-lg font-bold text-white dark:bg-white dark:text-neutral-900">
                O
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">OpenBin</h1>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Ask anything to get started.
              </p>
            </div>
          ) : (
            messages.map((message, index) => (
              <Message
                key={message.id}
                message={message}
                streaming={streaming && index === messages.length - 1}
              />
            ))
          )}
        </div>
      </div>

      <div className="border-t border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-6">
          <ChatInput streaming={streaming} onSend={onSend} onStop={onStop} />
          <p className="mt-2 text-center text-[11px] text-neutral-400">
            Local app · your chats stay on this computer
          </p>
        </div>
      </div>
    </div>
  )
}
