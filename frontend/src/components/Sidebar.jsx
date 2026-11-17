import { useState } from 'react'
import { Pencil, Plus, Settings, Trash2, X, Check } from 'lucide-react'

export default function Sidebar({ chats, activeId, open, onNew, onSelect, onRename, onDelete, onOpenSettings, onClose }) {
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState('')

  const startRename = (chat) => {
    setEditingId(chat.id)
    setDraft(chat.title)
  }

  const commitRename = () => {
    const title = draft.trim()
    if (title) onRename(editingId, title)
    setEditingId(null)
  }

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

        <div className="px-3 pb-2">
          <button
            onClick={onNew}
            className="flex w-full items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            <Plus size={16} />
            New Chat
          </button>
        </div>

        <nav className="scroll-slim flex-1 overflow-y-auto px-3 pb-3">
          {chats.length === 0 && (
            <p className="px-2 py-4 text-xs text-neutral-400">No chats yet.</p>
          )}
          <ul className="space-y-1">
            {chats.map((chat) => (
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
                      className="min-w-0 flex-1 truncate text-left"
                      title={chat.title}
                    >
                      {chat.title}
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
        </nav>

        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <button
            onClick={onOpenSettings}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-neutral-200 dark:hover:bg-neutral-800"
          >
            <Settings size={16} />
            Settings
          </button>
        </div>
      </aside>
    </>
  )
}
