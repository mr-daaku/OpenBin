import { useEffect, useRef, useState } from 'react'
import { Download, FileCode, FileText, Menu, MoreHorizontal, Shield, Sparkles, SlidersHorizontal, Telescope, TriangleAlert, X } from 'lucide-react'
import ChatInput, { estimateTokens } from './ChatInput.jsx'
import Message from './Message.jsx'
import ArtifactPanel from './ArtifactPanel.jsx'

// Time-based greeting for the welcome screen: "Good morning" / "Good afternoon" / "Good evening".
function timeGreeting(d = new Date()) {
  const h = d.getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  return 'Good evening'
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
      <p className="mt-2 text-[10px] text-neutral-400">Default model: {defaultModel}</p>
    </div>
  )
}

// Starter prompts for the new-chat welcome screen. Clicking a card sends it.
const SUGGESTIONS = [
  {
    label: 'Explain a concept',
    hint: 'Explain quantum computing like I am 12 years old',
    prompt: 'Explain quantum computing like I am 12 years old, with a simple everyday analogy.',
    icon: Sparkles,
  },
  {
    label: 'Write code',
    hint: 'Python script to organize my downloads folder',
    prompt: 'Write a Python script that organizes files in my Downloads folder by file type into subfolders. Explain how to run it.',
    icon: FileCode,
  },
  {
    label: 'Plan & research',
    hint: '3-day trip plan with budget',
    prompt: 'Plan a 3-day trip to Manali with a daily itinerary and a rough budget for a couple.',
    icon: Telescope,
  },
  {
    label: 'Summarize text',
    hint: 'Paste text and get key points',
    prompt: 'I will paste a long text. Summarize it into 5 bullet points and one short conclusion. First tell me you are ready.',
    icon: FileText,
  },
]

function download(filename, text, type) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function toMarkdown(title, messages) {
  const lines = [`# ${title}`, '']
  for (const m of messages) {
    if (m.role === 'user') lines.push('## You', '', m.content, '')
    else if (m.role === 'assistant') lines.push('## OpenBin', '', m.content, '')
  }
  return lines.join('\n')
}

