import { useCallback, useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import ChatWindow from './components/ChatWindow.jsx'
import SettingsPage from './components/SettingsPage.jsx'
import { api } from './api.js'
import useChat from './useChat.js'

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme !== 'light')
}

export default function App() {
  const [settings, setSettings] = useState(null)
  const [settingsPage, setSettingsPage] = useState(false)
  const [chats, setChats] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [fatal, setFatal] = useState(null)
  const [modelByChat, setModelByChat] = useState({})
  const [modelCaps, setModelCaps] = useState({}) // modelId -> {vision, image_gen, tools, reasoning}
  const [chatSettings, setChatSettings] = useState({})
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  // Web search mode for the chat input: off | auto | always | research.
  const [searchMode, setSearchMode] = useState(() => {
    try {
      return localStorage.getItem('openbin.searchMode') || 'auto'
    } catch {
      return 'auto'
    }
  })

  const changeSearchMode = useCallback((mode) => {
    setSearchMode(mode)
    try {
      localStorage.setItem('openbin.searchMode', mode)
    } catch {
      /* private mode - the choice just will not persist */
    }
  }, [])

  const queryRef = useRef('')
  queryRef.current = query

  const refreshChats = useCallback(
    () => api.listChats(queryRef.current).then((rows) => setChats(rows)),
    [],
  )

  const activeChat = chats.find((c) => c.id === activeId)
  const incognito = !!activeChat?.incognito
  const currentModel = modelByChat[activeId] || settings?.model || ''

  const { messages, streaming, error, stopReason, send, stop, clearError, showError, regenerate, editAndResend, removeMessage, continueReply } =
    useChat(activeId, refreshChats, { incognito, searchMode })

  // Sidebar search (debounced server-side search over titles + message text).
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .listChats(query)
        .then((rows) => setChats(rows))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  // First launch: load settings + chats, open Settings page at Providers when no API key yet.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [st, rows] = await Promise.all([api.getSettings(), api.listChats()])
        if (!alive) return
        setSettings(st)
        applyTheme(st.theme)
        if (rows.length) {
          setChats(rows)
          setActiveId(rows[0].id)
        } else {
          const chat = await api.createChat()
          if (!alive) return
          setChats([chat])
          setActiveId(chat.id)
        }
        if (!st.has_api_key) {
          setSettingsPage(true)
          location.hash = '/settings/providers/providers'
        }
      } catch (err) {
        if (alive) setFatal(err.message)
      } finally {
        if (alive) setReady(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Open Settings page when hash navigates to /settings/...
  useEffect(() => {
    const onHash = () => {
      if (location.hash.startsWith('#/settings/')) {
        setSettingsPage(true)
      } else if (settingsPage) {
        setSettingsPage(false)
      }
    }
    window.addEventListener('hashchange', onHash)
    // Also check initial hash on mount
    onHash()
    return () => window.removeEventListener('hashchange', onHash)
  }, [settingsPage])

  const handleNew = useCallback(async () => {
    try {
      const chat = await api.createChat()
      setChats((prev) => [chat, ...prev])
      setActiveId(chat.id)
      setSidebarOpen(false)
      clearError()
    } catch (err) {
      showError(err.message)
    }
  }, [clearError, showError])

  const handleNewIncognito = useCallback(async () => {
    try {
      const chat = await api.createChat()
      const marked = await api.updateChat(chat.id, { incognito: true })
      setChats((prev) => [marked, ...prev])
      setActiveId(marked.id)
      setSidebarOpen(false)
      clearError()
    } catch (err) {
      showError(err.message)
    }
  }, [clearError, showError])

  const handleRename = async (id, title) => {
    try {
      const updated = await api.renameChat(id, title)
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)))
    } catch (err) {
      showError(err.message)
    }
  }

  const handleTogglePin = async (chat) => {
    try {
      const updated = await api.updateChat(chat.id, { pinned: !chat.pinned })
      setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, ...updated } : c)))
    } catch (err) {
      showError(err.message)
    }
  }

  const handleImport = async (data) => {
    try {
      const chat = await api.importChat(data)
      setQuery('')
      await refreshChats()
      setActiveId(chat.id)
      setSidebarOpen(false)
    } catch (err) {
      showError(err.message)
      throw err
    }
  }

  const handleDelete = async (chat) => {
    if (!window.confirm(`Delete "${chat.title}"? This cannot be undone.`)) return
    try {
      await api.deleteChat(chat.id)
      const remaining = chats.filter((c) => c.id !== chat.id)
      setChats(remaining)
      if (activeId === chat.id) {
        if (remaining.length) {
          setActiveId(remaining[0].id)
        } else {
          const fresh = await api.createChat()
          setChats([fresh])
          setActiveId(fresh.id)
        }
      }
    } catch (err) {
      showError(err.message)
    }
  }

  const handleSettingsSaved = (saved, opts = {}) => {
    setSettings(saved)
    applyTheme(saved.theme)
    if (!opts.keepOpen) setSettingsPage(false)
    refreshChats()
  }

  const handleSend = (text, files) => send(text, { model: currentModel, files })

  const handleChatSettings = async (patch, clear = []) => {
    try {
      const updated = await api.saveChatSettings(activeId, { ...patch, clear })
      setChatSettings((prev) => ({ ...prev, [activeId]: updated.settings }))
      setChats((prev) => prev.map((c) => (c.id === activeId ? { ...c, ...updated } : c)))
      if (patch.model !== undefined || clear.includes('model')) {
        setModelByChat((prev) => ({ ...prev, [activeId]: patch.model || settings.model }))
      }
      return updated.settings
    } catch (err) {
      showError(err.message)
      return null
    }
  }

  const handleAutoTitle = async () => {
    setBusy(true)
    try {
      const updated = await api.autoTitle(activeId)
      setChats((prev) => prev.map((c) => (c.id === activeId ? { ...c, ...updated } : c)))
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleToggleIncognito = async () => {
    setBusy(true)
    try {
      const updated = await api.updateChat(activeId, { incognito: !incognito })
      setChats((prev) => prev.map((c) => (c.id === activeId ? { ...c, ...updated } : c)))
    } catch (err) {
      showError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Keyboard shortcuts: Ctrl+K search, Ctrl+Shift+O new chat, Esc stop.
  useEffect(() => {
    const onKey = (e) => {
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && key === 'k') {
        e.preventDefault()
        setSidebarOpen(true)
        setTimeout(() => document.getElementById('chat-search')?.focus(), 50)
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'o') {
        e.preventDefault()
        handleNew()
      } else if (e.key === 'Escape' && streaming) {
        stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [streaming, stop, handleNew])

  if (fatal) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-lg font-semibold">Can&apos;t reach the backend</h1>
          <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
            Start it from the <code className="rounded bg-neutral-200 px-1 dark:bg-neutral-800">backend</code> folder:
          </p>
          <code className="block rounded-xl bg-neutral-200 px-4 py-3 text-sm dark:bg-neutral-800">
            venv\Scripts\uvicorn main:app --reload --port 8000
          </code>
          <p className="mt-4 text-xs text-neutral-400">{fatal}</p>
        </div>
      </div>
    )
  }

  if (!ready) return null

  return (
    <div className="flex h-full">
      <Sidebar
        chats={chats}
        activeId={activeId}
        open={sidebarOpen}
        query={query}
        onQueryChange={setQuery}
        onNew={handleNew}
        onNewIncognito={handleNewIncognito}
        onSelect={(id) => {
          setActiveId(id)
          setSidebarOpen(false)
          clearError()
        }}
        onRename={handleRename}
        onDelete={handleDelete}
        onTogglePin={handleTogglePin}
        onImport={handleImport}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <ChatWindow
          title={activeChat?.title || 'OpenBin'}
          chatId={activeId}
          messages={messages}
          streaming={streaming}
          error={error}
          stopReason={stopReason}
          onDismissError={clearError}
          onSend={handleSend}
          onStop={stop}
          onOpenSidebar={() => setSidebarOpen(true)}
          model={currentModel}
          modelCaps={modelCaps[currentModel] || {}}
          onModelChange={async (m) => {
            setModelByChat((prev) => ({ ...prev, [activeId]: m }))
            handleChatSettings({ model: m })
            // Fetch capabilities for the new model
            try {
              const provs = await api.listProviders()
              const active = provs.find((p) => p.is_active) || provs[0]
              if (active) {
                const data = await api.providerModels(active.id)
                const caps = data.models?.find((mm) => mm.id === m)
                if (caps) {
                  setModelCaps((prev) => ({ ...prev, [m]: { vision: caps.vision, image_gen: caps.image_gen, tools: caps.tools, reasoning: caps.reasoning } }))
                }
              }
            } catch { /* ignore */ }
          }}
          chatSettings={chatSettings[activeId] || {}}
          onSaveChatSettings={handleChatSettings}
          defaultModel={settings.model}
          onRegenerate={(id) => regenerate(id, currentModel)}
          onEdit={(id, content) => editAndResend(id, content, currentModel)}
          onDelete={removeMessage}
          onContinue={() => continueReply(currentModel)}
          onAutoTitle={handleAutoTitle}
          onToggleIncognito={handleToggleIncognito}
          incognito={incognito}
          busy={busy || streaming}
          searchMode={searchMode}
          onSearchModeChange={changeSearchMode}
        />
      </main>

      {settingsPage && settings && (
        <SettingsPage
          settings={settings}
          onClose={() => {
            setSettingsPage(false)
            location.hash = ''
          }}
          onSaved={handleSettingsSaved}
        />
      )}
    </div>
  )
}
