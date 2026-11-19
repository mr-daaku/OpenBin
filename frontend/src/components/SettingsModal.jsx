import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, Loader2, Moon, Pin, PinOff, Search, Sun, Trash2, X, Zap, Plus } from 'lucide-react'
import { api } from '../api.js'

const EMPTY = {
  api_key: '',
  base_url: 'https://integrate.api.nvidia.com/v1',
  model: 'meta/llama-3.1-8b-instruct',
  system_prompt: '',
  temperature: 0.7,
  max_tokens: 1024,
  history_limit: 12,
  theme: 'dark',
  search_provider: 'gradio',
  search_space: '',
  search_key: '',
  search_tavily_key: '',
  search_custom_url: '',
  search_custom_key: '',
}

const PRESETS = [
  ['nvidia', 'NVIDIA NIM', 'https://integrate.api.nvidia.com/v1'],
  ['openai', 'OpenAI', 'https://api.openai.com/v1'],
  ['openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1'],
  ['groq', 'Groq', 'https://api.groq.com/openai/v1'],
  ['anthropic', 'Anthropic-compatible', 'https://api.anthropic.com/v1'],
  ['custom', 'Custom', ''],
]

const BLANK_PROVIDER = { id: null, name: '', preset: 'custom', base_url: '', api_key: '' }

function Label({ children, hint }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label className="text-[13px] font-medium">{children}</label>
      {hint && <span className="text-[11px] text-neutral-400">{hint}</span>}
    </div>
  )
}

const inputClass =
  'w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800'

const SectionTitle = ({ children }) => (
  <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
    {children}
  </h3>
)

