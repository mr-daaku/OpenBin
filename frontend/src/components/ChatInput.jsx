import { useEffect, useRef, useState } from 'react'
import { ArrowUp, FileText, Loader2, Paperclip, Square, X } from 'lucide-react'
import { api } from '../api.js'

// Rough local estimate, no tokenizer downloaded: ~4 chars per token.
export function estimateTokens(text) {
  const t = String(text || '')
  if (!t.trim()) return 0
  return Math.max(1, Math.ceil(t.length / 4))
}

const ACCEPT = 'image/*,.pdf,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.cs,.go,.rs,.rb,.php,.sh,.bat,.ps1,.sql,.yaml,.yml,.toml,.ini,.cfg,.log,.srt'

export default function ChatInput({ streaming, onSend, onStop, onDraftChange, chatId }) {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState([]) // {key, id, name, kind, url, uploading}
  const ref = useRef(null)
  const fileRef = useRef(null)
  const keyRef = useRef(0)

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

  const addFiles = async (list) => {
    for (const file of Array.from(list || [])) {
      const key = ++keyRef.current
      setFiles((prev) => [...prev, { key, id: null, name: file.name, kind: 'file', url: null, uploading: true }])
      try {
        const up = await api.uploadFile(file, chatId)
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

  return (
    <div className="rounded-3xl border border-neutral-300 bg-white p-2 shadow-sm transition focus-within:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-within:border-neutral-500">
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
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={change}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
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
