import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, ExternalLink, FileText, Pencil, RefreshCw, Trash2, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { extractArtifacts } from '../artifacts.js'

// Only a handful of languages are registered to keep the bundle small.
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'

const LANGUAGES = { javascript, typescript, python, bash, json, xml, css, sql }

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

function Attachments({ files }) {
  if (!files?.length) return null
  return (
    <div className="mb-1.5 flex flex-wrap gap-2">
      {files.map((f) =>
        f.kind === 'image' && f.url ? (
          <a key={f.id} href={f.url} target="_blank" rel="noreferrer">
            <img
              src={f.url}
              alt={f.name}
              className="max-h-40 max-w-[240px] rounded-xl border border-neutral-200 object-cover dark:border-neutral-700"
            />
          </a>
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
          <Attachments files={message.files} />
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
  const plugins = [remarkGfm]
  const rehype = [[rehypeHighlight, { languages: LANGUAGES, detect: false }]]
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