export default function SettingsModal({ settings, onClose, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY, ...settings })
  const [showKey, setShowKey] = useState(false)
  const [providers, setProviders] = useState([])
  const [editing, setEditing] = useState(null) // provider draft being edited
  const [isNew, setIsNew] = useState(false)
  const [models, setModels] = useState([])
  const [modelsError, setModelsError] = useState(null)
  const [modelSearch, setModelSearch] = useState('')
  const [showModels, setShowModels] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [busy, setBusy] = useState(null) // 'test' | 'save' | 'models' | 'provider' | 'activate' | null
  const [searchQuery, setSearchQuery] = useState('latest AI news')
  const [fetchUrl, setFetchUrl] = useState('')
  const [searchTest, setSearchTest] = useState(null)
  const [searchBusy, setSearchBusy] = useState(null) // 'search' | 'fetch' | null

  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }))
  const setEdit = (name) => (e) => setEditing((p) => ({ ...p, [name]: e.target.value }))

  const refreshProviders = async (preferId) => {
    const rows = await api.listProviders()
    setProviders(rows)
    const wanted = preferId ?? settings.active_provider_id ?? rows[0]?.id
    const hit = rows.find((r) => r.id === wanted) || rows.find((r) => r.is_active) || rows[0]
    if (hit) {
      setEditing({ id: hit.id, name: hit.name, preset: hit.preset, base_url: hit.base_url, api_key: '' })
      setIsNew(false)
    }
    return rows
  }

  const loadModels = async (providerId) => {
    if (providerId == null) return
    setBusy('models')
    setModelsError(null)
    try {
      const data = await api.providerModels(providerId)
      setModels(data.models || [])
      setModelsError(data.error)
      setShowModels(true)
    } catch (err) {
      setModels([])
      setModelsError(err.message)
      setShowModels(true)
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const rows = await api.listProviders()
        if (!alive) return
        setProviders(rows)
        const hit = rows.find((r) => r.id === settings.active_provider_id) || rows.find((r) => r.is_active) || rows[0]
        if (hit) {
          setEditing({ id: hit.id, name: hit.name, preset: hit.preset, base_url: hit.base_url, api_key: '' })
          const data = await api.providerModels(hit.id)
          if (!alive) return
          setModels(data.models || [])
          setModelsError(data.error)
          setShowModels(true)
        }
      } catch (err) {
        if (alive) setModelsError(err.message)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const payload = () => ({
    api_key: form.api_key,
    base_url: form.base_url,
    model: form.model,
    system_prompt: form.system_prompt,
    temperature: Number(form.temperature),
    max_tokens: Number(form.max_tokens),
    history_limit: Number(form.history_limit),
    theme: form.theme,
    search_provider: form.search_provider,
    search_space: form.search_space,
    search_key: form.search_key,
    search_tavily_key: form.search_tavily_key,
    search_custom_url: form.search_custom_url,
    search_custom_key: form.search_custom_key,
  })

  const runSearchTest = async () => {
    setSearchBusy('search')
    setSearchTest(null)
    try {
      setSearchTest(await api.testSearch(searchQuery))
    } catch (err) {
      setSearchTest({ ok: false, error: err.message })
    } finally {
      setSearchBusy(null)
    }
  }

  const runFetchTest = async () => {
    const url = fetchUrl.trim()
    if (!url) {
      setSearchTest({ ok: false, error: 'Enter a page URL first, e.g. https://example.com' })
      return
    }
    setSearchBusy('fetch')
    setSearchTest(null)
    try {
      setSearchTest(await api.testFetch(url))
    } catch (err) {
      setSearchTest({ ok: false, error: err.message })
    } finally {
      setSearchBusy(null)
    }
  }

  const test = async () => {
    if (!editing?.id) return
    setBusy('test')
    setTestResult(null)
    try {
      const res = await api.testProvider(editing.id, {
        api_key: editing.api_key,
        base_url: editing.base_url,
        model: form.model,
      })
      setTestResult(res)
    } catch (err) {
      setTestResult({ ok: false, error: err.message })
    } finally {
      setBusy(null)
    }
  }

  const saveProvider = async () => {
    if (!editing) return
    setBusy('provider')
    setTestResult(null)
    try {
      const body = {
        name: editing.name,
        preset: editing.preset,
        base_url: editing.base_url,
        api_key: editing.api_key,
      }
      const saved = isNew ? await api.createProvider(body) : await api.updateProvider(editing.id, body)
      await refreshProviders(saved.id)
      setIsNew(false)
      setForm((f) => ({ ...f, base_url: saved.base_url || f.base_url }))
      setTestResult({ ok: true, message: isNew ? 'Provider added.' : 'Provider saved.' })
      await loadModels(saved.id)
    } catch (err) {
      setTestResult({ ok: false, error: err.message })
    } finally {
      setBusy(null)
    }
  }

  const activate = async (id) => {
    setBusy('activate')
    setTestResult(null)
    try {
      await api.activateProvider(id)
      const st = await api.getSettings()
      setForm((f) => ({ ...f, base_url: st.base_url, api_key: '' }))
      await refreshProviders(id)
      await loadModels(id)
      onSaved(st, { keepOpen: true })
    } catch (err) {
      setTestResult({ ok: false, error: err.message })
    } finally {
      setBusy(null)
    }
  }

  const removeProvider = async (id) => {
    if (!window.confirm('Delete this provider profile?')) return
    try {
      await api.deleteProvider(id)
      const rows = await refreshProviders(null)
      const next = rows[0]
      if (next) await loadModels(next.id)
    } catch (err) {
      setTestResult({ ok: false, error: err.message })
    }
  }

  const startNew = () => {
    setEditing({ ...BLANK_PROVIDER })
    setIsNew(true)
    setTestResult(null)
  }

  const onPreset = (e) => {
    const preset = e.target.value
    const found = PRESETS.find((p) => p[0] === preset)
    setEditing((p) => ({
      ...p,
      preset,
      name: isNew && (!p.name || PRESETS.some((x) => x[1] === p.name)) ? found[1] : p.name,
      base_url: isNew && (!p.base_url || PRESETS.some((x) => x[2] === p.base_url)) ? found[2] : p.base_url,
    }))
  }

  const save = async () => {
    setBusy('save')
    setTestResult(null)
    try {
      const saved = await api.saveSettings(payload())
      onSaved(saved)
    } catch (err) {
      setTestResult({ ok: false, error: err.message })
      setBusy(null)
    }
  }

  const togglePin = async (name) => {
    if (!editing?.id) return
    try {
      const res = await api.togglePinned(editing.id, name)
      setProviders((rows) => rows.map((r) => (r.id === editing.id ? { ...r, pinned: res.pinned_models } : r)))
    } catch {
      /* pinning is cosmetic - ignore failures */
    }
  }

  const activePinned = providers.find((r) => r.id === editing?.id)?.pinned || []
  const query = modelSearch.trim().toLowerCase()
  const visibleModels = models
    .filter((m) => !query || m.toLowerCase().includes(query))
    .sort((a, b) => {
      const pa = activePinned.includes(a) ? 0 : 1
      const pb = activePinned.includes(b) ? 0 : 1
      return pa - pb || a.localeCompare(b)
    })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="scroll-slim max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label="Close settings">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          {/* ------------------------------------------------ providers */}
          <div>
            <SectionTitle>Providers</SectionTitle>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {providers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setEditing({ id: p.id, name: p.name, preset: p.preset, base_url: p.base_url, api_key: '' })
                    setIsNew(false)
                    setTestResult(null)
                  }}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                    editing?.id === p.id && !isNew
                      ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                      : 'border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
                  }`}
                >
                  {p.name}
                  {p.is_active && <span className="ml-1 opacity-60">•</span>}
                </button>
              ))}
              <button
                onClick={startNew}
                className="flex items-center gap-1 rounded-lg border border-dashed border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
              >
                <Plus size={12} /> New
              </button>
            </div>

            {editing && (
              <div className="space-y-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Name</Label>
                    <input type="text" value={editing.name} onChange={setEdit('name')} className={inputClass} />
                  </div>
                  <div>
                    <Label>Preset</Label>
                    <select value={editing.preset} onChange={onPreset} className={inputClass}>
                      {PRESETS.map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <Label>Base URL</Label>
                  <input type="text" value={editing.base_url} onChange={setEdit('base_url')} placeholder="https://…/v1" className={`${inputClass} font-mono`} />
                </div>

                <div>
                  <Label hint={editing.id && !editing.api_key ? 'saved' : undefined}>API key</Label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={editing.api_key}
                      onChange={setEdit('api_key')}
                      placeholder={editing.id ? 'leave blank to keep the saved key' : 'paste key…'}
                      autoComplete="off"
                      className={`${inputClass} pr-10 font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                      aria-label={showKey ? 'Hide key' : 'Show key'}
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={saveProvider}
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 rounded-xl bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                  >
                    {busy === 'provider' && <Loader2 size={13} className="animate-spin" />}
                    {isNew ? 'Add provider' : 'Save provider'}
                  </button>
                  <button
                    onClick={() => loadModels(editing.id)}
                    disabled={busy !== null || !editing.id}
                    className="flex items-center gap-1.5 rounded-xl border border-neutral-300 px-3 py-2 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    {busy === 'models' ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                    Load Models
                  </button>
                  <button
                    onClick={test}
                    disabled={busy !== null || !editing.id}
                    className="flex items-center gap-1.5 rounded-xl border border-neutral-300 px-3 py-2 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    {busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                    Test
                  </button>
                  {!isNew && editing.id && (
                    <button
                      onClick={() => removeProvider(editing.id)}
                      disabled={busy !== null}
                      className="ml-auto rounded-xl p-2 text-neutral-400 hover:text-red-500 disabled:opacity-50"
                      aria-label="Delete provider"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                {!isNew && editing.id && !providers.find((p) => p.id === editing.id)?.is_active && (
                  <button
                    onClick={() => activate(editing.id)}
                    disabled={busy !== null}
                    className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    {busy === 'activate' ? 'Switching…' : 'Make this the active provider'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ------------------------------------------------ model */}
          <div>
            <SectionTitle>Default model</SectionTitle>
            <div className="relative mb-2">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="Search models…"
                className={`${inputClass} pl-8`}
              />
            </div>

            {modelsError && <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">{modelsError}</p>}

            {showModels && visibleModels.length > 0 && (
              <div className="scroll-slim mb-2 max-h-44 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
                {visibleModels.map((name) => (
                  <div
                    key={name}
                    className={`flex items-center gap-2 border-b border-neutral-100 px-2 py-1.5 last:border-0 dark:border-neutral-800/60 ${
                      form.model === name ? 'bg-neutral-100 dark:bg-neutral-800' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                    }`}
                  >
                    <button
                      onClick={() => setForm((f) => ({ ...f, model: name }))}
                      className="min-w-0 flex-1 truncate text-left font-mono text-xs"
                      title={name}
                    >
                      {name}
                      {form.model === name && <Check size={12} className="ml-1.5 inline text-green-600 dark:text-green-400" />}
                    </button>
                    <button
                      onClick={() => togglePin(name)}
                      className="rounded p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                      aria-label={activePinned.includes(name) ? 'Unpin model' : 'Pin model'}
                    >
                      {activePinned.includes(name) ? <Pin size={13} /> : <PinOff size={13} />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              type="text"
              value={form.model}
              onChange={set('model')}
              placeholder="or type a model id"
              className={`${inputClass} font-mono`}
            />
            {models.length > 0 && form.model && !models.includes(form.model) && (
              <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                Not in the loaded list — it will still be sent as-is.
              </p>
            )}
          </div>

          {/* ------------------------------------------------ web search */}
          <div>
            <SectionTitle>Web search</SectionTitle>
            <div className="space-y-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <div>
                <Label>Provider</Label>
                <select value={form.search_provider} onChange={set('search_provider')} className={inputClass}>
                  <option value="gradio">Gradio search space</option>
                  <option value="tavily">Tavily</option>
                  <option value="custom">Custom search API</option>
                </select>
              </div>

              {form.search_provider === 'gradio' && (
                <>
                  <div>
                    <Label hint="owner/space-name">Space</Label>
                    <input
                      type="text"
                      value={form.search_space}
                      onChange={set('search_space')}
                      placeholder="mrdaaku/search-api"
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                  <div>
                    <Label hint={form.search_key.includes('****') ? 'saved' : undefined}>API key</Label>
                    <input
                      type="password"
                      value={form.search_key}
                      onChange={set('search_key')}
                      placeholder="paste the space key…"
                      autoComplete="off"
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                </>
              )}

              {form.search_provider === 'tavily' && (
                <div>
                  <Label hint={form.search_tavily_key.includes('****') ? 'saved' : undefined}>Tavily API key</Label>
                  <input
                    type="password"
                    value={form.search_tavily_key}
                    onChange={set('search_tavily_key')}
                    placeholder="tvly-…"
                    autoComplete="off"
                    className={`${inputClass} font-mono`}
                  />
                </div>
              )}

              {form.search_provider === 'custom' && (
                <>
                  <div>
                    <Label hint="GET {url}/search?q=…">Base URL</Label>
                    <input
                      type="text"
                      value={form.search_custom_url}
                      onChange={set('search_custom_url')}
                      placeholder="https://your-search-api.example"
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                  <div>
                    <Label hint={form.search_custom_key.includes('****') ? 'saved' : undefined}>API key</Label>
                    <input
                      type="password"
                      value={form.search_custom_key}
                      onChange={set('search_custom_key')}
                      placeholder="optional"
                      autoComplete="off"
                      className={`${inputClass} font-mono`}
                    />
                  </div>
                </>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearchTest()}
                  placeholder="Test query"
                  className={`${inputClass} min-w-0 flex-1`}
                />
                <button
                  onClick={runSearchTest}
                  disabled={searchBusy !== null}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-neutral-300 px-3 py-2.5 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  {searchBusy === 'search' && <Loader2 size={13} className="animate-spin" />}
                  Test search
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={fetchUrl}
                  onChange={(e) => setFetchUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runFetchTest()}
                  placeholder="https://example.com"
                  className={`${inputClass} min-w-0 flex-1 font-mono`}
                />
                <button
                  onClick={runFetchTest}
                  disabled={searchBusy !== null}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-neutral-300 px-3 py-2.5 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  {searchBusy === 'fetch' && <Loader2 size={13} className="animate-spin" />}
                  Test page fetch
                </button>
              </div>

              {searchTest && (
                <div
                  className={`rounded-xl px-3 py-2.5 text-xs ${
                    searchTest.ok
                      ? 'bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300'
                      : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                  }`}
                >
                  {searchTest.ok ? (
                    <div className="space-y-1">
                      {Array.isArray(searchTest.results) && (
                        <>
                          <p className="font-medium">
                            Search works{searchTest.provider ? ` · ${searchTest.provider}` : ''} (
                            {searchTest.results.length} results)
                          </p>
                          {searchTest.results.slice(0, 3).map((r) => (
                            <p key={r.url} className="truncate" title={r.title}>
                              • {r.title}
                            </p>
                          ))}
                        </>
                      )}
                      {typeof searchTest.text === 'string' && (
                        <>
                          <p className="font-medium">
                            Read {searchTest.host} · {searchTest.chars} chars · {searchTest.title}
                          </p>
                          <p className="line-clamp-4 whitespace-pre-wrap text-[11px] opacity-80">
                            {searchTest.text.slice(0, 400)}
                          </p>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{searchTest.error}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ------------------------------------------------ prompt + params */}
          <div>
            <Label hint="default included">System prompt</Label>
            <textarea
              value={form.system_prompt}
              onChange={set('system_prompt')}
              rows={4}
              placeholder="e.g. You are a concise coding assistant."
              className={`${inputClass} resize-y font-mono text-[12px] leading-5`}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label hint={Number(form.temperature).toFixed(1)}>Temperature</Label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={form.temperature}
                onChange={set('temperature')}
                className="mt-2 w-full accent-neutral-900 dark:accent-neutral-100"
              />
            </div>
            <div>
              <Label>Max tokens</Label>
              <input type="number" min="1" value={form.max_tokens} onChange={set('max_tokens')} className={inputClass} />
            </div>
            <div>
              <Label hint="messages">History limit</Label>
              <input type="number" min="1" value={form.history_limit} onChange={set('history_limit')} className={inputClass} />
            </div>
          </div>

          <div>
            <Label>Theme</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'dark', label: 'Dark', icon: Moon },
                { id: 'light', label: 'Light', icon: Sun },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setForm((f) => ({ ...f, theme: id }))}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                    form.theme === id
                      ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                      : 'border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
                  }`}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {testResult && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ${
              testResult.ok
                ? 'bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300'
                : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
            }`}
          >
            {testResult.ok ? <Check size={16} className="mt-0.5 shrink-0" /> : <Zap size={16} className="mt-0.5 shrink-0" />}
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
              {testResult.ok ? testResult.message : testResult.error}
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={save}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {busy === 'save' && <Loader2 size={15} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
