// Tiny fetch wrapper for the local backend (proxied by Vite, so no CORS).
async function request(url, options = {}) {
  const opts = { ...options }
  if (opts.body) opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  const res = await fetch(url, opts)
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const detail = data?.detail
    throw new Error(typeof detail === 'string' ? detail : data?.error || `Request failed (${res.status})`)
  }
  return data
}

export const api = {
  getSettings: () => request('/api/settings'),
  saveSettings: (settings) => request('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  testSettings: (settings) => request('/api/settings/test', { method: 'POST', body: JSON.stringify(settings) }),
  getModels: () => request('/api/models'),

  listChats: () => request('/api/chats'),
  createChat: () => request('/api/chats', { method: 'POST' }),
  renameChat: (id, title) => request(`/api/chats/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  deleteChat: (id) => request(`/api/chats/${id}`, { method: 'DELETE' }),
  getMessages: (id) => request(`/api/chats/${id}/messages`),
}
