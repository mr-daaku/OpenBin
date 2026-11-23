import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Copy, ExternalLink, FileText, Globe, Image, Info, Loader2, Pencil, RefreshCw, Search, Sparkles, Trash2, TriangleAlert, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { extractArtifacts } from '../artifacts.js'
import { loadRehype } from '../highlight.js'

// Math support is optional and heavy - only pull it in if a message actually
// uses $...$ / $$...$$, and only once per session.
let mathPromise = null
function loadMath() {
  if (!mathPromise) {
    mathPromise = Promise.all([
      import('remark-math'),
      import('rehype-katex'),
      import('katex/dist/katex.min.css'),
    ]).then(([remark, rehype]) => ({ remark: remark.default, rehype: rehype.default }))
  }
  return mathPromise
}

// Syntax highlighting (highlight.js + a small language set) loads once, only
// when a message actually contains a code block.
function useHighlight(active) {
  const [hl, setHl] = useState(null)
  useEffect(() => {
    if (!active) return
    let alive = true
    loadRehype()
      .then((p) => alive && setHl(p))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [active])
  return hl
}

const MATH_RE = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|(?<!\\)\$(?!\s)[^$\n]+?(?<!\s)(?<!\\)\$)/

function useMathPlugins(active) {
  const [plugins, setPlugins] = useState(null)
  useEffect(() => {
    if (!active) return
    let alive = true
    loadMath().then((p) => alive && setPlugins(p)).catch(() => {})
    return () => {
      alive = false
    }
  }, [active])
  return plugins
}

function toText(node) {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(toText).join('')
  return toText(node.props?.children)
}

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 transition hover:bg-neutral-300/60 dark:hover:bg-neutral-700/60"
      aria-label={label}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  )
}

function CodeBlock({ lang, text, children }) {
  return (
    <div className="code-shell">
      <div className="code-header">
        <span>{lang || 'code'}</span>
        <CopyButton text={text} />
      </div>
      {children}
    </div>
  )
}

const mdComponents = {
  pre: ({ node, children, ...props }) => {
    const inner = Array.isArray(children) ? children[0] : children
    const lang = /language-(\w+)/.exec(inner?.props?.className || '')?.[1] || ''
    return (
      <CodeBlock lang={lang} text={toText(children)}>
        <pre {...props}>{children}</pre>
      </CodeBlock>
    )
  },
  code: ({ node, className, children, ...props }) => (
    <code className={className} {...props}>
      {children}
    </code>
  ),
}

