import { useEffect, useMemo, useState } from 'react'
import { Check, Code, Copy, Download, ExternalLink, Eye, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { artifactFilename, downloadText } from '../artifacts.js'
import { highlightCode, loadHljs } from '../highlight.js'

function HtmlPreview({ body }) {
  // sandbox="allow-scripts" lets the artifact's own JS run, nothing else.
  return (
    <iframe
      title="Artifact preview"
      sandbox="allow-scripts"
      srcDoc={body}
      className="h-full w-full border-0 bg-white"
    />
  )
}

function SvgPreview({ body }) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-white p-4">
      <div dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  )
}

function MarkdownPreview({ body }) {
  return (
    <div className="md h-full overflow-y-auto p-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  )
}

export default function ArtifactPanel({ artifact, onClose }) {
  const [tab, setTab] = useState('preview')
  const [copied, setCopied] = useState(false)

  const previewable = ['html', 'svg', 'markdown'].includes(artifact.type)
  const activeTab = previewable ? tab : 'code'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.body)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const openInTab = () => {
    const html =
      artifact.type === 'html'
        ? artifact.body
        : `<!doctype html><meta charset="utf-8"><pre style="white-space:pre-wrap;font:14px/1.6 ui-monospace,monospace;padding:16px">${artifact.body
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')}</pre>`
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  }

  const body = useMemo(() => artifact.body, [artifact])

  // Syntax highlighting loads only when the Code tab is actually shown.
  const [hljs, setHljs] = useState(null)
  useEffect(() => {
    if (activeTab !== 'code' || hljs) return
    let alive = true
    loadHljs()
      .then((h) => alive && setHljs(h))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [activeTab, hljs])

  // Language: the artifact type, except type="code" where the fence hint
  // (kept by extractArtifacts) is the better guess - else auto-detect.
  const hint = artifact.type === 'code' ? artifact.lang || '' : artifact.type
  const marked = useMemo(
    () => (hljs ? highlightCode(hljs, body, hint) : null),
    [hljs, body, hint],
  )

  return (
    <aside className="flex h-full w-full flex-col border-l border-neutral-200 bg-white md:w-[46%] md:max-w-[560px] dark:border-neutral-800 dark:bg-neutral-900">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
        <span className="rounded-md bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-white dark:bg-white dark:text-neutral-900">
          {artifact.type}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={artifact.title}>
          {artifact.title}
        </span>

        {previewable && (
          <div className="flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700">
            <button
              onClick={() => setTab('preview')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${activeTab === 'preview' ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-500'}`}
            >
              <Eye size={12} /> Preview
            </button>
            <button
              onClick={() => setTab('code')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${activeTab === 'code' ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-500'}`}
            >
              <Code size={12} /> Code
            </button>
          </div>
        )}

        <button
          onClick={copy}
          className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title="Copy code"
          aria-label="Copy code"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
        <button
          onClick={() => downloadText(artifactFilename(artifact), body)}
          className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title="Download"
          aria-label="Download artifact"
        >
          <Download size={15} />
        </button>
        <button
          onClick={openInTab}
          className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title="Open in a new tab"
          aria-label="Open in a new tab"
        >
          <ExternalLink size={15} />
        </button>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title="Close"
          aria-label="Close artifact"
        >
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1">
        {activeTab === 'preview' ? (
          artifact.type === 'html' ? (
            <HtmlPreview body={body} />
          ) : artifact.type === 'svg' ? (
            <SvgPreview body={body} />
          ) : (
            <MarkdownPreview body={body} />
          )
        ) : (
          <pre className="scroll-slim h-full overflow-auto bg-neutral-50 p-4 text-[13px] leading-6 dark:bg-neutral-950">
            {marked ? (
              <code
                className={`hljs language-${marked.lang}`}
                dangerouslySetInnerHTML={{ __html: marked.html }}
              />
            ) : (
              <code>{body}</code>
            )}
          </pre>
        )}
      </div>
    </aside>
  )
}
