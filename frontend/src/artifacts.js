// Parse <artifact type="..." title="...</artifact> blocks out of a message.
// The rules for writing them live in the default system prompt.

const ARTIFACT_RE = /<artifact\s+type="([^"]*)"\s+title="([^"]*)">([\s\S]*?)<\/artifact>/g

export function extractArtifacts(content) {
  const text = String(content || '')
  const artifacts = []
  let match
  ARTIFACT_RE.lastIndex = 0
  while ((match = ARTIFACT_RE.exec(text)) !== null) {
    artifacts.push({
      type: (match[1] || 'code').trim().toLowerCase(),
      title: (match[2] || 'Artifact').trim() || 'Artifact',
      body: match[3].replace(/^\n+|\n+$/g, ''),
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
