import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Brain, ChevronDown, FileText, Globe, GlobeOff, Loader2, Paperclip, Square, Telescope, X, AlertTriangle } from 'lucide-react'
import { api } from '../api.js'
import ModelPicker from './ModelPicker.jsx'

// The four web-search modes. Auto is the default: the model (or the router
// fallback when it has no tool support) decides whether a search is needed.
export const SEARCH_MODES = [
  { id: 'off', label: 'Off', icon: GlobeOff, hint: 'Never use the web' },
  { id: 'auto', label: 'Auto', icon: Brain, hint: 'AI decides when to search' },
  { id: 'always', label: 'Always', icon: Globe, hint: 'Search the web for every message' },
  { id: 'research', label: 'Deep Research', icon: Telescope, hint: 'Multi-step research report' },
]

export const DEFAULT_SEARCH_MODE = 'auto'

// Rough local estimate, no tokenizer downloaded: ~4 chars per token.
export function estimateTokens(text) {
  const t = String(text || '')
  if (!t.trim()) return 0
  return Math.max(1, Math.ceil(t.length / 4))
}

const ACCEPT = 'image/*,.pdf,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.cs,.go,.rs,.rb,.php,.sh,.bat,.ps1,.sql,.yaml,.yml,.toml,.ini,.cfg,.log,.srt'

