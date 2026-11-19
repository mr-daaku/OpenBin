// highlight.js, loaded only when code is actually shown - the first chat
// message with a code block, or an artifact's Code tab. Only the languages
// OpenBin ever displays are registered, which keeps the lazy chunk small.
// Both the chat renderer and the artifact panel share this one loader, so
// the languages are fetched at most once per session.

export const LANG_NAMES = [
  'xml',
  'css',
  'javascript',
  'typescript',
  'python',
  'json',
  'bash',
  'sql',
  'markdown',
]

// fence hint / artifact type -> registered language (null = auto-detect).
// html/svg map to xml, react/jsx to javascript, md to markdown.
const CANON = {
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  xml: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  react: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  python3: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  md: 'markdown',
  markdown: 'markdown',
}

export function resolveLang(hint) {
  const h = String(hint || '')
    .trim()
    .toLowerCase()
  if (!h) return null
  if (LANG_NAMES.includes(h)) return h
  return CANON[h] || null
}

let langPromise = null
function loadLanguages() {
  if (!langPromise) {
    langPromise = Promise.all([
      import('highlight.js/lib/languages/xml'),
      import('highlight.js/lib/languages/css'),
      import('highlight.js/lib/languages/javascript'),
      import('highlight.js/lib/languages/typescript'),
      import('highlight.js/lib/languages/python'),
      import('highlight.js/lib/languages/json'),
      import('highlight.js/lib/languages/bash'),
      import('highlight.js/lib/languages/sql'),
      import('highlight.js/lib/languages/markdown'),
    ]).then((mods) => {
      const defs = {}
      LANG_NAMES.forEach((name, i) => {
        defs[name] = mods[i].default
      })
      return defs
    })
  }
  return langPromise
}

// rehype-highlight plugin pair, for chat code blocks (lazy).
let rehypePromise = null
export function loadRehype() {
  if (!rehypePromise) {
    rehypePromise = Promise.all([import('rehype-highlight'), loadLanguages()]).then(
      ([rehype, languages]) => ({ rehypeHighlight: rehype.default, languages }),
    )
  }
  return rehypePromise
}

// A ready-to-use highlight.js instance, for direct highlighting (lazy).
let hljsPromise = null
export function loadHljs() {
  if (!hljsPromise) {
    hljsPromise = Promise.all([import('highlight.js/lib/core'), loadLanguages()]).then(
      ([core, languages]) => {
        const hljs = core.default
        for (const name of LANG_NAMES) hljs.registerLanguage(name, languages[name])
        return hljs
      },
    )
  }
  return hljsPromise
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Highlight `code` to an HTML string. Falls back to auto-detection among the
// registered languages when the hint is missing or unknown, and to escaped
// plain text if highlighting fails. Never throws.
export function highlightCode(hljs, code, hint) {
  const lang = resolveLang(hint)
  try {
    if (lang) {
      return { html: hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, lang }
    }
    const res = hljs.highlightAuto(code, LANG_NAMES)
    return { html: res.value, lang: res.language || '' }
  } catch {
    return { html: escapeHtml(code), lang: '' }
  }
}