function ChatMenu({ title, messages, incognito, busy, onAutoTitle, onToggleIncognito }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const slug = (title || 'chat').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chat'
  const items = [
    {
      label: 'Auto-title with AI',
      icon: Sparkles,
      disabled: busy || messages.length === 0,
      onClick: () => {
        setOpen(false)
        onAutoTitle()
      },
    },
    {
      label: 'Export as Markdown',
      icon: Download,
      disabled: messages.length === 0,
      onClick: () => {
        setOpen(false)
        download(`${slug}.md`, toMarkdown(title, messages), 'text/markdown')
      },
    },
    {
      label: 'Export as JSON',
      icon: Download,
      disabled: messages.length === 0,
      onClick: () => {
        setOpen(false)
        download(
          `${slug}.json`,
          JSON.stringify({ title, exported_at: new Date().toISOString(), messages }, null, 2),
          'application/json',
        )
      },
    },
    {
      label: incognito ? 'Turn off incognito' : 'Incognito chat',
      icon: Shield,
      active: incognito,
      onClick: () => {
        setOpen(false)
        onToggleIncognito()
      },
    },
  ]

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`rounded-lg border border-neutral-200 p-1.5 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800 ${
          open ? 'bg-neutral-100 dark:bg-neutral-800' : ''
        }`}
        aria-label="Chat actions"
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
          {items.map(({ label, icon: Icon, onClick, disabled, active }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={disabled}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition disabled:opacity-40 ${
                active
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ChatWindow({
  title,
  chatId,
  messages,
  streaming,
  error,
  stopReason,
  onDismissError,
  onSend,
  onStop,
  onOpenSidebar,
  model,
  modelCaps,
  onModelChange,
  chatSettings,
  onSaveChatSettings,
  defaultModel,
  displayName,
  onRegenerate,
  onEdit,
  onDelete,
  onContinue,
  onAutoTitle,
  onToggleIncognito,
  incognito,
  busy,
  searchMode,
  onSearchModeChange,
}) {
  const scrollRef = useRef(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [artifact, setArtifact] = useState(null)

  // Close the panel when the chat changes.
  useEffect(() => {
    setArtifact(null)
  }, [chatId])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  const last = messages[messages.length - 1]
  const canContinue =
    !streaming &&
    !busy &&
    !!stopReason &&
    last?.role === 'assistant' &&
    !!last.content

  return (
    <div className="flex h-full min-w-0">
      <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="relative flex items-center gap-3 px-4 py-3 md:px-6">
        <button
          onClick={onOpenSidebar}
          className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-50 md:hidden dark:hover:bg-neutral-800"
          aria-label="Open sidebar"
        >
          <Menu size={18} />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>

        <div className="flex shrink-0 items-center gap-1.5">
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
          <ChatMenu
            title={title}
            messages={messages}
            incognito={incognito}
            busy={busy}
            onAutoTitle={onAutoTitle}
            onToggleIncognito={onToggleIncognito}
          />
        </div>
      </header>

      {incognito && (
        <div className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <Shield size={12} />
          Incognito - this conversation is not being saved.
        </div>
      )}

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
            <div className="flex min-h-[55vh] flex-col items-center justify-center gap-4 text-center">
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-lg font-bold text-white dark:bg-white dark:text-neutral-900">
                  O
                </div>
                <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
                  {timeGreeting()}{displayName ? `, ${displayName}` : ''}
                </h1>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Ask anything to get started.
                </p>
              </div>
              <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    disabled={busy || streaming}
                    onClick={() => onSend(s.prompt, [])}
                    className="group flex items-start gap-3 rounded-2xl border border-neutral-200 bg-white p-3 text-left transition hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-60 sm:flex-col sm:gap-2 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-500 dark:hover:bg-neutral-800"
                  >
                    <s.icon size={16} className="mt-0.5 shrink-0 text-neutral-500 group-hover:text-neutral-800 sm:mt-0 dark:text-neutral-400 dark:group-hover:text-neutral-100" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{s.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-neutral-500 dark:text-neutral-400">{s.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <Message
                key={message.id}
                message={message}
                streaming={streaming && index === messages.length - 1}
                busy={busy}
                onRegenerate={onRegenerate}
                onEdit={onEdit}
                onDelete={onDelete}
                onOpenArtifact={setArtifact}
              />
            ))
          )}
        </div>
      </div>

      {/* Composer: no hard divider — messages fade out behind the input, Claude-style */}
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-7 -translate-y-full bg-gradient-to-t from-neutral-50 to-transparent dark:from-neutral-950"
        />
        <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-5 md:px-6">
          {canContinue && (
            <div className="mb-2 flex justify-center">
              <button
                onClick={onContinue}
                className="flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-4 py-2 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
              >
                Continue
              </button>
            </div>
          )}
          <ChatInput
            streaming={streaming}
            onSend={onSend}
            onStop={onStop}
            onDraftChange={setDraft}
            chatId={chatId}
            searchMode={searchMode}
            onSearchModeChange={onSearchModeChange}
            model={model}
            modelCaps={modelCaps}
            onModelChange={onModelChange}
            defaultModel={defaultModel}
          />
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-neutral-400">
            <span className="truncate">Local app · your chats stay on this computer</span>
            <span className="shrink-0" title="Approximate token count of your draft">
              {estimateTokens(draft) > 0 ? `≈ ${estimateTokens(draft)} tokens` : 'Ctrl+Enter to send'}
            </span>
          </div>
        </div>
      </div>
      </div>

      {artifact && <ArtifactPanel artifact={artifact} onClose={() => setArtifact(null)} />}
    </div>
  )
}
