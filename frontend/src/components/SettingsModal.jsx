import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, Loader2, Moon, Sun, X, Zap } from 'lucide-react'
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
}

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

export default function SettingsModal({ settings, onClose, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY, ...settings })
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState([])
  const [modelsError, setModelsError] = useState(null)
  const [testResult, setTestResult] = useState(null)
  const [busy, setBusy] = useState(null) // 'test' | 'save' | null

  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }))

  // Fill the model dropdown from GET /v1/models using the saved key.
  useEffect(() => {
    let alive = true
    api
      .getModels()
      .then((data) => {
        if (!alive) return
        setModels(data.models || [])
        setModelsError(data.error)
      })
      .catch((err) => alive && setModelsError(err.message))
    return () => {
      alive = false
    }
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
  })

  const test = async () => {
    setBusy('test')
    setTestResult(null)
    try {
      const res = await api.testSettings({
        api_key: form.api_key,
        base_url: form.base_url,
        model: form.model,
      })
      setTestResult(res)
    } catch (err) {
      setTestResult({ ok: false, error: err.message })
    } finally {
      setBusy(null)
    }
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="scroll-slim max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800" aria-label="Close settings">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <Label hint={form.api_key ? 'saved' : 'required'}>NVIDIA API key</Label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.api_key}
                onChange={set('api_key')}
                placeholder="nvapi-..."
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

          <div>
            <Label>Base URL</Label>
            <input type="text" value={form.base_url} onChange={set('base_url')} className={`${inputClass} font-mono`} />
          </div>

          <div>
            <Label hint={modelsError || undefined}>Model</Label>
            <select
              value=""
              onChange={(e) => e.target.value && setForm((f) => ({ ...f, model: e.target.value }))}
              className={`${inputClass} mb-2`}
            >
              <option value="">
                {models.length ? `Pick from ${models.length} available models…` : 'Loading model list…'}
              </option>
              {models.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={form.model}
              onChange={set('model')}
              placeholder="or type a model id"
              className={`${inputClass} font-mono`}
            />
            {models.length > 0 && form.model && !models.includes(form.model) && (
              <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                This model isn&apos;t in the available list — pick one above.
              </p>
            )}
          </div>

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
            onClick={test}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {busy === 'test' ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
            Test connection
          </button>
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
