import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2, Play, ShieldCheck, Terminal } from 'lucide-react'
import { api } from '../api.js'

// One input line -> argv. Splits on whitespace, honours "double quotes"
// so `python -c "print('hi')"` arrives as three clean arguments.
export function splitArgs(text) {
  const out = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(text || ''))) {
    out.push(m[1] ?? m[2] ?? m[3])
  }
  return out
}

export default function SandboxPage({ onClose }) {
  const [info, setInfo] = useState(null)
  const [command, setCommand] = useState('python')
  const [argText, setArgText] = useState('')
  const [preview, setPreview] = useState(null) // {ok, cmdline, cwd} | {ok:false, error}
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.sandboxInfo().then(setInfo).catch(() => {})
  }, [])

  const doPreview = async () => {
    setError('')
    setResult(null)
    try {
      const data = await api.sandboxPreview(command.trim(), splitArgs(argText))
      setPreview(data)
      if (!data.ok) setError(data.error)
    } catch (err) {
      setError(err.message)
    }
  }

  const doRun = async () => {
    setRunning(true)
    setError('')
    try {
      const data = await api.sandboxRun(command.trim(), splitArgs(argText))
      if (data.ok) {
        setResult(data)
        setPreview(null)
      } else {
        setError(data.error || 'Run failed.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  const runNow = (e) => {
    e.preventDefault()
    doPreview()
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-white dark:bg-neutral-950">
      {/* Header */}
      <div className="flex h-12 items-center gap-2 border-b border-neutral-200 px-3 dark:border-neutral-800">
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
          aria-label="Back to chat"
        >
          <ArrowLeft size={18} />
        </button>
        <h3 className="flex-1 text-sm font-semibold">Sandbox</h3>
        <span className="hidden items-center gap-1.5 rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] text-neutral-500 sm:flex dark:border-neutral-800 dark:text-neutral-400">
          <ShieldCheck size={12} />
          allowlisted commands only
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-2xl space-y-4">
          {/* Workspace + allowlist */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900">
            <p className="mb-1.5 font-medium text-neutral-600 dark:text-neutral-300">
              Everything runs inside one folder:
            </p>
            <code className="block break-all rounded-lg bg-white px-2.5 py-1.5 text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
              {info?.workspace || '…'}
            </code>
            <p className="mt-2 text-neutral-500 dark:text-neutral-400">
              Allowed: {(info?.allowed || []).join(', ') || '…'} · timeout {info?.timeout || '…'}s
            </p>
          </div>

          {/* Command input */}
          <form onSubmit={runNow} className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative sm:w-44">
                <Terminal size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  value={command}
                  onChange={(e) => {
                    setCommand(e.target.value)
                    setPreview(null)
                  }}
                  placeholder="python"
                  aria-label="Command"
                  className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-8 pr-3 font-mono text-sm outline-none transition focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800"
                />
              </div>
              <input
                value={argText}
                onChange={(e) => {
                  setArgText(e.target.value)
                  setPreview(null)
                }}
                placeholder='arguments, e.g. -c "print(1 + 1)"'
                aria-label="Arguments"
                className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-mono text-sm outline-none transition focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium hover:bg-neutral-50 sm:w-auto dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              Preview command
            </button>
          </form>

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          {/* Approval card: nothing runs until the user confirms here. */}
          {preview?.ok && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700/60 dark:bg-amber-950/30">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Approve to run
              </p>
              <code className="block break-all rounded-lg bg-white px-3 py-2 font-mono text-sm text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
                {preview.cmdline}
              </code>
              <p className="mt-1.5 break-all text-[11px] text-amber-700/80 dark:text-amber-400/80">
                in {preview.cwd}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={doRun}
                  disabled={running}
                  className="flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                >
                  {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                  {running ? 'Running…' : 'Approve & run'}
                </button>
                <button
                  onClick={() => setPreview(null)}
                  disabled={running}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Output */}
          {result && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`rounded-full px-2.5 py-1 font-medium ${
                    result.exit_code === 0
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400'
                  }`}
                >
                  exit {result.exit_code}
                </span>
                <span className="text-neutral-500 dark:text-neutral-400">{result.duration_ms} ms</span>
                {result.truncated && (
                  <span className="text-amber-600 dark:text-amber-400">output truncated</span>
                )}
              </div>
              <code className="block break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">
                $ {result.cmdline}
              </code>
              {result.stdout && (
                <pre className="scroll-slim overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
                  {result.stdout}
                </pre>
              )}
              {result.stderr && (
                <pre className="scroll-slim overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-red-200 bg-red-50 p-3 font-mono text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  {result.stderr}
                </pre>
              )}
              {!result.stdout && !result.stderr && (
                <p className="text-sm text-neutral-400">(no output)</p>
              )}
            </div>
          )}

          {/* Best-effort disclaimer, verbatim in spirit with the README. */}
          <p className="border-t border-neutral-200 pt-3 text-[11px] leading-relaxed text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
            Best-effort sandbox, not a security boundary: commands run as you, with
            OpenBin&apos;s own privileges. Only approve commands you would run yourself.
          </p>
        </div>
      </div>
    </div>
  )
}