function ActionButton({ onClick, label, children, danger }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-lg p-1.5 opacity-0 transition focus:opacity-100 group-hover:opacity-100 ${
        danger
          ? 'text-neutral-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950/50'
          : 'text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
      }`}
    >
      {children}
    </button>
  )
}

function Attachments({ files, onRegenerate }) {
  if (!files?.length) return null
  return (
    <div className="mb-1.5 flex flex-wrap gap-2">
      {files.map((f) =>
        f.kind === 'image' && f.url ? (
          <div key={f.id} className="relative group">
            <a href={f.url} target="_blank" rel="noreferrer">
              <img
                src={f.url}
                alt={f.name}
                className="max-h-40 max-w-[240px] rounded-xl border border-neutral-200 object-cover dark:border-neutral-700"
              />
            </a>
            {f.generated && onRegenerate && (
              <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRegenerate(f.id) }}
                  className="rounded-lg bg-white/90 p-1.5 hover:bg-white dark:bg-neutral-800/90 dark:hover:bg-neutral-700"
                  title="Regenerate"
                >
                  <RefreshCw size={12} />
                </button>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText(f.url) }}
                  className="rounded-lg bg-white/90 p-1.5 hover:bg-white dark:bg-neutral-800/90 dark:hover:bg-neutral-700"
                  title="Copy link"
                >
                  <Copy size={12} />
                </button>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-white/90 p-1.5 hover:bg-white dark:bg-neutral-800/90 dark:hover:bg-neutral-700"
                  title="Open full-size"
                >
                  <ExternalLink size={12} />
                </a>
                <a
                  href={f.url}
                  download={f.name}
                  className="rounded-lg bg-white/90 p-1.5 hover:bg-white dark:bg-neutral-800/90 dark:hover:bg-neutral-700"
                  title="Download"
                >
                  <Download size={12} />
                </a>
              </div>
            )}
          </div>
        ) : (
          <a
            key={f.id}
            href={`${f.url}?download=1`}
            className="flex max-w-[240px] items-center gap-1.5 rounded-xl border border-neutral-200 bg-neutral-100 px-2.5 py-1.5 text-xs hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            title={`Download ${f.name}`}
          >
            <FileText size={14} className="shrink-0 opacity-60" />
            <span className="truncate">{f.name}</span>
          </a>
        ),
      )}
    </div>
  )
}

export default function Message({
  message,
  streaming,
  busy,
  onRegenerate,
  onEdit,
  onDelete,
  onOpenArtifact,
}) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)

  const isUser = message.role === 'user'
  const hasActions = !streaming && !busy && typeof onEdit === 'function'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const startEdit = () => {
    setDraft(message.content)
    setEditing(true)
  }

  const saveEdit = async () => {
    const text = draft.trim()
    setEditing(false)
    if (!text || text === message.content) return
    await onEdit(message.id, text)
  }

  if (isUser) {
    return (
      <div className="group flex items-start justify-end gap-2">
        {hasActions && (
          <div className="flex shrink-0 items-center pt-1">
            <ActionButton onClick={startEdit} label="Edit and resend">
              <Pencil size={14} />
            </ActionButton>
            <ActionButton onClick={() => onDelete(message.id)} label="Delete message" danger>
              <Trash2 size={14} />
            </ActionButton>
            <ActionButton onClick={copy} label="Copy message">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </ActionButton>
          </div>
        )}
        <div className="max-w-[85%] rounded-3xl bg-neutral-200 px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap break-words dark:bg-neutral-800">
          <Attachments files={message.files} onRegenerate={onRegenerate} />
          {message.content}
        </div>
      </div>
    )
  }

  const showTyping = streaming && !message.content
  const modelBadge = message.model ? (
    <span
      className="mb-1 inline-block max-w-full truncate rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
      title={message.model}
    >
      {message.model}
    </span>
  ) : null

  const body = editing ? (
    <div className="space-y-2">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(14, Math.max(3, draft.split('\n').length + 1))}
        className="scroll-slim w-full resize-y rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800"
      />
      <div className="flex gap-2">
        <button
          onClick={saveEdit}
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
        >
          Save &amp; resend
        </button>
        <button
          onClick={() => setEditing(false)}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </div>
  ) : showTyping ? (
    <div className="flex items-center gap-1.5 py-2">
      <span className="typing-dot h-2 w-2 rounded-full bg-neutral-400 dark:bg-neutral-500" />
      <span className="typing-dot h-2 w-2 rounded-full bg-neutral-400 dark:bg-neutral-500" />
      <span className="typing-dot h-2 w-2 rounded-full bg-neutral-400 dark:bg-neutral-500" />
    </div>
  ) : (
    <MarkdownBody content={message.content} onOpenArtifact={onOpenArtifact} />
  )

  return (
    <div className="group flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {modelBadge}
        {body}
        {!editing && message.sources?.length > 0 && <SourceCards sources={message.sources} />}
        {!editing && message.steps?.length > 0 && <StepsPanel steps={message.steps} live={streaming} />}
        {hasActions && !editing && (
          <div className="mt-1 flex items-center gap-0.5">
            {!isUser && (
              <ActionButton onClick={() => onRegenerate(message.id)} label="Regenerate">
                <RefreshCw size={14} />
              </ActionButton>
            )}
            <ActionButton onClick={startEdit} label="Edit and resend">
              <Pencil size={14} />
            </ActionButton>
            <ActionButton onClick={() => onDelete(message.id)} label="Delete message" danger>
              <Trash2 size={14} />
            </ActionButton>
            <ActionButton onClick={copy} label="Copy message">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </ActionButton>
          </div>
        )}
      </div>
      {editing && (
        <button onClick={() => setEditing(false)} className="shrink-0 rounded p-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" aria-label="Cancel edit">
          <X size={15} />
        </button>
      )}
    </div>
  )
}

const STEP_STYLE = {
  plan: { icon: Sparkles, className: 'text-violet-500 dark:text-violet-400' },
  search: { icon: Search, className: 'text-sky-600 dark:text-sky-400' },
  fetch: { icon: Globe, className: 'text-emerald-600 dark:text-emerald-400' },
  image: { icon: Image, className: 'text-fuchsia-600 dark:text-fuchsia-400' },
  answer: { icon: Check, className: 'text-neutral-500 dark:text-neutral-400' },
  info: { icon: Info, className: 'text-neutral-400 dark:text-neutral-500' },
  notice: { icon: TriangleAlert, className: 'text-amber-600 dark:text-amber-400' },
}

function StepRow({ step, active }) {
  const style = STEP_STYLE[step.kind] || STEP_STYLE.info
  const Icon = style.icon
  const notice = step.kind === 'notice'
  return (
    <div
      className={`flex items-start gap-1.5 text-[11px] leading-4 ${
        notice ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-500 dark:text-neutral-400'
      }`}
    >
      {active ? (
        <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin opacity-70" />
      ) : (
        <Icon size={12} className={`mt-0.5 shrink-0 ${style.className}`} />
      )}
      <span className="min-w-0 break-words">{step.text}</span>
    </div>
  )
}

function StepsPanel({ steps, live }) {
  if (live) {
    return (
      <div className="mt-2 space-y-1">
        {steps.map((s, i) => (
          <StepRow key={`${s.kind}-${i}`} step={s} active={i === steps.length - 1} />
        ))}
      </div>
    )
  }
  return (
    <details className="group mt-2">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-medium text-neutral-400 transition select-none hover:bg-neutral-100 [&::-webkit-details-marker]:hidden dark:text-neutral-500 dark:hover:bg-neutral-800">
        <ChevronDown size={12} className="transition group-open:rotate-180" />
        Sources &amp; steps
        <span className="text-neutral-300 dark:text-neutral-600">· {steps.length}</span>
      </summary>
      <div className="mt-1 space-y-1 pl-1">
        {steps.map((s, i) => (
          <StepRow key={`${s.kind}-${i}`} step={s} />
        ))}
      </div>
    </details>
  )
}

function SourceCards({ sources }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((s, i) => {
        let host = ''
        try {
          host = new URL(s.url).hostname.replace(/^www\./, '')
        } catch {
          host = ''
        }
        return (
          <a
            key={`${s.url}-${i}`}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="flex max-w-[270px] items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 transition hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-500"
            title={s.title}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-medium">
                <span className="mr-1 font-mono text-neutral-400">[{i + 1}]</span>
                {s.title}
              </span>
              <span className="block truncate text-[10px] text-neutral-400 dark:text-neutral-500">
                {host}
                {s.published ? ` · ${s.published}` : ''}
              </span>
            </span>
            <ExternalLink size={12} className="shrink-0 opacity-50" />
          </a>
        )
      })}
    </div>
  )
}

function ArtifactChips({ artifacts, onOpen }) {
  if (!artifacts.length) return null
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {artifacts.map((a, i) => (
        <button
          key={`${a.start}-${i}`}
          onClick={() => onOpen(a)}
          className="flex max-w-[280px] items-center gap-2 rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-left transition hover:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-500"
          title={`Open ${a.title}`}
        >
          <span className="shrink-0 rounded bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-white dark:bg-white dark:text-neutral-900">
            {a.type}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{a.title}</span>
          <ExternalLink size={13} className="shrink-0 opacity-50" />
        </button>
      ))}
    </div>
  )
}

function MarkdownBody({ content, onOpenArtifact }) {
  const { text, artifacts } = useMemo(() => extractArtifacts(content), [content])
  const math = useMathPlugins(MATH_RE.test(text))
  const hl = useHighlight(/```/.test(text))
  const plugins = [remarkGfm]
  const rehype = []
  if (hl) {
    // detect: guesses the language for fences without a hint, but only
    // among the languages this app registers.
    rehype.push([hl.rehypeHighlight, { languages: hl.languages, detect: true }])
  }
  if (math) {
    plugins.push(math.remark)
    rehype.push([math.rehype, { throwOnError: false }])
  }
  return (
    <div className="md">
      <ArtifactChips artifacts={artifacts} onOpen={onOpenArtifact} />
      {text && (
        <ReactMarkdown remarkPlugins={plugins} rehypePlugins={rehype} components={mdComponents}>
          {text}
        </ReactMarkdown>
      )}
      {!text && artifacts.length > 0 && (
        <p className="text-xs text-neutral-400">Artifact ready - open the card above to view it.</p>
      )}
    </div>
  )
}
