# OpenBin

A local, ChatGPT-style chat app. Everything runs on your computer and everything is stored locally
(chat history and settings live in a SQLite file inside `backend/data/`).

- **Frontend:** React 19 + Vite + Tailwind CSS v4 (`@tailwindcss/vite`), lucide-react, react-markdown + remark-gfm, lazy-loaded highlight.js
- **Backend:** Python + FastAPI + uvicorn, `openai` SDK pointed at any OpenAI-compatible provider, built-in `sqlite3` (no ORM)
- The backend listens on `127.0.0.1:8000` only. The Vite dev server proxies `/api` to it, so there is no CORS setup.

## Features

- **Multi-provider chat** — Groq / OpenAI / NVIDIA / custom OpenAI-compatible endpoints, managed in Settings → Providers (per-provider key, base URL, default model, test button).
- **Model selector in the input bar** — pinned models first, per-chat model override, capability badges (vision / tools / image).
- **Web search** — Off / Auto / Always / Deep Research; Auto lets the model call `web_search` / `fetch_url` itself.
- **Deep Research** — iterative plan → search → fetch → gap analysis, up to 3 rounds / 20 pages, with Stop support.
- **Syntax highlighting + artifacts** — code fences are stripped from the chat text and shown in an artifact panel (preview for HTML/SVG/Markdown), with copy, open-in-tab and **download as .md / .txt / .html / .csv / .json**.
- **Settings page** — full-page settings with categories (General, Providers, Web search, Appearance, Memory & Personalization, Export / Import), reachable via `#/settings/...`.
- **Theme** — dark / light / system (follows the OS preference live).
- **Model capabilities + vision gating** — capability DB with manual overrides; images are resized in the browser (1568px, JPEG 0.85) and blocked for models without vision.
- **Image generation** — per-provider image endpoint config, size/count presets, multi-format response parser.
- **Memory system** — memories / preferences / styles stored locally with CRUD API and Settings tabs (auto-extraction is a stub for now).
- **Welcome screen** — suggestion cards for new chats (explain / code / plan / summarize).
- **PWA** — installable (manifest + icons), service worker gives an offline shell for the UI (chat requests always need the backend).

## Requirements

- Python 3.10+ (tested on 3.13)
- Node.js 18+ (tested on 24)
- An API key for any OpenAI-compatible provider (Groq, OpenAI, NVIDIA NIM, …)

## Run it on Windows

### Option A - one click

Double-click **`OpenBin.bat`** (in the project root). It starts the backend and the frontend in
their own minimized windows and opens <http://localhost:5173> in your default browser. Close those
two windows to stop. (Run the one-time setup in Option B first if you ever move the folder.)

### Option B - two terminals (PowerShell)

### 1. Backend

```powershell
cd backend
python -m venv venv
venv\Scripts\python.exe -m pip install -r requirements.txt
venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

Leave this running. On first start it creates `backend/data/openbin.db` from `schema.sql`.

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Then open **<http://localhost:5173>**.

### 3. First run

The Settings page opens automatically on first launch (there is no API key yet):

1. Add a **provider** (or use the default) and paste its **API key**.
2. Pick a **model** (the provider's model list is loaded automatically; you can type any model id).
3. Optionally press **Test connection** to confirm the key works.
4. Press **Save**.

That is the only manual configuration — no `.env` editing anywhere.

## Settings (Settings page categories)

| Category | What lives there |
| -------- | ---------------- |
| General | default model, temperature, max tokens, top-p, history limit, system prompt |
| Providers | add/edit/activate providers, per-provider key + base URL + default model, model list |
| Web search | search provider config, test search / test page fetch |
| Appearance | theme (dark / light / system) |
| Memory & Personalization | memories, preferences, styles (export/import as JSON) |
| Export / Import | full backup as JSON, restore from a backup file |

## PWA (install the app)

The frontend ships a web manifest + service worker, so you can install it like a normal app:

1. Build once: `cd frontend && npm run build`.
2. Serve `frontend/dist` from any static server bound to `localhost` (the service worker needs a
   secure context — `localhost` counts; `file://` does **not** work), e.g.
   `npx serve frontend/dist` or add a static mount to the backend.
3. Open the app in Chrome/Edge → address-bar **Install** icon → **Install OpenBin**.

Manual steps because the app is normally run through `npm run dev` (dev server, no SW) — the SW
registering in dev would cache modules and confuse HMR, so it only activates in production builds.

