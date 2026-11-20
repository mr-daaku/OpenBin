import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Cpu, Loader2, Pin, Search } from 'lucide-react'
import { api } from '../api.js'

// Model selector that lives in the input bar, right of the search-mode
// button. The dropdown opens UPWARD so it is never clipped by the bottom
// of the screen. Pinned models of the active provider are listed first.
// Shows capability badges (vision, image_gen, tools, reasoning) and filter chips.
export default function ModelPicker({ model, onPick, defaultModel }) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState([])
  const [pinned, setPinned] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const [filter, setFilter] = useState('all') // all | chat | vision | image
  const [activeProviderId, setActiveProviderId] = useState(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Pinned models + model list with capabilities from the active provider.
  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const providers = await api.listProviders()
      const active = providers.find((p) => p.is_active) || providers[0]
      if (!active) { setModels([]); setPinned([]); setActiveProviderId(null); setLoading(false); return }
      setActiveProviderId(active.id)
      setPinned(active?.pinned || [])
      const data = await api.providerModels(active.id)
      setModels(data.models || [])
      setError(data.error)
    } catch (err) {
      setModels([])
      setPinned([])
      setActiveProviderId(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (!next) return
    setQuery('')
    setFilter('all')
    if (models.length === 0 && !loading) load()
    else load() // always refresh to get latest caps
  }

  const q = query.trim().toLowerCase()
  let visible = models.filter((m) => !q || m.id.toLowerCase().includes(q))
  // Filter by capability
  if (filter === 'chat') visible = visible.filter((m) => !m.image_gen)
  else if (filter === 'vision') visible = visible.filter((m) => m.vision)
  else if (filter === 'image') visible = visible.filter((m) => m.image_gen)
  const pinnedVisible = visible.filter((m) => pinned.includes(m.id))
  const restVisible = visible.filter((m) => !pinned.includes(m.id))
  // A manually typed id is not in the provider list - show it on its own so
  // the current choice is always visible.
  const orphan = model && !models.some((m) => m.id === model) ? [{ id: model, vision: 0, image_gen: 0, tools: 1, reasoning: 0, source: 'auto', vision_state: 'unknown' }] : []

  const choose = (name) => {
    onPick(name)
    setOpen(false)
  }

  const isImageGenOnly = (m) => m.image_gen && !m.vision && !m.tools

  const CapBadge = ({ label, value, source }) => (
    <span
      className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium shrink-0 ${
        value
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500'
      }`}
      title={source === 'manual' ? 'Manual override' : 'Auto-detected'}
    >
      {label}
      {source === 'manual' && <span className="text-[8px]">●</span>}
    </span>
  )

  const row = (m, showSelect = true) => {
    const disabled = isImageGenOnly(m)
    return (
      <button
        key={m.id}
        onClick={() => !disabled && choose(m.id)}
        disabled={disabled}
        title={disabled ? 'Image generation model — use in Image mode' : m.id}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
          disabled
            ? 'border-amber-300 bg-amber-50 opacity-60 text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400'
            : m.id === model
            ? 'bg-neutral-100 font-medium dark:bg-neutral-800'
            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
        }`}
      >
        <span className="min-w-0 flex-1 truncate font-mono">{m.id}</span>
        <div className="flex items-center gap-0.5 shrink-0">
          <CapBadge label="👁" value={m.vision} source={m.source} />
          <CapBadge label="🖼" value={m.image_gen} source={m.source} />
          <CapBadge label="🔧" value={m.tools} source={m.source} />
          <CapBadge label="🧠" value={m.reasoning} source={m.source} />
        </div>
        {showSelect && !disabled && m.id === model && <span className="shrink-0 text-green-600 dark:text-green-400">✓</span>}
        {disabled && <span className="shrink-0 text-[9px] text-amber-600 dark:text-amber-400">Image mode</span>}
      </button>
    )
  }

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
          className="absolute bottom-full left-0 z-50 mb-2 w-88 max-w-[calc(100vw-2rem)] rounded-xl border border-neutral-200 bg-white p-2 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
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

          {/* Filter chips */}
          <div className="flex gap-1.5 flex-wrap mb-1.5">
            {['all', 'chat', 'vision', 'image'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                  filter === f
                    ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
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
                {orphan.map((m) => row(m, false))}
              </>
            )}

            {!loading && pinnedVisible.length > 0 && (
              <>
                {groupLabel('Pinned', <Pin size={10} />)}
                {pinnedVisible.map((m) => row(m))}
              </>
            )}

            {!loading && restVisible.length > 0 && (
              <>
                {pinnedVisible.length > 0 && groupLabel('All models')}
                {restVisible.map((m) => row(m))}
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