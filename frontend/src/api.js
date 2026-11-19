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

  listProviders: () => request('/api/providers'),
  createProvider: (data) => request('/api/providers', { method: 'POST', body: JSON.stringify(data) }),
  updateProvider: (id, data) => request(`/api/providers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProvider: (id) => request(`/api/providers/${id}`, { method: 'DELETE' }),
  activateProvider: (id) => request(`/api/providers/${id}/activate`, { method: 'POST' }),
  providerModels: (id) => request(`/api/providers/${id}/models`),
  testProvider: (id, data) => request(`/api/providers/${id}/test`, { method: 'POST', body: JSON.stringify(data) }),
  togglePinned: (id, model) => request(`/api/providers/${id}/pinned`, { method: 'POST', body: JSON.stringify({ model }) }),

  listChats: (q) => request(q ? `/api/chats?q=${encodeURIComponent(q)}` : '/api/chats'),
  createChat: () => request('/api/chats', { method: 'POST' }),
  renameChat: (id, title) => request(`/api/chats/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  updateChat: (id, data) => request(`/api/chats/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteChat: (id) => request(`/api/chats/${id}`, { method: 'DELETE' }),
  getMessages: (id) => request(`/api/chats/${id}/messages`),
  saveChatSettings: (id, data) => request(`/api/chats/${id}/settings`, { method: 'PUT', body: JSON.stringify(data) }),
  autoTitle: (id) => request(`/api/chats/${id}/auto-title`, { method: 'POST', body: '{}' }),
  importChat: (data) => request('/api/chats/import', { method: 'POST', body: JSON.stringify(data) }),

  editMessage: (id, content) => request(`/api/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ content }) }),
  deleteMessage: (id) => request(`/api/messages/${id}`, { method: 'DELETE' }),

  testSearch: (query) => request('/api/search/test', { method: 'POST', body: JSON.stringify({ query }) }),
  testFetch: (url) => request('/api/fetch/test', { method: 'POST', body: JSON.stringify({ url }) }),

  uploadFile: async (file, chatId) => {
    const fd = new FormData()
    fd.append('file', file)
    const url = chatId != null ? `/api/files?chat_id=${chatId}` : '/api/files'
    const res = await fetch(url, { method: 'POST', body: fd })
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* not JSON */
    }
    if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`)
    return data
  },
}