**Limitations:** the service worker caches only the UI shell; chats and API calls are never cached
(your data is not duplicated), so you need the backend running even in "installed" mode. There is
no push notifications and no background sync.

## Project structure

```
OpenBin/
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx            (registers the SW in production builds)
│   │   ├── index.css
│   │   ├── api.js
│   │   ├── useChat.js
│   │   ├── artifacts.js        (artifact parsing + download formats)
│   │   ├── highlight.js        (lazy highlight.js loader)
│   │   └── components/
│   │       ├── Sidebar.jsx     (chats, search)
│   │       ├── ChatWindow.jsx  (welcome screen, chat menu, exports)
│   │       ├── ChatInput.jsx   (modes, model picker, files, image gen)
│   │       ├── Message.jsx
│   │       ├── ArtifactPanel.jsx
│   │       ├── ModelPicker.jsx
│   │       └── SettingsPage.jsx
│   ├── public/
│   │   ├── manifest.webmanifest
│   │   ├── sw.js               (service worker)
│   │   └── icon-192.png / icon-512.png
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── main.py
│   ├── webtools.py
│   ├── schema.sql
│   ├── requirements.txt
│   └── data/            (created automatically, git-ignored)
├── .gitignore
└── README.md
```

## API (backend, main routes)

| Method   | Route                      | Purpose                                    |
| -------- | -------------------------- | ------------------------------------------ |
| GET/PUT  | `/api/settings`            | read/update settings (key is returned masked) |
| GET/POST | `/api/providers`           | list / add providers, activate one         |
| GET      | `/api/providers/{id}/models` | model list from that provider            |
| POST     | `/api/providers/{id}/image`  | image generation (per-provider endpoint)  |
| GET      | `/api/models`              | legacy alias of the active provider's list |
| POST     | `/api/settings/test`       | tiny request, returns success or the exact error |
| GET/POST | `/api/chats`               | list / create chats                        |
| PATCH    | `/api/chats/{id}`          | rename / pin / incognito                   |
| DELETE   | `/api/chats/{id}`          | delete a chat (messages go with it)        |
| GET      | `/api/chats/{id}/messages` | message history                            |
| POST     | `/api/chats/{id}/stream`   | save the user message, stream the reply as SSE, save the reply |
| GET/POST/PUT/DELETE | `/api/memories…`    | memories CRUD                              |
| GET      | `/api/models/capabilities` | vision/tools/image/reasoning capabilities  |
| POST     | `/api/search/test`         | one test web search                        |
| POST     | `/api/fetch/test`          | read one page as text (SSRF-guarded)       |
| GET      | `/api/search?q=…&limit=6`  | direct search, returns `{results, errors}` |

## Web search

The chat input has four modes (the choice is remembered per browser):

| Mode                   | What happens                                                                 |
| ---------------------- | ---------------------------------------------------------------------------- |
| **Off**                | nothing is sent to the web                                                  |
| **Auto** (default)     | the model decides. With tool support it calls `web_search` / `fetch_url` itself (max 5 rounds, then it must answer); otherwise a small JSON router call decides first |
| **Always**             | one search on every message                                                 |
| **Deep Research**      | iterative rounds: plan → search → fetch → gap analysis → more (max 3 rounds, 20 pages, 180 s) |

- Live steps ("Searching: …", "Reading: domain.com", "Writing answer…") stream while the answer is
  written, then collapse into **Sources & steps** under the message; sources show as title + domain cards.
- Every request carries the current date and time in **your** timezone, so "today"/"latest" are correct.
- `fetch_url` only accepts http/https and refuses localhost, private ranges (10.x, 172.16-31.x,
  192.168.x), link-local and file:// URLs — checked before the request and again after every redirect.
  Pages are capped at 1.5 MB, 15 s and 6000 characters.
- Page text and search results are treated as **data, never instructions**.

## Notes

- **Stop generating:** the Stop button aborts the request; whatever was produced is still saved.
- **Reset everything:** stop the backend and delete the `backend/data` folder.
- **Production bundle:** `cd frontend && npm run build` produces `frontend/dist` (git-ignored). The
  `/api` proxy is a dev-server feature — for normal local use just run `npm run dev`.
- **Privacy:** chats, the system prompt, memories, and your API key never leave this machine except
  for the chat requests themselves, which go to the base URL you configured.
- **Known limitations:** memory auto-extraction/injection is stubbed (memories are stored but not
  yet injected into the prompt automatically); the installed PWA still needs the local backend
  running; some models ignore language-switching instructions (a model quirk, not an app bug).
