import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

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

export default function Message({ message, streaming }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const copyButton = message.content ? (
    <button
      onClick={copy}
      className="mt-1 shrink-0 rounded-lg p-1.5 text-neutral-400 opacity-0 transition hover:bg-neutral-200 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-neutral-800"
      aria-label="Copy message"
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  ) : null

  if (message.role === 'user') {
    return (
      <div className="group flex items-start justify-end gap-2">
        <div className="max-w-[85%] rounded-3xl bg-neutral-200 px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap break-words dark:bg-neutral-800">
          {message.content}
        </div>
        {copyButton}
      </div>
    )
  }

  const showTyping = streaming && !message.content

  return (
    <div className="group flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {showTyping ? (
          <div className="flex items-center gap-1.5 py-2">
            <span className="typing-dot h-2 w-2 rounded-full bg-neutral-400 dark:bg-neutral-500" />
            <span className="typing-dot h-2 w-2 rounded-full bg-neutral-400 dark:bg-neutral-500" />
            <span className="typing-dot h-2 w-2 rounded-full bg-neutral-400 dark:bg-neutral-500" />
          </div>
        ) : (
          <div className="md">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[[rehypeHighlight, { languages: LANGUAGES, detect: false }]]}
              components={mdComponents}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
      {copyButton}
    </div>
  )
}
