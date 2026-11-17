import { useRef, useState } from 'react'
import { EyeOff, FileUp, Pin, PinOff, Pencil, Plus, Settings, Search, Trash2, X, Check } from 'lucide-react'

function groupOf(createdAt) {
  const d = new Date(String(createdAt).replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return 'Older'
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((today - that) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days <= 7) return 'Last 7 days'
  return 'Older'
}

const ORDER = ['Pinned', 'Today', 'Yesterday', 'Last 7 days', 'Older']

export default function Sidebar({
  chats,
  activeId,
  open,
  query,
  onQueryChange,
  onNew,
  onNewIncognito,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
  onImport,
  onOpenSettings,
  onClose,
}) {
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState('')
  const fileRef = useRef(null)
  const searchRef = useRef(null)

  const startRename = (chat) => {
    setEditingId(chat.id)
    setDraft(chat.title)
  }

  const commitRename = () => {
    const title = draft.trim()
    if (title) onRename(editingId, title)
    setEditingId(null)
  }

  const pickFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      const messages = Array.isArray(data) ? data : data.messages
      if (!Array.isArray(messages)) throw new Error('No "messages" array in that file.')
      await onImport({ title: data.title || file.name.replace(/\.json$/i, ''), messages })
    } catch (err) {
      window.alert(`Could not import: ${err.message}`)
    }
  }

  // Group pinned-first list into date buckets, preserving order.
  const groups = []
  for (const chat of chats) {
    const g = chat.pinned ? 'Pinned' : groupOf(chat.created_at)
    let bucket = groups.find((x) => x.name === g)
    if (!bucket) {
      bucket = { name: g, items: [] }
      groups.push(bucket)
    }
    bucket.items.push(chat)
  }
  groups.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name))

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={onClose} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-neutral-200 bg-neutral-100 transition-transform duration-200 dark:border-neutral-800 dark:bg-neutral-900 md:static md:z-auto md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-sm font-bold text-white dark:bg-white dark:text-neutral-900">
              O
            </div>
            <span className="text-[15px] font-semibold tracking-tight">OpenBin</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200 md:hidden dark:hover:bg-neutral-800"
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-2 px-3 pb-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              ref={searchRef}
              id="chat-search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search chats…  Ctrl+K"
              className="w-full rounded-xl border border-neutral-200 bg-white py-2 pl-8 pr-3 text-sm outline-none transition focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onNew}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              <Plus size={16} />
              New Chat
            </button>
            <button
              onClick={onNewIncognito}
              title="New incognito chat (not saved)"
              className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-300 px-3 py-2.5 text-sm font-medium hover:bg-neutral-200/60 dark:border-neutral-600 dark:hover:bg-neutral-800"
            >
              <EyeOff size={15} />
              Incognito
            </button>
          </div>
        </div>

        <nav className="scroll-slim flex-1 overflow-y-auto px-3 pb-3">
          {chats.length === 0 && (
            <p className="px-2 py-4 text-xs text-neutral-400">
              {query ? 'No chats match your search.' : 'No chats yet.'}
            </p>
          )}
          {groups.map((group) => (
            <div key={group.name} className="mb-3">
              <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                {group.name}
              </p>
              <ul className="space-y-1">
                {group.items.map((chat) => (
                  <li key={chat.id}>
                    {editingId === chat.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-600 dark:bg-neutral-800"
                        />
                        <button onClick={commitRename} className="rounded-lg p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700" aria-label="Save name">
                          <Check size={15} />
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${
                          chat.id === activeId
                            ? 'bg-neutral-200 dark:bg-neutral-800'
                            : 'hover:bg-neutral-200 dark:hover:bg-neutral-800'
                        }`}
                      >
                        <button
                          onClick={() => onSelect(chat.id)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                          title={chat.title}
                        >
                          {chat.incognito && <EyeOff size={12} className="shrink-0 text-neutral-400" />}
                          <span className="truncate">{chat.title}</span>
                        </button>
                        <button
                          onClick={() => onTogglePin(chat)}
                          className={`rounded p-1 hover:text-neutral-700 focus:opacity-100 dark:hover:text-neutral-200 ${
                            chat.pinned
                              ? 'text-neutral-600 opacity-100 dark:text-neutral-300'
                              : 'text-neutral-400 opacity-0 group-hover:opacity-100'
                          }`}
                          aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'}
                        >
                          {chat.pinned ? <Pin size={14} /> : <PinOff size={14} />}
                        </button>
                        <button
                          onClick={() => startRename(chat)}
                          className="rounded p-1 text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-neutral-700 focus:opacity-100 dark:hover:text-neutral-200"
                          aria-label="Rename chat"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => onDelete(chat)}
                          className="rounded p-1 text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-red-500 focus:opacity-100"
                          aria-label="Delete chat"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} className="hidden" />
          <div className="mb-1.5 grid grid-cols-2 gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              <FileUp size={15} />
              Import
            </button>
            <button
              onClick={onOpenSettings}
              className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-neutral-200 dark:hover:bg-neutral-800"
            >
              <Settings size={15} />
              Settings
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
