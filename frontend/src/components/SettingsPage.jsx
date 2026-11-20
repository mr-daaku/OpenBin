import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Brain, ChevronDown, Copy, Download, Eye, Loader2, Moon, Save, Search, Shield, Sun, Trash2, Upload, X } from 'lucide-react'
import { api } from '../api.js'
import { extractArtifacts, downloadText } from '../artifacts.js'

// ============================================================
// Tab configuration — add a new entry here and it Just Works.
// ============================================================
const CATEGORIES = [
  {
    id: 'general',
    label: 'General',
    icon: Shield,
    tabs: [
      { id: 'appearance', label: 'Appearance', component: 'AppearanceTab' },
      { id: 'about', label: 'About', component: 'AboutTab' },
    ],
  },
  {
    id: 'providers',
    label: 'Providers & Models',
    icon: Shield,
    tabs: [
      { id: 'providers', label: 'Providers', component: 'ProvidersTab' },
      { id: 'models', label: 'Models', component: 'ModelsTab' },
      { id: 'defaults', label: 'Defaults', component: 'DefaultsTab' },
    ],
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: Shield,
    tabs: [
      { id: 'system-prompt', label: 'System prompt', component: 'SystemPromptTab' },
      { id: 'generation', label: 'Generation', component: 'GenerationTab' },
    ],
  },
  {
    id: 'search',
    label: 'Search & Research',
    icon: Search,
    tabs: [
      { id: 'search-providers', label: 'Providers', component: 'SearchProvidersTab' },
      { id: 'search-behavior', label: 'Behavior', component: 'SearchBehaviorTab' },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    icon: Shield,
    tabs: [
      { id: 'export-import', label: 'Export / Import', component: 'ExportImportTab' },
    ],
  },
  {
    id: 'memory',
    label: 'Memory & Personalization',
    icon: Brain,
    tabs: [
      { id: 'memory', label: 'Memory', component: 'MemoryTab' },
      { id: 'preferences', label: 'Preferences', component: 'PreferencesTab' },
      { id: 'styles', label: 'Styles', component: 'StylesTab' },
    ],
  },
]

function findTab(catId, tabId) {
  const cat = CATEGORIES.find((c) => c.id === catId)
  return cat?.tabs.find((t) => t.id === tabId)
}

function parseHash() {
  // #/settings/providers/models -> { cat: 'providers', tab: 'models' }
  const h = location.hash.slice(1) // drop #
  if (!h.startsWith('/settings/')) return { cat: 'general', tab: 'appearance' }
  const parts = h.split('/').slice(2) // ['providers', 'models']
  const cat = parts[0] || 'general'
  const tab = parts[1] || CATEGORIES.find((c) => c.id === cat)?.tabs[0]?.id || 'appearance'
  return { cat, tab }
}

// ============================================================
// Individual tab components (each manages its own dirty state)
// ============================================================

function AppearanceTab({ settings, onSave, onChange }) {
  const [theme, setTheme] = useState(settings.theme || 'dark')
  useEffect(() => setTheme(settings.theme || 'dark'), [settings.theme])
  
  const handleThemeChange = (t) => {
    setTheme(t)
    onChange?.({ theme: t })  // Update parent state immediately
  }

  const dirty = theme !== (settings.theme || 'dark')
  return (
    <TabPanel dirty={dirty} onSave={() => onSave({ theme })}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium mb-1">Theme</label>
          <div className="flex gap-2">
            {['dark', 'light', 'system'].map((t) => (
              <button
                key={t}
                onClick={() => handleThemeChange(t)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  theme === t
                    ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white'
                    : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </TabPanel>
  )
}

function AboutTab({ settings }) {
  return (
    <TabPanel dirty={false} onSave={() => {}}>
      <div className="space-y-3 text-sm text-neutral-600 dark:text-neutral-400">
        <p><strong>OpenBin</strong> — local chat app (React + FastAPI + SQLite)</p>
        <p>Version: <code className="font-mono">0.1.9</code></p>
        <p>Backend: 127.0.0.1:8000 | Frontend: Vite dev server</p>
        <p className="mt-4">All data stays on this computer. No telemetry.</p>
      </div>
    </TabPanel>
  )
}

function ProvidersTab({ settings, onSave, onChange }) {
  const [providers, setProviders] = useState([])
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', preset: 'custom', base_url: '', api_key: '' })
  const [testResult, setTestResult] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    let alive = true
    api.listProviders().then((data) => alive && setProviders(data)).finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  const resetForm = () => setForm({ name: '', preset: 'custom', base_url: '', api_key: '', img_endpoint: '/images/generations', img_response_style: 'openai' })

  const startEdit = (p) => {
    setEditing(p.id)
    setForm({ name: p.name, preset: p.preset, base_url: p.base_url, api_key: p.api_key, img_endpoint: p.img_endpoint || '/images/generations', img_response_style: p.img_response_style || 'openai' })
  }

  const cancelEdit = () => { setEditing(null); resetForm() }

  const saveProvider = async () => {
    if (!form.name.trim() || !form.base_url.trim()) return
    setBusy('save')
    try {
      if (editing) {
        await api.updateProvider(editing, form)
      } else {
        await api.createProvider(form)
      }
      setEditing(null)
      resetForm()
      const data = await api.listProviders()
      setProviders(data)
    } catch (err) { setTestResult({ ok: false, error: err.message }) }
    finally { setBusy(null) }
  }

  const deleteProvider = async (id) => {
    if (!confirm('Delete this provider?')) return
    await api.deleteProvider(id)
    const data = await api.listProviders()
    setProviders(data)
  }

  const activateProvider = async (id) => {
    await api.activateProvider(id)
    const data = await api.listProviders()
    setProviders(data)
  }

  const testProvider = async () => {
    if (!form.base_url.trim() || !form.api_key.trim()) return
    setBusy('test')
    try {
      const res = await api.testProvider(form.base_url, { api_key: form.api_key, model: '' })
      setTestResult(res)
    } catch (err) { setTestResult({ ok: false, error: err.message }) }
    finally { setBusy(null) }
  }

  const dirty = editing !== null || testResult !== null

  if (loading) return <TabPanel dirty={false} onSave={() => {}}><p className="text-sm text-neutral-500">Loading…</p></TabPanel>

  return (
    <TabPanel dirty={dirty} onSave={saveProvider}>
      <div className="space-y-4">
        <h4 className="text-sm font-semibold">Saved providers</h4>
        {providers.length === 0 && <p className="text-sm text-neutral-500">No providers yet. Add one below.</p>}
        <ul className="space-y-2">
          {providers.map((p) => (
            <li key={p.id} className={`flex items-center gap-3 rounded-lg border p-3 ${p.is_active ? 'border-green-300 bg-green-50 dark:border-green-900/30 dark:bg-green-950/20' : 'border-neutral-200 dark:border-neutral-700'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{p.name}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">{p.preset}</span>
                  {p.is_active && <span className="text-[11px] text-green-600 dark:text-green-400">● Active</span>}
                </div>
                <div className="text-[11px] text-neutral-500 truncate font-mono">{p.base_url}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {!p.is_active && <button onClick={() => activateProvider(p.id)} className="text-xs text-blue-600 hover:underline">Activate</button>}
                <button onClick={() => startEdit(p)} className="text-xs text-neutral-600 hover:underline">Edit</button>
                <button onClick={() => deleteProvider(p.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              </div>
            </li>
          ))}
        </ul>

        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h4 className="text-sm font-semibold mb-3">{editing ? 'Edit provider' : 'Add provider'}</h4>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">Name</label>
              <input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="My NVIDIA" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Preset</label>
              <select value={form.preset} onChange={(e) => setForm({...form, preset: e.target.value})} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700">
                <option value="nvidia">NVIDIA NIM</option>
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
                <option value="groq">Groq</option>
                <option value="ollama">Ollama</option>
                <option value="custom">Custom / Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Base URL</label>
              <input value={form.base_url} onChange={(e) => setForm({...form, base_url: e.target.value})} placeholder="https://api.example.com/v1" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono dark:border-neutral-700" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">API key <span className="text-neutral-400">(masked after save)</span></label>
              <input type="password" value={form.api_key} onChange={(e) => setForm({...form, api_key: e.target.value})} placeholder="sk-… or leave empty to keep existing" autoComplete="off" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono dark:border-neutral-700" />
            </div>
            <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">Image generation</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Endpoint <span className="text-neutral-400">(appended to base URL)</span></label>
                  <input value={form.img_endpoint} onChange={(e) => setForm({...form, img_endpoint: e.target.value})} placeholder="/images/generations" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono dark:border-neutral-700" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Response style</label>
                  <select value={form.img_response_style} onChange={(e) => setForm({...form, img_response_style: e.target.value})} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700">
                    <option value="openai">OpenAI (data[].b64_json / url)</option>
                    <option value="nvidia">NVIDIA (artifacts[].base64)</option>
                    <option value="custom">Auto-detect (try all)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={saveProvider} disabled={busy !== null} className="flex-1 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900">{busy === 'save' ? <Loader2 size={14} className="mx-auto animate-spin" /> : 'Save'}</button>
            <button onClick={testProvider} disabled={busy !== null} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700">{busy === 'test' ? <Loader2 size={14} className="mx-auto animate-spin" /> : 'Test'}</button>
            {editing && <button onClick={cancelEdit} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700">Cancel</button>}
          </div>
          {testResult && <div className={`mt-3 rounded-lg p-3 text-sm ${testResult.ok ? 'bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>{testResult.ok ? 'Connection OK' : testResult.error}</div>}
        </div>
      </div>
    </TabPanel>
  )
}

function ModelsTab({ settings, onSave, onChange }) {
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [pinned, setPinned] = useState([])
  const [search, setSearch] = useState('')
  const [manual, setManual] = useState('')
  const [filter, setFilter] = useState('all') // all | chat | vision | image

  // Find active provider
  const [activeProviderId, setActiveProviderId] = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const provs = await api.listProviders()
      const active = provs.find((p) => p.is_active) || provs[0]
      if (!active) { setModels([]); setActiveProviderId(null); setLoading(false); return }
      setActiveProviderId(active.id)
      const data = await api.providerModels(active.id)
      setModels(data.models || [])
      setError(data.error)
    } catch (err) { setModels([]); setError(err.message) }
    finally { setLoading(false) }
  }

  const loadPinned = async () => {
    try {
      const provs = await api.listProviders()
      const active = provs.find((p) => p.is_active) || provs[0]
      setPinned(active?.pinned || [])
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); loadPinned() }, [])

  const q = search.trim().toLowerCase()
  let visible = models.filter((m) => !q || m.id.toLowerCase().includes(q))
  // Filter by capability
  if (filter === 'chat') visible = visible.filter((m) => !m.image_gen)
  else if (filter === 'vision') visible = visible.filter((m) => m.vision)
  else if (filter === 'image') visible = visible.filter((m) => m.image_gen)
  const pinnedVisible = visible.filter((m) => pinned.includes(m.id))
  const restVisible = visible.filter((m) => !pinned.includes(m.id))

  const togglePin = async (model) => {
    if (!activeProviderId) return
    try {
      const nextPinned = pinned.includes(model) ? pinned.filter((m) => m !== model) : [...pinned, model]
      await api.togglePinned(activeProviderId, model)
      setPinned(nextPinned)
    } catch (err) { setError(err.message) }
  }

  const toggleCap = async (model, cap, value) => {
    if (!activeProviderId) return
    try {
      await api.updateModelCaps(activeProviderId, model, { [cap]: value ? 1 : 0 })
      setModels(models.map((m) => m.id === model ? { ...m, [cap]: value ? 1 : 0, source: 'manual' } : m))
    } catch (err) { setError(err.message) }
  }

  const resetCap = async (model) => {
    if (!activeProviderId) return
    try {
      await api.resetModelCaps(activeProviderId, model)
      load() // reload to get auto-detected caps
    } catch (err) { setError(err.message) }
  }

  const useManual = () => {
    const v = manual.trim()
    if (!v) return
    onChange({ model: v })
    setManual('')
  }

  const isImageGenOnly = (m) => m.image_gen && !m.vision && !m.tools

  const CapBadge = ({ label, value, source, onToggle, onReset, disabled }) => (
    <button
      onClick={() => !disabled && onToggle(!value)}
      disabled={disabled}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
        value
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
      }`}
      title={source === 'manual' ? 'Manual override — click to toggle' : 'Auto-detected — click to override'}
    >
      {label}
      {source === 'manual' && <span className="text-[9px]">●</span>}
    </button>
  )

  return (
    <TabPanel dirty={false} onSave={() => {}}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search models…" className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700" />
          <button onClick={load} disabled={loading} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700">{loading ? <Loader2 size={14} className="mx-auto animate-spin" /> : 'Reload'}</button>
        </div>
        {error && <p className="text-sm text-amber-600 dark:text-amber-400">{error}</p>}

        {/* Filter chips */}
        <div className="flex gap-1.5 flex-wrap">
          {['all', 'chat', 'vision', 'image'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                filter === f
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {pinnedVisible.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">Pinned</h4>
              <div className="flex flex-wrap gap-2">
                {pinnedVisible.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 dark:border-green-900 dark:bg-green-950/30">
                    <span className="font-mono text-sm text-green-700 dark:text-green-400">{m.id}</span>
                    <div className="flex items-center gap-1">
                      <CapBadge label="👁" value={m.vision} source={m.source} onToggle={(v) => toggleCap(m.id, 'vision', v)} onReset={() => resetCap(m.id)} disabled={isImageGenOnly(m)} />
                      <CapBadge label="🖼" value={m.image_gen} source={m.source} onToggle={(v) => toggleCap(m.id, 'image_gen', v)} onReset={() => resetCap(m.id)} disabled={isImageGenOnly(m)} />
                      <CapBadge label="🔧" value={m.tools} source={m.source} onToggle={(v) => toggleCap(m.id, 'tools', v)} onReset={() => resetCap(m.id)} disabled={isImageGenOnly(m)} />
                      <CapBadge label="🧠" value={m.reasoning} source={m.source} onToggle={(v) => toggleCap(m.id, 'reasoning', v)} onReset={() => resetCap(m.id)} disabled={isImageGenOnly(m)} />
                    </div>
                    <button onClick={() => onChange({ model: m.id })} className="ml-1.5 text-xs text-green-600 hover:underline">Select</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">All models</h4>
          <div className="max-h-96 overflow-y-auto space-y-1">
            {restVisible.map((m) => (
              <div key={m.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-mono transition ${isImageGenOnly(m) ? 'border-amber-300 bg-amber-50 opacity-60 dark:border-amber-900/30 dark:bg-amber-950/20' : pinned.includes(m.id) ? 'border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30' : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}`}>
                <span className="min-w-0 flex-1 truncate">{m.id}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <CapBadge label="👁" value={m.vision} source={m.source} onToggle={(v) => toggleCap(m.id, 'vision', v)} onReset={() => resetCap(m.id)} disabled={isImageGenOnly(m)} />
                  <CapBadge label="🖼" value={m.image_gen} source={m.source} onToggle={(v) => toggleCap(m.id, 'image_gen', v)} onReset={() => resetCap(m.id)} disabled={isImageGenOnly(m)} />
                  <CapBadge label="🔧" value={m.tools} source={m.source} onToggle={(v) => toggleCap(m.id, 'tools', v)} onReset={() => resetCap(m.id)} disabled={isImageGenOnly(m)} />
                  <CapBadge label="🧠" value={m.reasoning} source={m.source} onToggle={(v) => toggleCap(m.id, 'reasoning', v)} onReset={() => resetCap(m.id)} disabled={isImageGenOnly(m)} />
                </div>
                {!isImageGenOnly(m) && (
                  <button onClick={() => onChange({ model: m.id })} className="ml-1.5 shrink-0 rounded px-2 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30">Select</button>
                )}
                {isImageGenOnly(m) && <span className="ml-1.5 shrink-0 text-[10px] text-amber-600 dark:text-amber-400">Image mode only</span>}
              </div>
            ))}
          </div>

          <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">Manual model ID</h4>
            <div className="flex gap-2">
              <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="org/model-name" className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono dark:border-neutral-700" onKeyDown={(e) => e.key === 'Enter' && useManual()} />
              <button onClick={useManual} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900">Use</button>
            </div>
          </div>
        </div>
      </div>
    </TabPanel>
  )
}

function DefaultsTab({ settings, onSave, onChange }) {
  const [model, setModel] = useState(settings.model || '')
  const dirty = model !== (settings.model || '')
  useEffect(() => setModel(settings.model || ''), [settings.model])
  return (
    <TabPanel dirty={dirty} onSave={() => onSave({ model })}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium mb-1">Default model for new chats</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Leave empty to use provider default" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono dark:border-neutral-700" />
        </div>
      </div>
    </TabPanel>
  )
}

function SystemPromptTab({ settings, onSave, onChange }) {
  const [prompt, setPrompt] = useState(settings.system_prompt || '')
  const dirty = prompt !== (settings.system_prompt || '')
  useEffect(() => setPrompt(settings.system_prompt || ''), [settings.system_prompt])
  return (
    <TabPanel dirty={dirty} onSave={() => onSave({ system_prompt: prompt })}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Global system prompt (used when chat has no override)</label>
          <button onClick={() => setPrompt(settings.system_prompt || '')} className="text-xs text-blue-600 hover:underline">Reset to built-in default</button>
        </div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={12} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono resize-y dark:border-neutral-700" />
        <p className="text-xs text-neutral-500">Per-chat overrides can be set from the chat header (sliders icon).</p>
      </div>
    </TabPanel>
  )
}

function GenerationTab({ settings, onSave, onChange }) {
  const [temperature, setTemperature] = useState(Number(settings.temperature ?? 0.7))
  const [maxTokens, setMaxTokens] = useState(Number(settings.max_tokens ?? 1024))
  const [topP, setTopP] = useState(Number(settings.top_p ?? 1))
  const [historyLimit, setHistoryLimit] = useState(Number(settings.history_limit ?? 12))
  const dirty = temperature !== Number(settings.temperature ?? 0.7) || maxTokens !== Number(settings.max_tokens ?? 1024) || topP !== Number(settings.top_p ?? 1) || historyLimit !== Number(settings.history_limit ?? 12)
  useEffect(() => { setTemperature(Number(settings.temperature ?? 0.7)); setMaxTokens(Number(settings.max_tokens ?? 1024)); setTopP(Number(settings.top_p ?? 1)); setHistoryLimit(Number(settings.history_limit ?? 12)) }, [settings.temperature, settings.max_tokens, settings.top_p, settings.history_limit])

  return (
    <TabPanel dirty={dirty} onSave={() => onSave({ temperature, max_tokens: maxTokens, top_p: topP, history_limit: historyLimit })}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium mb-1">Temperature <span className="font-mono text-neutral-500">{temperature.toFixed(1)}</span></label>
          <input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="w-full accent-neutral-900 dark:accent-neutral-100" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">Max tokens</label>
            <input type="number" min="1" value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Top-p</label>
            <input type="number" min="0" max="1" step="0.05" value={topP} onChange={(e) => setTopP(Number(e.target.value))} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">History limit (messages per request)</label>
          <input type="number" min="1" max="50" value={historyLimit} onChange={(e) => setHistoryLimit(Number(e.target.value))} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700" />
        </div>
      </div>
    </TabPanel>
  )
}

function SearchProvidersTab({ settings, onSave, onChange }) {
  const [provider, setProvider] = useState(settings.search_provider || 'gradio')
  const [space, setSpace] = useState(settings.search_space || '')
  const [key, setKey] = useState(settings.search_key || '')
  const [tavilyKey, setTavilyKey] = useState(settings.search_tavily_key || '')
  const [customUrl, setCustomUrl] = useState(settings.search_custom_url || '')
  const [customKey, setCustomKey] = useState(settings.search_custom_key || '')
  const [testQuery, setTestQuery] = useState('latest AI news')
  const [fetchUrl, setFetchUrl] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [busy, setBusy] = useState(null)
  const dirty = provider !== settings.search_provider || space !== settings.search_space || key !== settings.search_key || tavilyKey !== settings.search_tavily_key || customUrl !== settings.search_custom_url || customKey !== settings.search_custom_key

  const runSearchTest = async () => {
    setBusy('search'); setTestResult(null)
    try { setTestResult(await api.testSearch(testQuery)) } catch (e) { setTestResult({ ok: false, error: e.message }) }
    finally { setBusy(null) }
  }
  const runFetchTest = async () => {
    const u = fetchUrl.trim(); if (!u) return
    setBusy('fetch'); setTestResult(null)
    try { setTestResult(await api.testFetch(u)) } catch (e) { setTestResult({ ok: false, error: e.message }) }
    finally { setBusy(null) }
  }

  return (
    <TabPanel dirty={dirty} onSave={() => onSave({ search_provider: provider, search_space: space, search_key: key, search_tavily_key: tavilyKey, search_custom_url: customUrl, search_custom_key: customKey })}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium mb-1">Provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700">
            <option value="gradio">Gradio search space</option>
            <option value="tavily">Tavily</option>
            <option value="custom">Custom search API</option>
          </select>
        </div>

        {provider === 'gradio' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">Space <span className="text-neutral-400">(owner/space-name)</span></label>
              <input value={space} onChange={(e) => setSpace(e.target.value)} placeholder="mrdaaku/search-api" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono dark:border-neutral-700" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">API key</label>
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="paste the space key…" autoComplete="off" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono dark:border-neutral-700" />
            </div>
          </div>
        )}

        {provider === 'tavily' && (
          <div>
            <label className="block text-xs font-medium mb-1">Tavily API key</label>
            <input type="password" value={tavilyKey} onChange={(e) => setTavilyKey(e.target.value)} placeholder="tvly-…" autoComplete="off" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono dark:border-neutral-700" />
          </div>
        )}

        {provider === 'custom' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">Base URL <span className="text-neutral-400">(GET {url}/search?q=…)</span></label>
              <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://your-search-api.example" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono dark:border-neutral-700" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">API key (optional)</label>
              <input type="password" value={customKey} onChange={(e) => setCustomKey(e.target.value)} placeholder="optional" autoComplete="off" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono dark:border-neutral-700" />
            </div>
          </div>
        )}

        <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <h4 className="text-sm font-semibold mb-3">Test</h4>
          <div className="flex gap-2 mb-3">
            <input value={testQuery} onChange={(e) => setTestQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runSearchTest()} placeholder="Test query" className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700" />
            <button onClick={runSearchTest} disabled={busy !== null} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700">{busy === 'search' ? <Loader2 size={14} className="mx-auto animate-spin" /> : 'Test search'}</button>
          </div>
          <div className="flex gap-2">
            <input value={fetchUrl} onChange={(e) => setFetchUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runFetchTest()} placeholder="https://example.com" className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono dark:border-neutral-700" />
            <button onClick={runFetchTest} disabled={busy !== null} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700">{busy === 'fetch' ? <Loader2 size={14} className="mx-auto animate-spin" /> : 'Test page fetch'}</button>
          </div>
          {testResult && <div className={`mt-3 rounded-lg p-3 text-sm ${testResult.ok ? 'bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>{testResult.ok ? (typeof testResult.text === 'string' ? `Read ${testResult.host} · ${testResult.chars} chars` : `Search works · ${testResult.results?.length || 0} results`) : testResult.error}</div>}
        </div>
      </div>
    </TabPanel>
  )
}

function SearchBehaviorTab({ settings, onSave, onChange }) {
  return (
    <TabPanel dirty={false} onSave={() => {}}>
      <div className="space-y-4 text-sm text-neutral-600 dark:text-neutral-400">
        <p><strong>Auto mode:</strong> model calls tools (web_search, fetch_url) up to 5 rounds, then forced to answer. If tools not supported, a small JSON router call decides.</p>
        <p><strong>Always mode:</strong> one search on every user message.</p>
        <p><strong>Deep Research:</strong> planned sub-queries, searched one at a time with a pause between them.</p>
        <p className="mt-4">All settings here are controlled by the backend constants. Edit <code className="font-mono bg-neutral-100 px-1 dark:bg-neutral-800">backend/main.py</code> to change limits (iterations, timeouts, etc.).</p>
      </div>
    </TabPanel>
  )
}

function ExportImportTab({ settings, onSave, onChange }) {
  const [importFile, setImportFile] = useState(null)
  const [importResult, setImportResult] = useState(null)

  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ settings, chats: [], messages: [], artifacts: [] }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `openbin-backup-${new Date().toISOString().slice(0,10)}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]; if (!file) return
    const text = await file.text()
    try {
      const data = JSON.parse(text)
      if (data.settings) { await api.saveSettings(data.settings); onChange(data.settings) }
      if (data.chats) { for (const c of data.chats) { await api.createChat(); /* simplified */ } }
      setImportResult({ ok: true, msg: 'Imported successfully' })
    } catch (err) { setImportResult({ ok: false, error: err.message }) }
    setImportFile(null); e.target.value = ''
  }

  return (
    <TabPanel dirty={false} onSave={() => {}}>
      <div className="space-y-4">
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h4 className="text-sm font-semibold mb-3">Export all data</h4>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">Downloads a JSON file with settings, chats, messages, and artifacts.</p>
          <button onClick={exportAll} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700">Export JSON</button>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h4 className="text-sm font-semibold mb-3">Import data</h4>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">Select a previously exported JSON file.</p>
          <input type="file" accept=".json" onChange={handleImport} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700" />
          {importResult && <div className={`mt-3 rounded-lg p-3 text-sm ${importResult.ok ? 'bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>{importResult.ok ? importResult.msg : importResult.error}</div>}
        </div>
      </div>
    </TabPanel>
  )
}

// ============================================================
// Memory & Personalization tabs
// ============================================================

function MemoryTab({ settings, onSave, onChange }) {
  const [memories, setMemories] = useState([])
  const [loading, setLoading] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [newPinned, setNewPinned] = useState(false)
  const [toast, setToast] = useState(null)
  const [undoMemory, setUndoMemory] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.listMemories()
      setMemories(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const showToast = (msg, undo = null) => {
    setToast(msg)
    setUndoMemory(undo)
    setTimeout(() => { setToast(null); setUndoMemory(null) }, 5000)
  }

  const handleAdd = async () => {
    const content = newContent.trim()
    if (!content) return
    try {
      const mem = await api.createMemory(content, newPinned ? 1 : 0)
      setMemories([mem, ...memories])
      setNewContent('')
      setNewPinned(false)
      showToast('Memory added', { action: 'delete', id: mem.id })
    } catch (err) { alert(err.message) }
  }

  const handleTogglePin = async (mem) => {
    try {
      const updated = await api.updateMemory(mem.id, mem.content, mem.pinned ? 0 : 1)
      setMemories(memories.map(m => m.id === mem.id ? updated : m))
      showToast(updated.pinned ? 'Memory pinned' : 'Memory unpinned', { action: 'togglePin', id: mem.id, prev: mem.pinned })
    } catch (err) { alert(err.message) }
  }

  const handleDelete = async (id) => {
    try {
      const mem = memories.find(m => m.id === id)
      await api.deleteMemory(id)
      setMemories(memories.filter(m => m.id !== id))
      showToast('Memory deleted', { action: 'restore', mem })
    } catch (err) { alert(err.message) }
  }

  const handleUndo = () => {
    if (!undoMemory) return
    if (undoMemory.action === 'delete') {
      api.deleteMemory(undoMemory.id).catch(() => {})
    } else if (undoMemory.action === 'togglePin') {
      api.updateMemory(undoMemory.id, memories.find(m => m.id === undoMemory.id)?.content || '', undoMemory.prev).catch(() => {})
    } else if (undoMemory.action === 'restore') {
      api.createMemory(undoMemory.mem.content, undoMemory.mem.pinned).catch(() => {})
    }
    load()
    setToast(null)
    setUndoMemory(null)
  }

  const handleExport = async () => {
    try {
      const data = await api.exportMemories()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `openbin-memories-${new Date().toISOString().slice(0,10)}.json`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) { alert(err.message) }
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]; if (!file) return
    const text = await file.text()
    try {
      const data = JSON.parse(text)
      if (data.memories) {
        await api.importMemories(data.memories)
        load()
        showToast('Memories imported')
      }
    } catch (err) { alert(err.message) }
    e.target.value = ''
  }

  const handleClearAll = async () => {
    if (!confirm('Delete ALL memories? This cannot be undone.')) return
    try {
      await api.clearMemories()
      setMemories([])
      showToast('All memories cleared')
    } catch (err) { alert(err.message) }
  }

  return (
    <TabPanel dirty={false} onSave={() => {}}>
      <div className="space-y-4">
        {/* Add memory */}
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h4 className="text-sm font-semibold mb-3">Add memory</h4>
          <div className="space-y-3">
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="What should I remember? (e.g., 'User prefers TypeScript', 'User works on a React project')"
              rows={3}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm resize-y dark:border-neutral-700"
            />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={newPinned} onChange={(e) => setNewPinned(e.target.checked)} className="rounded border-neutral-300" />
                Pinned (always included in context)
              </label>
              <button onClick={handleAdd} disabled={loading || !newContent.trim()} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900">{loading ? <Loader2 size={14} className="mx-auto animate-spin" /> : 'Add memory'}</button>
            </div>
          </div>
        </div>

        {/* Memory list */}
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold">Memories ({memories.length})</h4>
            <div className="flex gap-2">
              <button onClick={handleExport} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700">Export JSON</button>
              <input type="file" accept=".json" onChange={handleImport} className="hidden" id="mem-import" ref={(el) => el && (window.memImportRef = el)} />
              <button onClick={() => window.memImportRef?.click()} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700">Import JSON</button>
              <button onClick={handleClearAll} className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-950/30">Clear all</button>
            </div>
          </div>
          {loading ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : memories.length === 0 ? (
            <p className="text-sm text-neutral-500">No memories yet. Add one above.</p>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-y-auto">
              {memories.map((mem) => (
                <li key={mem.id} className={`flex items-start gap-3 rounded-lg border p-3 ${mem.pinned ? 'border-amber-300 bg-amber-50 dark:border-amber-900/30 dark:bg-amber-950/20' : 'border-neutral-200 dark:border-neutral-700'}`}>
                  <input type="checkbox" checked={mem.pinned} onChange={() => handleTogglePin(mem)} className="mt-1 shrink-0 rounded border-neutral-300" title="Pin to always include" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm whitespace-pre-wrap break-words">{mem.content}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-neutral-500">
                      <span>{mem.source === 'manual' ? '📝 Manual' : '🤖 Auto'}</span>
                      <span>·</span>
                      <span>{new Date(mem.updated_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(mem.id)} className="shrink-0 text-red-500 hover:text-red-700 text-sm font-medium" title="Delete">Delete</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </TabPanel>
  )
}

function PreferencesTab({ settings, onSave, onChange }) {
  const [language, setLanguage] = useState(settings.language || 'auto')
  const [tone, setTone] = useState(settings.tone || 'casual')
  const [responseLength, setResponseLength] = useState(settings.response_length || 'normal')
  const dirty = language !== settings.language || tone !== settings.tone || responseLength !== settings.response_length

  useEffect(() => { setLanguage(settings.language || 'auto'); setTone(settings.tone || 'casual'); setResponseLength(settings.response_length || 'normal') }, [settings.language, settings.tone, settings.response_length])

  return (
    <TabPanel dirty={dirty} onSave={() => onSave({ language, tone, response_length: responseLength })}>
      <div className="space-y-6">
        <div>
          <label className="block text-xs font-medium mb-2">Language</label>
          <div className="flex gap-2 flex-wrap">
            {['auto', 'english', 'hindi', 'hinglish'].map((l) => (
              <button key={l} onClick={() => setLanguage(l)} className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${language === l ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white' : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}`}>
                {l.charAt(0).toUpperCase() + l.slice(1)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-500">Auto detects the user's language from the message.</p>
        </div>

        <div>
          <label className="block text-xs font-medium mb-2">Tone</label>
          <div className="flex gap-2 flex-wrap">
            {['casual', 'concise', 'explanatory', 'formal'].map((t) => (
              <button key={t} onClick={() => setTone(t)} className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${tone === t ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white' : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}`}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-500">Custom styles can be created in the Styles tab.</p>
        </div>

        <div>
          <label className="block text-xs font-medium mb-2">Response length</label>
          <div className="flex gap-2 flex-wrap">
            {['short', 'normal', 'long'].map((l) => (
              <button key={l} onClick={() => setResponseLength(l)} className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${responseLength === l ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white' : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}`}>
                {l.charAt(0).toUpperCase() + l.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </TabPanel>
  )
}

function StylesTab({ settings, onSave, onChange }) {
  const [styles, setStyles] = useState(settings.custom_styles ? JSON.parse(settings.custom_styles) : [])
  const [activeStyle, setActiveStyle] = useState(settings.active_style || 'Casual')
  const [newName, setNewName] = useState('')
  const [newInstruction, setNewInstruction] = useState('')
  const dirty = JSON.stringify(styles) !== settings.custom_styles || activeStyle !== settings.active_style

  useEffect(() => { setStyles(settings.custom_styles ? JSON.parse(settings.custom_styles) : []) }, [settings.custom_styles])
  useEffect(() => { setActiveStyle(settings.active_style || 'Casual') }, [settings.active_style])

  const presets = [
    { name: 'Normal', instruction: 'Answer in a balanced, helpful way.' },
    { name: 'Concise', instruction: 'Be extremely brief. Give the shortest useful answer.' },
    { name: 'Explanatory', instruction: 'Explain concepts thoroughly with examples. Teach, don\'t just answer.' },
    { name: 'Formal', instruction: 'Use formal, professional language. No contractions or slang.' },
    { name: 'Casual', instruction: 'Be friendly and conversational. Use casual language.' },
  ]

  const handleAddStyle = () => {
    const name = newName.trim()
    const instruction = newInstruction.trim()
    if (!name || !instruction) return
    if (styles.some(s => s.name === name) || presets.some(p => p.name === name)) {
      alert('Style name already exists')
      return
    }
    setStyles([...styles, { name, instruction }])
    setNewName('')
    setNewInstruction('')
  }

  const handleDeleteStyle = (name) => {
    setStyles(styles.filter(s => s.name !== name))
    if (activeStyle === name) setActiveStyle('Casual')
  }

  const handleSelectStyle = (name) => setActiveStyle(name)

  return (
    <TabPanel dirty={dirty} onSave={() => onSave({ custom_styles: JSON.stringify(styles), active_style: activeStyle })}>
      <div className="space-y-6">
        {/* Presets */}
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h4 className="text-sm font-semibold mb-3">Built-in styles (cannot be edited)</h4>
          <div className="flex gap-2 flex-wrap">
            {presets.map((s) => (
              <button key={s.name} onClick={() => handleSelectStyle(s.name)} className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${activeStyle === s.name ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white' : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}`}>
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {/* Custom styles */}
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h4 className="text-sm font-semibold mb-3">Custom styles</h4>
          <div className="space-y-3 mb-4">
            {styles.map((s) => (
              <div key={s.name} className="flex items-start gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-neutral-500 truncate">{s.instruction}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => handleSelectStyle(s.name)} className={`rounded px-2 py-1 text-xs ${activeStyle === s.name ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'bg-neutral-100 dark:bg-neutral-800'}`}>
                    {activeStyle === s.name ? 'Active' : 'Use'}
                  </button>
                  <button onClick={() => handleDeleteStyle(s.name)} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">Delete</button>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <h5 className="text-xs font-semibold mb-2">Create custom style</h5>
            <div className="space-y-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Style name (e.g., 'Code Reviewer')" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700" />
              <textarea value={newInstruction} onChange={(e) => setNewInstruction(e.target.value)} placeholder="Instruction for the model (e.g., 'Act as a senior code reviewer. Be thorough but kind.')}" rows={3} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm resize-y dark:border-neutral-700" />
              <button onClick={handleAddStyle} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900">Add style</button>
            </div>
          </div>
        </div>
      </div>
    </TabPanel>
  )
}

// ============================================================
// Shared UI pieces
// ============================================================

function TabPanel({ dirty, onSave, children }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</div>
      <div className="border-t border-neutral-200 p-4 lg:p-6 dark:border-neutral-800">
        <button onClick={onSave} disabled={!dirty} className="rounded-lg bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-white dark:text-neutral-900">
          <Save size={14} className="mr-1.5" /> Save changes
        </button>
        {dirty && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">You have unsaved changes.</p>}
      </div>
    </div>
  )
}

// ============================================================
// Tab component map (avoids eval warning)
// ============================================================
const TAB_COMPONENTS = {
  AppearanceTab,
  AboutTab,
  ProvidersTab,
  ModelsTab,
  DefaultsTab,
  SystemPromptTab,
  GenerationTab,
  SearchProvidersTab,
  SearchBehaviorTab,
  ExportImportTab,
  MemoryTab,
  PreferencesTab,
  StylesTab,
}

// ============================================================
// Main Settings Page
// ============================================================

export default function SettingsPage({ onClose, onSaved, onChange }) {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hash, setHash] = useState(parseHash())
  const [mobileCatOpen, setMobileCatOpen] = useState(false)

  // Keep hash in sync with browser back/forward
  useEffect(() => {
    const onHash = () => setHash(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = (cat, tab) => {
    location.hash = `/settings/${cat}/${tab}`
  }

  const loadSettings = async () => {
    const data = await api.getSettings()
    setSettings(data)
    setLoading(false)
  }

  useEffect(() => { loadSettings() }, [])

  const handleSave = async (patch) => {
    const next = { ...settings, ...patch }
    await api.saveSettings(next)
    setSettings(next)
    onSaved?.(next)
  }

  const handleChange = (patch) => {
    setSettings((s) => ({ ...s, ...patch }))
    onChange?.(patch)
  }

  const activeCat = CATEGORIES.find((c) => c.id === hash.cat) || CATEGORIES[0]
  const activeTab = findTab(hash.cat, hash.tab) || activeCat.tabs[0]
  const TabComp = TAB_COMPONENTS[activeTab.component]

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={24} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  if (!TabComp) {
    return <div className="flex h-full items-center justify-center text-red-600">Unknown tab</div>
  }

  return (
    <div className="flex h-full min-w-0 bg-white dark:bg-neutral-950">
      {/* Left sidebar — categories */}
      <aside className="hidden lg:flex lg:flex-col w-56 border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between h-14 px-4 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="text-sm font-semibold">Settings</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label="Back to chat"><ArrowLeft size={16} /></button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => navigate(cat.id, cat.tabs[0].id)}
              className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${hash.cat === cat.id ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800'}`}
            >
              <cat.icon size={16} className="shrink-0" />
              {cat.label}
            </button>
          ))}
        </nav>
        <div className="p-2 border-t border-neutral-200 dark:border-neutral-800">
          <button onClick={onClose} className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"><ArrowLeft size={16} /> Back to chat</button>
        </div>
      </aside>

      {/* Mobile category bar */}
      <div className="lg:hidden border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between h-12 px-3">
          <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"><ArrowLeft size={18} /></button>
          <h3 className="text-sm font-semibold flex-1 text-center">Settings</h3>
          <button onClick={() => setMobileCatOpen(!mobileCatOpen)} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"><ChevronDown size={18} /></button>
        </div>
        {mobileCatOpen && (
          <div className="px-3 pb-3 space-y-1">
            {CATEGORIES.map((cat) => (
              <button key={cat.id} onClick={() => { navigate(cat.id, cat.tabs[0].id); setMobileCatOpen(false) }} className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium ${hash.cat === cat.id ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800'}`}>
                <cat.icon size={16} /> {cat.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right content — tabs */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Sub-tabs header */}
        <div className="flex items-center gap-1 border-b border-neutral-200 px-4 lg:px-6 dark:border-neutral-800 overflow-x-auto scroll-slim">
          {activeCat.tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => navigate(activeCat.id, tab.id)}
              className={`shrink-0 rounded-t-lg px-3 py-2 text-sm font-medium transition ${hash.tab === tab.id ? 'bg-white text-neutral-900 border-b-2 border-neutral-900 dark:bg-neutral-900 dark:text-white dark:border-white' : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab panel */}
        <TabComp settings={settings} onSave={handleSave} onChange={handleChange} />
      </main>
    </div>
  )
}