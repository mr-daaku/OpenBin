# OpenBin

A local, ChatGPT-style chat app. Everything runs on your computer and everything is stored locally
(chat history and settings live in a SQLite file inside `backend/data/`).

- **Frontend:** React 19 + Vite + Tailwind CSS v4 (`@tailwindcss/vite`), lucide-react, react-markdown + remark-gfm + rehype-highlight
- **Backend:** Python + FastAPI + uvicorn, `openai` SDK pointed at NVIDIA NIM, built-in `sqlite3` (no ORM)
- The backend listens on `127.0.0.1:8000` only. The Vite dev server proxies `/api` to it, so there is no CORS setup.

## Requirements

- Python 3.10+ (tested on 3.13)
- Node.js 18+ (tested on 24)
- An NVIDIA API key — build one at <https://build.nvidia.com> (starts with `nvapi-`)

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

The Settings dialog opens automatically on first launch (there is no API key yet):

1. Paste your **NVIDIA API key**.
2. Pick a **model** from the dropdown (the default `meta/llama-3.1-8b-instruct` has been retired by
   NVIDIA, so choose any model from the list — the dropdown warns you if the current one is missing).
3. Optionally press **Test connection** to confirm the key works.
4. Press **Save**.

That is the only manual configuration — no `.env` editing anywhere.

## Settings (all editable in the Settings dialog)

| Setting          | Default                                | Notes                                            |
| ---------------- | -------------------------------------- | ------------------------------------------------ |
| NVIDIA API key   | —                                      | shown masked (`nvapi-****abcd`), never sent back in full |
| Base URL         | `https://integrate.api.nvidia.com/v1`  | any OpenAI-compatible endpoint                   |
| Model            | `meta/llama-3.1-8b-instruct`           | dropdown from `GET /v1/models` + manual input    |
| System prompt    | (empty)                                | optional                                         |
| Temperature      | `0.7`                                  | slider 0–2                                       |
| Max tokens       | `1024`                                 |                                                  |
| History limit    | `12`                                   | last N messages sent per request                 |
| Theme            | `dark`                                 | dark / light                                     |

## Project structure

```
OpenBin/
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── index.css
│   │   ├── api.js
│   │   ├── useChat.js
│   │   └── components/
│   │       ├── Sidebar.jsx
│   │       ├── ChatWindow.jsx
│   │       ├── Message.jsx
│   │       ├── ChatInput.jsx
│   │       └── SettingsModal.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── main.py
│   ├── schema.sql
│   ├── requirements.txt
│   └── data/            (created automatically, git-ignored)
├── .gitignore
└── README.md
```

## API (backend)

| Method   | Route                      | Purpose                                    |
| -------- | -------------------------- | ------------------------------------------ |
| GET/PUT  | `/api/settings`            | read/update settings (key is returned masked) |
| GET      | `/api/models`              | model list from the saved base URL + key   |
| POST     | `/api/settings/test`       | tiny request, returns success or the exact error |
| GET/POST | `/api/chats`               | list / create chats                        |
| PATCH    | `/api/chats/{id}`          | rename (title = first 40 chars of the first message) |
| DELETE   | `/api/chats/{id}`          | delete a chat (messages go with it)        |
| GET      | `/api/chats/{id}/messages` | message history                            |
| POST     | `/api/chats/{id}/stream`   | save the user message, stream the reply as SSE, save the reply (partial replies are saved if you press Stop) |

## Notes

- **Stop generating:** the Stop button aborts the request; whatever was produced is still saved.
- **Reset everything:** stop the backend and delete the `backend/data` folder.
- **Production bundle:** `cd frontend && npm run build` produces `frontend/dist` (git-ignored). The
  `/api` proxy is a dev-server feature — for normal local use just run `npm run dev`.
- **Privacy:** chats, the system prompt, and your API key never leave this machine except for the
  chat requests themselves, which go to the base URL you configured.
