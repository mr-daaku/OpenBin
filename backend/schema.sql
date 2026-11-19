CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages (chat_id);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    message_id INTEGER,
    name TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'file',
    size INTEGER NOT NULL DEFAULT 0,
    path TEXT NOT NULL,
    extracted TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    generated INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_files_message_id ON files (message_id);

CREATE TABLE IF NOT EXISTS providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    preset TEXT NOT NULL DEFAULT 'custom',
    base_url TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL DEFAULT '',
    pinned TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 0,
    img_endpoint TEXT NOT NULL DEFAULT '/images/generations',
    img_response_style TEXT NOT NULL DEFAULT 'openai',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Does this endpoint+model accept native tool calls? Written only after a
-- tool call fails (then 0), so an unsupported model is never retried twice.
CREATE TABLE IF NOT EXISTS model_tools (
    key TEXT PRIMARY KEY,
    supports INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-provider, per-model capability overrides.
-- source: 'auto' (from provider metadata / name heuristic) | 'manual' (user toggle)
CREATE TABLE IF NOT EXISTS model_caps (
    provider_id INTEGER NOT NULL,
    model TEXT NOT NULL,
    vision INTEGER NOT NULL DEFAULT 0,
    image_gen INTEGER NOT NULL DEFAULT 0,
    tools INTEGER NOT NULL DEFAULT 1,
    reasoning INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'auto',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (provider_id, model)
);

-- Memory system: durable facts the assistant remembers about the user
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT NOT NULL DEFAULT 'auto',  -- 'auto' | 'manual'
    pinned INTEGER NOT NULL DEFAULT 0
);

-- Projects: named contexts with custom instructions + knowledge files
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Project knowledge files (linked to projects, not chats)
CREATE TABLE IF NOT EXISTS project_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    path TEXT NOT NULL,
    extracted TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files (project_id);