export default function ChatInput({
  streaming,
  onSend,
  onStop,
  onDraftChange,
  chatId,
  searchMode = DEFAULT_SEARCH_MODE,
  onSearchModeChange,
  model,
  modelCaps = {},
  onModelChange,
  defaultModel,
}) {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState([]) // {key, id, name, kind, url, uploading}
  const [modeOpen, setModeOpen] = useState(false)
  const [visionWarn, setVisionWarn] = useState(false)
  const ref = useRef(null)
  const fileRef = useRef(null)
  const modeRef = useRef(null)
  const keyRef = useRef(0)

  const hasVision = !!modelCaps.vision
  const isImageGenOnly = !!modelCaps.image_gen && !modelCaps.vision && !modelCaps.tools

  // Auto-grow (up to a comfortable cap) and keep focus after each send.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    if (!streaming) el.focus()
  }, [value, streaming])

  // Close the search-mode menu when clicking anywhere else.
  useEffect(() => {
    if (!modeOpen) return
    const onDown = (e) => {
      if (modeRef.current && !modeRef.current.contains(e.target)) setModeOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [modeOpen])

  const change = (e) => {
    setValue(e.target.value)
    onDraftChange?.(e.target.value)
  }

  // Resize image in browser to max 1568px longest side, JPEG 0.85 quality
  const resizeImage = (file) => {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) { resolve(file); return }
      const img = new Image()
      img.onload = () => {
        const MAX = 1568
        let { width, height } = img
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX }
          else { width = Math.round(width * MAX / height); height = MAX }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob((blob) => {
          resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }))
        }, 'image/jpeg', 0.85)
      }
      img.src = URL.createObjectURL(file)
    })
  }

  const addFiles = async (list) => {
    for (const file of Array.from(list || [])) {
      const isImage = file.type.startsWith('image/')
      // Vision gating: block image if model has no vision (and is not image-gen only)
      if (isImage && !hasVision && !isImageGenOnly) {
        setVisionWarn(true)
        setTimeout(() => setVisionWarn(false), 4000)
        continue
      }
      const processedFile = isImage ? await resizeImage(file) : file
      const key = ++keyRef.current
      setFiles((prev) => [...prev, { key, id: null, name: processedFile.name, kind: isImage ? 'image' : 'file', url: null, uploading: true }])
      try {
        const up = await api.uploadFile(processedFile, chatId)
        setFiles((prev) =>
          prev.map((f) => (f.key === key ? { ...f, id: up.id, name: up.name, kind: up.kind, url: up.url, uploading: false } : f)),
        )
      } catch (err) {
        setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, uploading: false, error: err.message } : f)))
      }
    }
  }

  const removeFile = (key) => setFiles((prev) => prev.filter((f) => f.key !== key))

  const onPaste = (e) => {
    const items = e.clipboardData?.files
    if (items?.length) {
      e.preventDefault()
      addFiles(items)
    }
  }

  const uploading = files.some((f) => f.uploading)
  const failed = files.some((f) => f.error)
  const ready = files.filter((f) => f.id && !f.error)

  const submit = () => {
    const text = value.trim()
    if (streaming || uploading) return
    if (!text && ready.length === 0) return
    if (failed) return
    onSend(text, ready.map((f) => ({ id: f.id, name: f.name, kind: f.kind, url: f.url })))
    setValue('')
    onDraftChange?.('')
    setFiles([])
  }

  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    if (e.shiftKey && !e.ctrlKey && !e.metaKey) return // Shift+Enter = newline
    e.preventDefault()
    submit()
  }

  const canSend = (!!value.trim() || ready.length > 0) && !uploading && !failed

  const currentMode = SEARCH_MODES.find((m) => m.id === searchMode) || SEARCH_MODES[1]
  const CurrentIcon = currentMode.icon

  return (
    <div className="rounded-3xl border border-neutral-300 bg-white p-2 shadow-sm transition focus-within:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-within:border-neutral-500">
      {visionWarn && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" role="alert">
          <AlertTriangle size={14} className="shrink-0" />
          <span>This model doesn't support images. Switch to a vision model or remove the image.</span>
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-2 pt-1 pb-2">
          {files.map((f) => (
            <div
              key={f.key}
              className={`relative flex max-w-[220px] items-center gap-2 rounded-xl border px-2 py-1.5 text-xs ${
                f.error
                  ? 'border-red-300 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/40'
                  : 'border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800'
              }`}
              title={f.error || f.name}
            >
              {f.kind === 'image' && f.url ? (
                <img src={f.url} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" />
              ) : (
                <FileText size={15} className="shrink-0 opacity-60" />
              )}
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              {f.uploading ? (
                <Loader2 size={13} className="shrink-0 animate-spin opacity-60" />
              ) : (
                <button
                  onClick={() => removeFile(f.key)}
                  className="shrink-0 rounded p-0.5 hover:bg-neutral-300 dark:hover:bg-neutral-700"
                  aria-label={`Remove ${f.name}`}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="mb-1 shrink-0 rounded-full p-2 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          aria-label="Attach a file"
          title="Attach file (image, PDF, text)"
          disabled={streaming}
        >
          <Paperclip size={17} />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <div className="relative mb-1 shrink-0" ref={modeRef}>
          <button
            onClick={() => setModeOpen((v) => !v)}
            className="flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-1.5 text-[11px] font-medium text-neutral-500 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            title={`Web search: ${currentMode.hint}`}
            aria-label={`Web search mode: ${currentMode.label}`}
            aria-haspopup="menu"
            aria-expanded={modeOpen}
          >
            <CurrentIcon size={13} />
            <span className="hidden sm:inline">{currentMode.label}</span>
            <ChevronDown size={12} className={`transition ${modeOpen ? 'rotate-180' : ''}`} />
          </button>
          {modeOpen && (
            <div
              className="absolute bottom-full left-0 z-40 mb-2 w-60 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
              role="menu"
            >
              {SEARCH_MODES.map(({ id, label, icon: Icon, hint }) => (
                <button
                  key={id}
                  role="menuitemradio"
                  aria-checked={searchMode === id}
                  onClick={() => {
                    onSearchModeChange?.(id)
                    setModeOpen(false)
                  }}
                  className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                    searchMode === id
                      ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                      : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`}
                >
                  <Icon size={14} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">{label}</span>
                    <span
                      className={`block text-[10px] leading-4 ${
                        searchMode === id ? 'opacity-70' : 'text-neutral-400 dark:text-neutral-500'
                      }`}
                    >
                      {hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <ModelPicker model={model} onPick={onModelChange} defaultModel={defaultModel} />
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={change}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="Message OpenBin"
          className="scroll-slim max-h-[200px] min-h-[40px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-6 outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
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
            disabled={!canSend}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            aria-label="Send message"
            title="Send"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </div>
  )
}
