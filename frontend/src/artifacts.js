// Parse <artifact type="..." title="...</artifact> blocks out of a message.
// The rules for writing them live in the default system prompt.

const ARTIFACT_RE = /<artifact\s+type="([^"]*)"\s+title="([^"]*)">([\s\S]*?)<\/artifact>/g

// Models like to wrap the whole artifact body in one markdown code fence.
// Strip it (preview, Code tab, copy and download should never show it) and
// keep the fence's language hint - it is the only hint a type="code" body
// has about what language it is written in.
function stripFences(raw) {
  const text = String(raw || '').replace(/^\n+|\n+$/g, '')
  const lines = text.split('\n')
  const open = /^```([A-Za-z0-9+#-]*)\s*$/.exec(lines[0].trim())
  if (!open) return { body: text, hint: '' }
  const hint = (open[1] || '').toLowerCase()
  const last = lines.length - 1
  if (lines[last].trim() === '```') {
    return { body: lines.slice(1, last).join('\n'), hint }
  }
  // Opening fence with no closing one: drop just that line.
  return { body: lines.slice(1).join('\n'), hint }
}

export function extractArtifacts(content) {
  const text = String(content || '')
  const artifacts = []
  let match
  ARTIFACT_RE.lastIndex = 0
  while ((match = ARTIFACT_RE.exec(text)) !== null) {
    const { body, hint } = stripFences(match[3])
    artifacts.push({
      type: (match[1] || 'code').trim().toLowerCase(),
      title: (match[2] || 'Artifact').trim() || 'Artifact',
      body,
      lang: hint,
      start: match.index,
      end: ARTIFACT_RE.lastIndex,
    })
  }
  if (artifacts.length === 0) return { text, artifacts: [] }

  // Message minus the artifact blocks (they show in the panel instead).
  let out = ''
  let cursor = 0
  for (const a of artifacts) {
    out += text.slice(cursor, a.start)
    cursor = a.end
  }
  out += text.slice(cursor)
  return { text: out.replace(/\n{3,}/g, '\n\n').trim(), artifacts }
}

const EXT = { html: 'html', react: 'jsx', svg: 'svg', markdown: 'md', code: 'txt' }

export function artifactFilename(a) {
  const slug = (a.title || 'artifact')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'artifact'
  return `${slug}.${EXT[a.type] || 'txt'}`
}

export function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
