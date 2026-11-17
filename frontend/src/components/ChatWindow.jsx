import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, Menu, Search, SlidersHorizontal, TriangleAlert, X } from 'lucide-react'
import ChatInput from './ChatInput.jsx'
import Message from './Message.jsx'
import { api } from '../api.js'

function ModelPicker({ model, onPick, defaultModel }) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const wrapRef = useRef(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getModels()
      setModels(data.models || [])
      setError(data.error)
    } catch (err) {
      setModels([])
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && models.length === 0 && !loading) load()
  }

  const q = query.trim().toLowerCase()
  const visible = models.filter((m) => !q || m.toLowerCase().includes(q))

  const choose = (name) => {
    onPick(name)
    setOpen(false)
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={toggle}
        className="flex max-w-[46vw] items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-100 md:max-w-[30vw] dark:border-neutral-700 dark:hover:bg-neutral-800"
        title={model}
      >
        <span className="truncate font-mono">{model || 'model'}</span>
        <ChevronDown size={13} className="shrink-0 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-xl border border-neutral-200 bg-white p-2 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
          <div className="relative mb-2">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              className="w-full rounded-lg border border-neutral-300 bg-transparent py-1.5 pl-8 pr-2 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700"
            />
          </div>

          <div className="scroll-slim max-h-56 overflow-y-auto">
            {loading && (
              <p className="flex items-center gap-2 px-2 py-3 text-xs text-neutral-500">
                <Loader2 size={13} className="animate-spin" /> Loading models…
              </p>
            )}
            {!loading && error && <p className="px-2 py-3 text-xs text-amber-600 dark:text-amber-400">{error}</p>}
            {!loading && !error && visible.length === 0 && (
              <p className="px-2 py-3 text-xs text-neutral-400">No models match.</p>
            )}
            {visible.map((name) => (
              <button
                key={name}
                onClick={() => choose(name)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-mono text-xs ${
                  name === model ? 'bg-neutral-100 dark:bg-neutral-800' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {name === model && <span className="text-green-600 dark:text-green-400">✓</span>}
              </button>
            ))}
          </div>

          <div className="mt-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const v = manual.trim()
                if (v) choose(v)
              }}
              className="flex gap-1.5"
            >
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Type a model id…"
                className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 font-mono text-xs outline-none focus:border-neutral-500 dark:border-neutral-700"
              />
              <button
                type="submit"
                className="rounded-lg bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
              >
                Use
              </button>
            </form>
            <button
              onClick={() => choose(defaultModel)}
              className="mt-1.5 w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Reset to default ({defaultModel})
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ChatSettingsPanel({ settings, defaultModel, onSave, onClose }) {
  const [temperature, setTemperature] = useState(settings.temperature ?? 0.7)
  const [maxTokens, setMaxTokens] = useState(settings.max_tokens ?? 1024)
  const [topP, setTopP] = useState(settings.top_p ?? 1)
  const [prompt, setPrompt] = useState(settings.system_prompt ?? '')

  const save = async (clear = []) => {
    await onSave(
      {
        temperature: Number(temperature),
        max_tokens: Number(maxTokens),
        top_p: Number(topP),
        system_prompt: prompt,
      },
      clear,
    )
    onClose()
  }

  const dirty =
    settings.temperature != null ||
    settings.max_tokens != null ||
    settings.top_p != null ||
    settings.system_prompt != null

  return (
    <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-xl border border-neutral-200 bg-white p-3 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Per-chat settings</h4>
        <button onClick={onClose} className="rounded p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1 flex justify-between text-[11px]">
            <span>Temperature</span>
            <span className="font-mono text-neutral-500">{Number(temperature).toFixed(1)}</span>
          </div>
          <input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} className="w-full accent-neutral-900 dark:accent-neutral-100" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px]">
            Max tokens
            <input type="number" min="1" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700" />
          </label>
          <label className="text-[11px]">
            Top-p
            <input type="number" min="0" max="1" step="0.05" value={topP} onChange={(e) => setTopP(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700" />
          </label>
        </div>
        <label className="block text-[11px]">
          System prompt override
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Leave empty to use the global prompt."
            className="mt-1 w-full resize-y rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700"
          />
        </label>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => save()}
          className="flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
        >
          Save
        </button>
        {dirty && (
          <button
            onClick={() => save(['temperature', 'max_tokens', 'top_p', 'system_prompt'])}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            title="Use the global settings again"
          >
            Reset
          </button>
        )}
      </div>
      <p className="mt-2 text-[10px] text-neutral-400">Global default: temp {settings.temperature ?? '—'} · max {settings.max_tokens ?? '—'} · top-p {settings.top_p ?? '—'}</p>
      <p className="text-[10px] text-neutral-400">Default model: {defaultModel}</p>
    </div>
  )
}

export default function ChatWindow({
  title,
  messages,
  streaming,
  error,
  onDismissError,
  onSend,
  onStop,
  onOpenSidebar,
  model,
  onModelChange,
  chatSettings,
  onSaveChatSettings,
  defaultModel,
}) {
  const scrollRef = useRef(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Auto-scroll while the answer grows (and on every new message).
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="relative flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800 md:px-6">
        <button
          onClick={onOpenSidebar}
          className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-50 md:hidden dark:hover:bg-neutral-800"
          aria-label="Open sidebar"
        >
          <Menu size={18} />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>

        <div className="flex shrink-0 items-center gap-1.5">
          <ModelPicker model={model} onPick={onModelChange} defaultModel={defaultModel} />
          <div className="relative">
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className={`rounded-lg border border-neutral-200 p-1.5 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800 ${
                settingsOpen ? 'bg-neutral-100 dark:bg-neutral-800' : ''
              }`}
              aria-label="Per-chat settings"
              title="Per-chat settings"
            >
              <SlidersHorizontal size={15} />
            </button>
            {settingsOpen && (
              <ChatSettingsPanel
                settings={chatSettings}
                defaultModel={defaultModel}
                onSave={onSaveChatSettings}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>
        </div>
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