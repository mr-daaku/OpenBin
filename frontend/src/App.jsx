import { useCallback, useEffect, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import ChatWindow from './components/ChatWindow.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import { api } from './api.js'
import useChat from './useChat.js'

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme !== 'light')
}

export default function App() {
  const [settings, setSettings] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chats, setChats] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [fatal, setFatal] = useState(null)
  const [modelByChat, setModelByChat] = useState({})
  const [chatSettings, setChatSettings] = useState({})

  const refreshChats = useCallback(
    () => api.listChats().then((rows) => setChats(rows)),
    [],
  )

  const { messages, streaming, error, send, stop, clearError, showError } = useChat(
    activeId,
    refreshChats,
  )

  // Per-chat overrides (model, temperature, ...) travel with the chat row.
  useEffect(() => {
    if (activeId == null) return
    const chat = chats.find((c) => c.id === activeId)
    if (!chat) return
    setChatSettings((prev) => ({ ...prev, [activeId]: chat.settings || {} }))
    setModelByChat((prev) =>
      prev[activeId] ? prev : { ...prev, [activeId]: chat.settings?.model || settings?.model || '' },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, chats])

  // First launch: load settings + chats, open Settings when no API key yet.
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
        if (!st.has_api_key) setSettingsOpen(true)
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

  const handleNew = async () => {
    try {
      const chat = await api.createChat()
      setChats((prev) => [chat, ...prev])
      setActiveId(chat.id)
      setSidebarOpen(false)
      clearError()
    } catch (err) {
      showError(err.message)
    }
  }

  const handleRename = async (id, title) => {
    try {
      const updated = await api.renameChat(id, title)
      setChats((prev) => prev.map((c) => (c.id === id ? updated : c)))
    } catch (err) {
      showError(err.message)
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
    if (!opts.keepOpen) setSettingsOpen(false)
    refreshChats()
  }

  const handleSend = (text) => send(text, { model: modelByChat[activeId] || '' })

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

  const activeChat = chats.find((c) => c.id === activeId)

  return (
    <div className="flex h-full">
      <Sidebar
        chats={chats}
        activeId={activeId}
        open={sidebarOpen}
        onNew={handleNew}
        onSelect={(id) => {
          setActiveId(id)
          setSidebarOpen(false)
          clearError()
        }}
        onRename={handleRename}
        onDelete={handleDelete}
        onOpenSettings={() => setSettingsOpen(true)}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <ChatWindow
          title={activeChat?.title || 'OpenBin'}
          messages={messages}
          streaming={streaming}
          error={error}
          onDismissError={clearError}
          onSend={handleSend}
          onStop={stop}
          onOpenSidebar={() => setSidebarOpen(true)}
          model={modelByChat[activeId] || settings.model}
          onModelChange={(m) => {
            setModelByChat((prev) => ({ ...prev, [activeId]: m }))
            handleChatSettings({ model: m })
          }}
          chatSettings={chatSettings[activeId] || {}}
          onSaveChatSettings={handleChatSettings}
          defaultModel={settings.model}
        />
      </main>

      {settingsOpen && settings && (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={handleSettingsSaved}
        />
      )}
    </div>
  )
}
