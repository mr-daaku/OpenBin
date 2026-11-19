import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Cpu, Loader2, Pin, Search } from 'lucide-react'
import { api } from '../api.js'

// Model selector that lives in the input bar, right of the search-mode
// button. The dropdown opens UPWARD so it is never clipped by the bottom
// of the screen. Pinned models of the active provider are listed first.
export default function ModelPicker({ model, onPick, defaultModel }) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState([])
  const [pinned, setPinned] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Pinned models come from the local providers table - cheap, so refresh
  // on every open. The model list hits the provider, so it is cached.
  const refreshPinned = async () => {
    try {
      const providers = await api.listProviders()
      const active = providers.find((p) => p.is_active) || providers[0]
      setPinned(active?.pinned || [])
    } catch {
      /* pinning is a nicety - the list still works without it */
    }
  }

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
    refreshPinned()
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (!next) return
    setQuery('')
    if (models.length === 0 && !loading) load()
    else refreshPinned()
  }

  const q = query.trim().toLowerCase()
  const visible = models.filter((m) => !q || m.toLowerCase().includes(q))
  const pinnedVisible = visible.filter((m) => pinned.includes(m))
  const restVisible = visible.filter((m) => !pinned.includes(m))
  // A manually typed id is not in the provider list - show it on its own so
  // the current choice is always visible.
  const orphan = model && !models.includes(model) ? [model] : []

  const choose = (name) => {
    onPick(name)
    setOpen(false)
  }

  const row = (name, trailing = null) => (
    <button
      key={name}
      onClick={() => choose(name)}
      title={name}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
        name === model
          ? 'bg-neutral-100 font-medium dark:bg-neutral-800'
          : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
      }`}
    >
      <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
      {trailing}
      {name === model && <span className="shrink-0 text-green-600 dark:text-green-400">✓</span>}
    </button>
  )

  const groupLabel = (text, icon) => (
    <p className="flex items-center gap-1 px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
      {icon}
      {text}
    </p>
  )

  return (
    <div className="relative mb-1 shrink-0" ref={wrapRef}>
      <button
        onClick={toggle}
        className="flex max-w-[34vw] items-center gap-1.5 rounded-full border border-neutral-200 px-2 py-1.5 text-[11px] font-medium text-neutral-500 transition hover:bg-neutral-100 sm:max-w-[26vw] dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
        title={`Model: ${model || 'none'} — click to change`}
        aria-label={`Model: ${model || 'none'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Cpu size={13} className="shrink-0" />
        <span className="min-w-0 truncate font-mono">{model || 'model'}</span>
        <ChevronDown size={12} className={`shrink-0 opacity-60 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 z-50 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-neutral-200 bg-white p-2 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
          role="listbox"
        >
          <div className="relative mb-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              className="w-full rounded-lg border border-neutral-300 bg-transparent py-1.5 pl-8 pr-2 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700"
            />
          </div>

          <div className="scroll-slim max-h-60 overflow-y-auto">
            {loading && (
              <p className="flex items-center gap-2 px-2 py-3 text-xs text-neutral-500 dark:text-neutral-400">
                <Loader2 size={13} className="animate-spin" /> Loading models…
              </p>
            )}
            {!loading && error && (
              <p className="px-2 py-3 text-xs break-words text-amber-600 dark:text-amber-400">{error}</p>
            )}
            {!loading && !error && visible.length === 0 && orphan.length === 0 && (
              <p className="px-2 py-3 text-xs text-neutral-400">No models match.</p>
            )}

            {!loading && orphan.length > 0 && (
              <>
                {groupLabel('Current')}
                {orphan.map((name) => row(name))}
              </>
            )}

            {!loading && pinnedVisible.length > 0 && (
              <>
                {groupLabel('Pinned', <Pin size={10} />)}
                {pinnedVisible.map((name) => row(name))}
              </>
            )}

            {!loading && restVisible.length > 0 && (
              <>
                {pinnedVisible.length > 0 && groupLabel('All models')}
                {restVisible.map((name) => row(name))}
              </>
            )}
          </div>

          <div className="mt-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const v = manual.trim()
                if (v) {
                  setManual('')
                  choose(v)
                }
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
              className="mt-1.5 w-full truncate rounded-lg px-2 py-1.5 text-left text-[11px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              title={`Reset to default (${defaultModel})`}
            >
              Reset to default ({defaultModel})
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
