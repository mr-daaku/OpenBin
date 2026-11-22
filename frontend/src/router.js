// History-API router: real paths in the address bar instead of #hash.
//
// Routes:
//   /                     -> default (current chat)
//   /chat/<id>-<slug>     -> a specific chat   (slug is cosmetic, id wins)
//   /settings/<cat>/<tab> -> the Settings page
//
// navigate() pushes (or replaces) the URL and notifies listeners;
// onNavigate() subscribes to both pushState calls and browser back/forward.

export function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'chat'
  )
}

export function chatPath(chat) {
  if (!chat || chat.id == null) return '/'
  return `/chat/${chat.id}-${slugify(chat.title)}`
}

export function settingsPath(cat = 'general', tab = 'appearance') {
  return `/settings/${cat}/${tab}`
}

export function parsePath(pathname = window.location.pathname) {
  const p = String(pathname || '/').replace(/\/+$/, '') || '/'
  if (p === '/settings' || p.startsWith('/settings/')) {
    const parts = p.split('/').filter(Boolean) // ['settings', cat, tab]
    return { kind: 'settings', cat: parts[1] || 'general', tab: parts[2] || null }
  }
  const m = p.match(/^\/chat\/(\d+)(?:-(.*))?$/)
  if (m) return { kind: 'chat', id: Number(m[1]), slug: m[2] || '' }
  return { kind: 'home' }
}

export function navigate(path, { replace = false } = {}) {
  const url = String(path || '/')
  if (url !== window.location.pathname) {
    if (replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
  }
  // Always notify, even when the path was already current: callers use this
  // to (re)open a view whose URL has not changed.
  window.dispatchEvent(new Event('openbin:navigate'))
}

export function onNavigate(handler) {
  const fn = () => handler(parsePath())
  window.addEventListener('popstate', fn)
  window.addEventListener('openbin:navigate', fn)
  return () => {
    window.removeEventListener('popstate', fn)
    window.removeEventListener('openbin:navigate', fn)
  }
}
