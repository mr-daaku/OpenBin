"""OpenBin backend: FastAPI + SQLite + NVIDIA NIM (OpenAI-compatible).

Run from the backend/ folder:
    uvicorn main:app --reload --port 8000

Only ever bind to 127.0.0.1 (the Vite dev server proxies /api here).
"""

import base64
import json
import sqlite3
from pathlib import Path
from uuid import uuid4

import openai
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "openbin.db"
SCHEMA_SQL = (BASE_DIR / "schema.sql").read_text(encoding="utf-8")

DEFAULT_SYSTEM_PROMPT = """You are OpenBin, a smart, friendly and practical AI assistant running locally on the user's own device.

## Language and tone
- Reply in the same language the user writes in. If the user writes in Hinglish (Hindi in Roman script mixed with English), reply in Hinglish. If in Hindi or English, reply in that.
- Be casual, direct and practical. No unnecessary lecture, no long intros or outros. Get to the answer first.
- Be warm, but be honest. If the user is wrong or an idea has a problem, say it politely and give a better option.

## Answer quality
- Think before answering complex questions. For simple questions, keep the answer short.
- If something is unclear and you cannot make a reasonable assumption, ask ONE short clarifying question. Otherwise assume sensibly, state the assumption in one line, and proceed.
- Never invent facts, links, package names, or API details. If you don't know or are unsure, say so clearly.
- If you have web search results in context, use them and cite sources like [1], [2]. If not, mention that your knowledge may be outdated for recent events.

## Formatting
- Use Markdown. Use headings, lists and tables only when they actually help. Plain conversation should stay in simple paragraphs.
- Put all code in fenced code blocks with the language name. For short snippets and explanations, keep them inline in the chat.

## Artifacts
When the user asks for something substantial and self-contained that they will want to preview, run, copy or reuse (a webpage, app, game, tool, calculator, dashboard, SVG, a long document), put it in an artifact:

<artifact type="html|react|svg|markdown|code" title="Short title">
...full content here...
</artifact>

Rules for artifacts:
- html: ONE complete self-contained file (HTML + CSS + JS together). No external files. CDN scripts only from cdnjs.cloudflare.com or cdn.jsdelivr.net.
- react: a single component with a default export, using only React and Tailwind classes. Do not use localStorage or sessionStorage.
- Always give complete working code, never placeholders like "rest of the code here".
- When updating an existing artifact, send the full updated artifact again, not only the changed part.
- Make the design clean, modern and responsive by default.
- After the artifact, write only 1-3 lines explaining what it does and how to use it.
Do NOT use artifacts for short answers, small snippets or normal conversation.

## Coding help
- Give working, minimal, production-sensible code. Follow the user's existing stack if they mention it.
- When fixing a bug, first say what the cause is in one or two lines, then give the fix.
- Mention security risks (exposed API keys, missing validation) when you notice them.

## Memory and privacy
- If memory facts are provided, use them naturally to personalize answers, but only when they actually help. Never list or mention them unprompted.
- Never ask for or store passwords, private keys, seed phrases or card details. If the user shares them, warn them to keep those secret.

## Safety
- Don't help with malware, hacking other people's accounts, scams, or anything that seriously harms others. Refuse briefly and politely, and offer a safe alternative if there is one."""

DEFAULTS = {
    "api_key": "",
    "base_url": "https://integrate.api.nvidia.com/v1",
    "model": "meta/llama-3.1-8b-instruct",
    "system_prompt": DEFAULT_SYSTEM_PROMPT,
    "temperature": "0.7",
    "max_tokens": "1024",
    "history_limit": "12",
    "theme": "dark",
}

app = FastAPI(title="OpenBin")


# ---------------------------------------------------------------- database

def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect()
    try:
        conn.executescript(SCHEMA_SQL)
        # Safe migrations: additive only, every failure ignored (column exists).
        for stmt in (
            "ALTER TABLE messages ADD COLUMN model TEXT",
            "ALTER TABLE chats ADD COLUMN model TEXT",
            "ALTER TABLE chats ADD COLUMN temperature REAL",
            "ALTER TABLE chats ADD COLUMN max_tokens INTEGER",
            "ALTER TABLE chats ADD COLUMN top_p REAL",
            "ALTER TABLE chats ADD COLUMN system_prompt TEXT",
            "ALTER TABLE chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE chats ADD COLUMN incognito INTEGER NOT NULL DEFAULT 0",
        ):
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError:
                pass
        # One-time migration: an old DB may hold an empty system_prompt, which
        # would shadow the new default. Drop only that empty row (never data).
        conn.execute("DELETE FROM settings WHERE key = 'system_prompt' AND value = ''")
        # One-time migration: turn the original single credential into a provider
        # profile so nothing the user already entered is lost.
        if conn.execute("SELECT COUNT(*) AS n FROM providers").fetchone()["n"] == 0:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
            stored = {r["key"]: r["value"] for r in rows}
            conn.execute(
                "INSERT INTO providers (name, preset, base_url, api_key, is_active) "
                "VALUES (?, 'nvidia', ?, ?, 1)",
                ("NVIDIA NIM", stored.get("base_url", DEFAULTS["base_url"]), stored.get("api_key", "")),
            )
        # One-time sweep: uploads that were never sent to a message (the user
        # picked a file then abandoned the chat) are old enough to drop.
        conn.execute(
            "DELETE FROM files WHERE message_id IS NULL AND created_at < datetime('now', '-1 day')"
        )
        conn.commit()
    finally:
        conn.close()


init_db()


# ---------------------------------------------------------------- settings

def load_settings() -> dict:
    conn = connect()
    try:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    finally:
        conn.close()
    stored = {r["key"]: r["value"] for r in rows if r["value"] is not None}
    return {**DEFAULTS, **stored}


def mask_key(key: str) -> str:
    """nvapi-abcdef1234 -> nvapi-****34 (the full key never leaves the server)."""
    if not key:
        return ""
    if len(key) <= 10:
        return key[:4] + "****"
    return f"{key[:6]}****{key[-4:]}"


def public_settings(st: dict) -> dict:
    provider = load_provider()
    base_url, key = provider_creds(provider, st)
    return {
        "api_key": mask_key(key),
        "has_api_key": bool(key),
        "base_url": base_url,
        "model": st["model"],
        "active_provider_id": provider["id"] if provider else None,
        "system_prompt": st["system_prompt"],
        "temperature": float(st["temperature"]),
        "max_tokens": int(st["max_tokens"]),
        "history_limit": int(st["history_limit"]),
        "theme": st["theme"],
    }


def save_settings(updates: dict) -> None:
    if not updates:
        return
    conn = connect()
    try:
        with conn:
            conn.executemany(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                list(updates.items()),
            )
    finally:
        conn.close()


def pick_key(candidate: str | None, saved: str) -> str:
    """Use a freshly typed key, otherwise fall back to the saved one."""
    if candidate and "****" not in candidate:
        return candidate.strip()
    return saved


# ---------------------------------------------------------------- errors

def friendly_error(exc: Exception) -> str:
    """Clear, actionable wording for SSE error events and the model list."""
    if isinstance(exc, (openai.AuthenticationError, openai.PermissionDeniedError)):
        return "Invalid API key or access denied. Check your NVIDIA API key in Settings."
    if isinstance(exc, openai.RateLimitError):
        return "Rate limit reached. Wait a moment and try again."
    if isinstance(exc, openai.NotFoundError):
        return "Model not found. Check the model name in Settings."
    if isinstance(exc, openai.APIConnectionError):
        return "Could not reach the API. Check the base URL and your internet connection."
    if isinstance(exc, openai.APIStatusError):
        if exc.status_code in (404, 410):
            return (
                f"Model not found or retired (HTTP {exc.status_code}). "
                "Pick another model from the Model list in Settings."
            )
        return f"API error ({exc.status_code}): {exc.message}"
    return str(exc) or exc.__class__.__name__


def exact_error(exc: Exception) -> str:
    """The raw SDK error, plus the API's own detail when the SDK omits it."""
    text = str(exc) or repr(exc)
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        detail = body.get("detail") or body.get("message") or body.get("error")
        if isinstance(detail, (dict, list)):
            detail = json.dumps(detail, ensure_ascii=False)
        if detail and str(detail) not in text:
            text = f"{text} - {detail}"
    return text


def sse(payload: dict) -> str:
    return "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"


# ---------------------------------------------------------------- providers

PRESETS = {
    "nvidia": ("NVIDIA NIM", "https://integrate.api.nvidia.com/v1"),
    "openai": ("OpenAI", "https://api.openai.com/v1"),
    "openrouter": ("OpenRouter", "https://openrouter.ai/api/v1"),
    "groq": ("Groq", "https://api.groq.com/openai/v1"),
    "anthropic": ("Anthropic-compatible", "https://api.anthropic.com/v1"),
    "custom": ("Custom", ""),
}


def active_provider(conn: sqlite3.Connection) -> sqlite3.Row | None:
    row = conn.execute("SELECT * FROM providers WHERE is_active = 1 ORDER BY id LIMIT 1").fetchone()
    if row is None:
        row = conn.execute("SELECT * FROM providers ORDER BY id LIMIT 1").fetchone()
    return row


def load_provider(provider_id: int | None = None) -> sqlite3.Row | None:
    conn = connect()
    try:
        if provider_id is None:
            return active_provider(conn)
        return conn.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()
    finally:
        conn.close()


def provider_creds(provider: sqlite3.Row | None, st: dict | None = None) -> tuple[str, str]:
    """(base_url, api_key) for the active provider, falling back to old settings."""
    st = st or load_settings()
    if provider is None:
        return st["base_url"], st["api_key"]
    return provider["base_url"] or st["base_url"], provider["api_key"] or st["api_key"]


def public_provider(p: sqlite3.Row) -> dict:
    return {
        "id": p["id"],
        "name": p["name"],
        "preset": p["preset"],
        "base_url": p["base_url"],
        "api_key": mask_key(p["api_key"]),
        "has_api_key": bool(p["api_key"]),
        "pinned": [m for m in (p["pinned"] or "").split(",") if m],
        "is_active": bool(p["is_active"]),
    }


def list_provider_rows() -> list[sqlite3.Row]:
    conn = connect()
    try:
        return conn.execute("SELECT * FROM providers ORDER BY is_active DESC, id").fetchall()
    finally:
        conn.close()


# ---------------------------------------------------------------- schemas

class SettingsIn(BaseModel):
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    history_limit: int | None = None
    theme: str | None = None


class MessageEditIn(BaseModel):
    content: str


class ImportIn(BaseModel):
    title: str = "Imported Chat"
    messages: list[dict] = []


# ---------------------------------------------------------------- settings api

@app.get("/api/settings")
def get_settings():
    return public_settings(load_settings())


@app.put("/api/settings")
def put_settings(body: SettingsIn):
    updates: dict = {}
    for name in ("base_url", "model", "system_prompt", "theme"):
        value = getattr(body, name)
        if value is not None:
            updates[name] = value.strip()
    if body.temperature is not None:
        updates["temperature"] = str(min(2.0, max(0.0, body.temperature)))
    if body.max_tokens is not None:
        updates["max_tokens"] = str(min(32768, max(1, body.max_tokens)))
    if body.history_limit is not None:
        updates["history_limit"] = str(min(200, max(1, body.history_limit)))
    if body.api_key and "****" not in body.api_key:
        updates["api_key"] = body.api_key.strip()
    if updates.get("base_url") == "":
        updates["base_url"] = DEFAULTS["base_url"]
    if updates.get("model") == "":
        updates.pop("model")
    if updates.get("system_prompt", "\x00") == "":
        # Clearing the field means "back to the OpenBin default prompt".
        updates.pop("system_prompt", None)
        conn = connect()
        try:
            with conn:
                conn.execute("DELETE FROM settings WHERE key = 'system_prompt'")
        finally:
            conn.close()
    save_settings(updates)

    # Credentials live on the active provider profile (kept in sync so the old
    # settings rows still work if every provider is ever removed).
    provider = load_provider()
    if provider is not None and ("api_key" in updates or "base_url" in updates):
        conn = connect()
        try:
            with conn:
                conn.execute(
                    "UPDATE providers SET api_key = COALESCE(?, api_key), "
                    "base_url = COALESCE(?, base_url) WHERE id = ?",
                    (updates.get("api_key"), updates.get("base_url"), provider["id"]),
                )
        finally:
            conn.close()
    return public_settings(load_settings())


@app.get("/api/models")
async def list_models():
    st = load_settings()
    provider = load_provider()
    base_url, key = provider_creds(provider, st)
    return await fetch_models(base_url, key)


@app.post("/api/settings/test")
async def test_connection(body: SettingsIn):
    st = load_settings()
    key = pick_key(body.api_key, st["api_key"])
    if not key:
        return {"ok": False, "error": "No API key set. Paste your NVIDIA API key first."}
    client = AsyncOpenAI(api_key=key, base_url=(body.base_url or st["base_url"]).strip())
    try:
        await client.chat.completions.create(
            model=(body.model or st["model"]).strip(),
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=5,
            temperature=0,
        )
        return {"ok": True, "message": "Connected successfully."}
    except Exception as exc:  # noqa: BLE001 - the exact error is the point here
        return {"ok": False, "error": exact_error(exc)}


# ---------------------------------------------------------------- providers api

class ProviderIn(BaseModel):
    name: str | None = None
    preset: str | None = None
    base_url: str | None = None
    api_key: str | None = None


class PinnedIn(BaseModel):
    model: str


@app.get("/api/providers")
def get_providers():
    return [public_provider(p) for p in list_provider_rows()]


@app.post("/api/providers")
def create_provider(body: ProviderIn):
    preset = body.preset if body.preset in PRESETS else "custom"
    name = (body.name or "").strip() or PRESETS[preset][0]
    base_url = (body.base_url or "").strip() or PRESETS[preset][1]
    key = (body.api_key or "").strip()
    if key and "****" in key:
        key = ""
    conn = connect()
    try:
        with conn:
            first = conn.execute("SELECT COUNT(*) AS n FROM providers").fetchone()["n"] == 0
            cur = conn.execute(
                "INSERT INTO providers (name, preset, base_url, api_key, is_active) "
                "VALUES (?, ?, ?, ?, ?)",
                (name[:60], preset, base_url, key, 1 if first else 0),
            )
            if not first:
                conn.execute("UPDATE providers SET is_active = 0 WHERE id <> ?", (cur.lastrowid,))
        row = conn.execute("SELECT * FROM providers WHERE id = ?", (cur.lastrowid,)).fetchone()
        return public_provider(row)
    finally:
        conn.close()


@app.patch("/api/providers/{provider_id}")
def update_provider(provider_id: int, body: ProviderIn):
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()
        if row is None:
            return JSONResponse({"error": "Provider not found"}, status_code=404)
        updates: dict = {}
        if body.name is not None:
            updates["name"] = body.name.strip()[:60] or row["name"]
        if body.preset is not None and body.preset in PRESETS:
            updates["preset"] = body.preset
        if body.base_url is not None:
            updates["base_url"] = body.base_url.strip()
        if body.api_key and "****" not in body.api_key:
            updates["api_key"] = body.api_key.strip()
        if updates:
            with conn:
                conn.execute(
                    f"UPDATE providers SET {', '.join(f'{k} = ?' for k in updates)} WHERE id = ?",
                    (*updates.values(), provider_id),
                )
        fresh = conn.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()
        return public_provider(fresh)
    finally:
        conn.close()


@app.delete("/api/providers/{provider_id}")
def delete_provider(provider_id: int):
    conn = connect()
    try:
        cur = conn.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
        conn.commit()
        if cur.rowcount == 0:
            return JSONResponse({"error": "Provider not found"}, status_code=404)
        # Keep exactly one provider active.
        if conn.execute("SELECT COUNT(*) AS n FROM providers WHERE is_active = 1").fetchone()["n"] == 0:
            with conn:
                conn.execute(
                    "UPDATE providers SET is_active = 1 WHERE id = "
                    "(SELECT id FROM providers ORDER BY id LIMIT 1)"
                )
        return {"deleted": provider_id}
    finally:
        conn.close()


@app.post("/api/providers/{provider_id}/activate")
def activate_provider(provider_id: int):
    conn = connect()
    try:
        row = conn.execute("SELECT id FROM providers WHERE id = ?", (provider_id,)).fetchone()
        if row is None:
            return JSONResponse({"error": "Provider not found"}, status_code=404)
        with conn:
            conn.execute("UPDATE providers SET is_active = 0")
            conn.execute("UPDATE providers SET is_active = 1 WHERE id = ?", (provider_id,))
        fresh = conn.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()
        return public_provider(fresh)
    finally:
        conn.close()


@app.post("/api/providers/{provider_id}/pinned")
def toggle_pinned(provider_id: int, body: PinnedIn):
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()
        if row is None:
            return JSONResponse({"error": "Provider not found"}, status_code=404)
        pinned = [m for m in (row["pinned"] or "").split(",") if m]
        name = body.model.strip()
        if name in pinned:
            pinned.remove(name)
            on = False
        else:
            pinned.append(name)
            on = True
        with conn:
            conn.execute("UPDATE providers SET pinned = ? WHERE id = ?", (",".join(pinned), provider_id))
        return {"model": name, "pinned": on, "pinned_models": pinned}
    finally:
        conn.close()


async def fetch_models(base_url: str, api_key: str) -> dict:
    if not api_key:
        return {"models": [], "error": "No API key saved yet. Add it for this provider."}
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    try:
        res = await client.models.list()
        names = sorted(m.id for m in res.data if getattr(m, "id", None))
        return {"models": names, "error": None}
    except Exception as exc:  # noqa: BLE001 - the reason is shown in the UI
        return {"models": [], "error": friendly_error(exc)}


@app.get("/api/providers/{provider_id}/models")
async def provider_models(provider_id: int):
    st = load_settings()
    provider = load_provider(provider_id)
    if provider is None:
        return {"models": [], "error": "Provider not found."}
    base_url, key = provider_creds(provider, st)
    return await fetch_models(base_url, key)


@app.post("/api/providers/{provider_id}/test")
async def provider_test(provider_id: int, body: SettingsIn):
    st = load_settings()
    provider = load_provider(provider_id)
    if provider is None:
        return {"ok": False, "error": "Provider not found."}
    base_url, key = provider_creds(provider, st)
    key = pick_key(body.api_key, key)
    if body.base_url:
        base_url = body.base_url.strip()
    if not key:
        return {"ok": False, "error": "No API key set for this provider. Paste it first."}
    if not base_url:
        return {"ok": False, "error": "No base URL set for this provider."}
    client = AsyncOpenAI(api_key=key, base_url=base_url)
    try:
        await client.chat.completions.create(
            model=(body.model or st["model"]).strip(),
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=5,
            temperature=0,
        )
        return {"ok": True, "message": "Connected successfully."}
    except openai.APITimeoutError:
        return {"ok": False, "error": "Request timed out. Check the base URL and your connection."}
    except Exception as exc:  # noqa: BLE001 - the exact error is the point here
        return {"ok": False, "error": exact_error(exc)}


# ---------------------------------------------------------------- chats api

CHAT_COLS = (
    "id, title, created_at, pinned, incognito, model, temperature, "
    "max_tokens, top_p, system_prompt"
)


def chat_settings(row: sqlite3.Row) -> dict:
    return {
        "model": row["model"],
        "temperature": row["temperature"],
        "max_tokens": row["max_tokens"],
        "top_p": row["top_p"],
        "system_prompt": row["system_prompt"],
    }


def chat_out(row: sqlite3.Row) -> dict:
    return {
        **{k: row[k] for k in ("id", "title", "created_at", "pinned", "incognito")},
        "pinned": bool(row["pinned"]),
        "incognito": bool(row["incognito"]),
        "settings": chat_settings(row),
    }


@app.get("/api/chats")
def list_chats(q: str | None = None):
    conn = connect()
    try:
        term = (q or "").strip()
        if term:
            like = f"%{term}%"
            rows = conn.execute(
                f"SELECT {CHAT_COLS} FROM chats "
                "WHERE title LIKE ? "
                "OR id IN (SELECT chat_id FROM messages WHERE content LIKE ?) "
                "ORDER BY pinned DESC, id DESC",
                (like, like),
            ).fetchall()
        else:
            rows = conn.execute(
                f"SELECT {CHAT_COLS} FROM chats ORDER BY pinned DESC, id DESC"
            ).fetchall()
        return [chat_out(r) for r in rows]
    finally:
        conn.close()


@app.post("/api/chats")
def create_chat():
    conn = connect()
    try:
        cur = conn.execute("INSERT INTO chats (title) VALUES ('New Chat')")
        conn.commit()
        row = conn.execute(f"SELECT {CHAT_COLS} FROM chats WHERE id = ?", (cur.lastrowid,)).fetchone()
        return chat_out(row)
    finally:
        conn.close()


class ChatSettingsIn(BaseModel):
    model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    top_p: float | None = None
    system_prompt: str | None = None
    clear: list[str] = []


@app.put("/api/chats/{chat_id}/settings")
def put_chat_settings(chat_id: int, body: ChatSettingsIn):
    conn = connect()
    try:
        row = conn.execute("SELECT id FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if row is None:
            return JSONResponse({"error": "Chat not found"}, status_code=404)
        updates: dict = {}
        if body.model is not None:
            updates["model"] = body.model.strip() or None
        if body.temperature is not None:
            updates["temperature"] = min(2.0, max(0.0, body.temperature))
        if body.max_tokens is not None:
            updates["max_tokens"] = min(32768, max(1, body.max_tokens))
        if body.top_p is not None:
            updates["top_p"] = min(1.0, max(0.0, body.top_p))
        if body.system_prompt is not None:
            updates["system_prompt"] = body.system_prompt.strip() or None
        for name in body.clear:
            if name in ("model", "temperature", "max_tokens", "top_p", "system_prompt"):
                updates[name] = None
        if updates:
            with conn:
                conn.execute(
                    f"UPDATE chats SET {', '.join(f'{k} = ?' for k in updates)} WHERE id = ?",
                    (*updates.values(), chat_id),
                )
        fresh = conn.execute(f"SELECT {CHAT_COLS} FROM chats WHERE id = ?", (chat_id,)).fetchone()
        return chat_out(fresh)
    finally:
        conn.close()


class ChatUpdateIn(BaseModel):
    title: str | None = None
    pinned: bool | None = None
    incognito: bool | None = None


@app.patch("/api/chats/{chat_id}")
def update_chat(chat_id: int, body: ChatUpdateIn):
    conn = connect()
    try:
        row = conn.execute("SELECT id FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if row is None:
            return JSONResponse({"error": "Chat not found"}, status_code=404)
        updates: dict = {}
        if body.title is not None:
            updates["title"] = body.title.strip()[:80] or "New Chat"
        if body.pinned is not None:
            updates["pinned"] = 1 if body.pinned else 0
        if body.incognito is not None:
            updates["incognito"] = 1 if body.incognito else 0
            if body.incognito and body.title is None:
                updates["title"] = "Incognito"
        if updates:
            with conn:
                conn.execute(
                    f"UPDATE chats SET {', '.join(f'{k} = ?' for k in updates)} WHERE id = ?",
                    (*updates.values(), chat_id),
                )
        fresh = conn.execute(f"SELECT {CHAT_COLS} FROM chats WHERE id = ?", (chat_id,)).fetchone()
        return chat_out(fresh)
    finally:
        conn.close()


@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: int):
    conn = connect()
    try:
        exists = conn.execute("SELECT id FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if exists is None:
            return JSONResponse({"error": "Chat not found"}, status_code=404)
        cleanup_chat_files(chat_id, conn)
        with conn:
            conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
        return {"deleted": chat_id}
    finally:
        conn.close()


@app.get("/api/chats/{chat_id}/messages")
def list_messages(chat_id: int):
    conn = connect()
    try:
        exists = conn.execute("SELECT 1 FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if not exists:
            return JSONResponse({"error": "Chat not found"}, status_code=404)
        rows = conn.execute(
            "SELECT id, chat_id, role, content, model, created_at FROM messages "
            "WHERE chat_id = ? ORDER BY id",
            (chat_id,),
        ).fetchall()
        files = files_for_messages(conn, [r["id"] for r in rows])
        return [
            {**dict(r), "files": [file_out(f) for f in files.get(r["id"], [])]}
            for r in rows
        ]
    finally:
        conn.close()


@app.patch("/api/messages/{message_id}")
def edit_message(message_id: int, body: MessageEditIn):
    """Edit a message and drop everything after it (edit & resend)."""
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
        if row is None:
            return JSONResponse({"error": "Message not found"}, status_code=404)
        content = body.content.strip()
        if not content:
            return JSONResponse({"error": "Message cannot be empty"}, status_code=400)
        with conn:
            conn.execute("UPDATE messages SET content = ? WHERE id = ?", (content, message_id))
            dropped = conn.execute(
                "SELECT id FROM messages WHERE chat_id = ? AND id > ?",
                (row["chat_id"], message_id),
            ).fetchall()
            removed = conn.execute(
                "DELETE FROM messages WHERE chat_id = ? AND id > ?",
                (row["chat_id"], message_id),
            ).rowcount
            if dropped:
                marks = ",".join("?" * len(dropped))
                drows = conn.execute(
                    f"SELECT path FROM files WHERE message_id IN ({marks})",
                    [d["id"] for d in dropped],
                ).fetchall()
                conn.execute(
                    f"DELETE FROM files WHERE message_id IN ({marks})",
                    [d["id"] for d in dropped],
                )
                for f in drows:
                    try:
                        Path(f["path"]).unlink(missing_ok=True)
                    except OSError:
                        pass
        fresh = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
        return {**dict(fresh), "removed_after": removed}
    finally:
        conn.close()


@app.delete("/api/messages/{message_id}")
def delete_message(message_id: int):
    conn = connect()
    try:
        cur = conn.execute("SELECT chat_id FROM messages WHERE id = ?", (message_id,))
        row = cur.fetchone()
        if row is None:
            return JSONResponse({"error": "Message not found"}, status_code=404)
        files = conn.execute("SELECT path FROM files WHERE message_id = ?", (message_id,)).fetchall()
        with conn:
            conn.execute("DELETE FROM messages WHERE id = ?", (message_id,))
            conn.execute("DELETE FROM files WHERE message_id = ?", (message_id,))
        for f in files:
            try:
                Path(f["path"]).unlink(missing_ok=True)
            except OSError:
                pass
        return {"deleted": message_id}
    finally:
        conn.close()


@app.post("/api/chats/{chat_id}/auto-title")
async def auto_title(chat_id: int):
    """Name the chat from its first user message with one tiny model call."""
    st = load_settings()
    conn = connect()
    try:
        chat = conn.execute("SELECT id, title FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if chat is None:
            return JSONResponse({"error": "Chat not found"}, status_code=404)
        first = conn.execute(
            "SELECT content FROM messages WHERE chat_id = ? AND role = 'user' ORDER BY id LIMIT 1",
            (chat_id,),
        ).fetchone()
    finally:
        conn.close()
    if first is None:
        return JSONResponse({"error": "No messages in this chat yet."}, status_code=400)

    base_url, key = provider_creds(load_provider(), st)
    if not key:
        return JSONResponse({"error": "No API key set for the active provider."}, status_code=400)
    client = AsyncOpenAI(api_key=key, base_url=base_url)
    try:
        res = await client.chat.completions.create(
            model=st["model"],
            messages=[
                {
                    "role": "system",
                    "content": "Write a short title (max 6 words, no quotes, no punctuation at the end) "
                    "for this conversation. Reply with the title only.",
                },
                {"role": "user", "content": first["content"][:600]},
            ],
            max_tokens=800,  # reasoning models burn ~256 tokens before the title
            temperature=0.3,
        )
        title = (res.choices[0].message.content or "").strip().strip('"').strip()[:80]
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI
        return JSONResponse({"error": friendly_error(exc)}, status_code=502)
    if not title:
        return JSONResponse({"error": "The model returned an empty title."}, status_code=502)

    conn = connect()
    try:
        with conn:
            conn.execute("UPDATE chats SET title = ? WHERE id = ?", (title, chat_id))
        row = conn.execute(f"SELECT {CHAT_COLS} FROM chats WHERE id = ?", (chat_id,)).fetchone()
        return chat_out(row)
    finally:
        conn.close()


@app.post("/api/chats/import")
def import_chat(body: ImportIn):
    conn = connect()
    try:
        with conn:
            cur = conn.execute(
                "INSERT INTO chats (title) VALUES (?)",
                (body.title.strip()[:80] or "Imported Chat",),
            )
            chat_id = cur.lastrowid
            rows = []
            for item in body.messages[:2000]:
                role = item.get("role")
                content = item.get("content")
                if role not in ("user", "assistant") or not isinstance(content, str) or not content.strip():
                    continue
                cur2 = conn.execute(
                    "INSERT INTO messages (chat_id, role, content, model) VALUES (?, ?, ?, ?)",
                    (chat_id, role, content[:200000], str(item.get("model") or "") or None),
                )
                rows.append(cur2.lastrowid)
        row = conn.execute(f"SELECT {CHAT_COLS} FROM chats WHERE id = ?", (chat_id,)).fetchone()
        return {**chat_out(row), "imported": len(rows)}
    finally:
        conn.close()


# ---------------------------------------------------------------- files api

MAX_UPLOAD = 25 * 1024 * 1024  # 25 MB
TEXT_KINDS = {
    "text", "text/plain", "text/markdown", "text/csv", "text/html", "text/xml",
    "application/json", "application/xml", "application/javascript",
    "application/x-sh", "application/yaml", "application/toml",
}
TEXT_EXTS = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".html", ".htm",
    ".css", ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".cpp", ".h",
    ".cs", ".go", ".rs", ".rb", ".php", ".sh", ".bat", ".ps1", ".sql", ".yaml",
    ".yml", ".toml", ".ini", ".cfg", ".log", ".srt", ".vue", ".svelte",
}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
MAX_TEXT_CHARS = 60000  # cap injected file text so history stays sane


def classify(name: str, mime: str) -> str:
    ext = Path(name).suffix.lower()
    mime = (mime or "").lower()
    if ext in IMAGE_EXTS or mime.startswith("image/"):
        return "image"
    if ext == ".pdf" or mime == "application/pdf":
        return "pdf"
    if ext in TEXT_EXTS or mime in TEXT_KINDS or mime.startswith("text/"):
        return "text"
    return "file"


def extract_text(path: Path, kind: str, name: str) -> str:
    """Pull plain text out of an uploaded file (empty for images/binaries)."""
    try:
        if kind == "pdf":
            from pypdf import PdfReader  # lazy: only paid for when a PDF arrives
            reader = PdfReader(str(path))
            parts = []
            total = 0
            for page in reader.pages:
                t = page.extract_text() or ""
                parts.append(t)
                total += len(t)
                if total >= MAX_TEXT_CHARS:
                    break
            return "\n".join(parts)[:MAX_TEXT_CHARS]
        if kind == "text":
            return path.read_text(encoding="utf-8", errors="replace")[:MAX_TEXT_CHARS]
    except Exception:  # noqa: BLE001 - unreadable file just gets no text
        return ""
    return ""


def file_out(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "mime": row["mime"],
        "kind": row["kind"],
        "size": row["size"],
        "url": f"/api/files/{row['id']}",
    }


@app.post("/api/files")
async def upload_file(file: UploadFile = File(...), chat_id: int | None = None):
    raw = await file.read()
    if len(raw) > MAX_UPLOAD:
        return JSONResponse({"error": "File is larger than 25 MB."}, status_code=413)
    if not raw:
        return JSONResponse({"error": "That file is empty."}, status_code=400)
    name = (file.filename or "file").strip()[:120]
    kind = classify(name, file.content_type or "")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored = UPLOAD_DIR / f"{uuid4().hex}{Path(name).suffix.lower()[:10]}"
    stored.write_bytes(raw)
    extracted = extract_text(stored, kind, name)
    conn = connect()
    try:
        with conn:
            cur = conn.execute(
                "INSERT INTO files (chat_id, name, mime, kind, size, path, extracted) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (chat_id, name, file.content_type or "", kind, len(raw), str(stored), extracted),
            )
        row = conn.execute("SELECT * FROM files WHERE id = ?", (cur.lastrowid,)).fetchone()
        return {**file_out(row), "extracted": extracted}
    finally:
        conn.close()


@app.get("/api/files/{file_id}")
def serve_file(file_id: int, download: int = 0):
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
    finally:
        conn.close()
    if row is None or not Path(row["path"]).exists():
        return JSONResponse({"error": "File not found"}, status_code=404)
    headers = {}
    if download:
        safe = row["name"].replace('"', "")
        headers["Content-Disposition"] = f'attachment; filename="{safe}"'
    return FileResponse(row["path"], media_type=row["mime"] or "application/octet-stream", headers=headers)


def cleanup_chat_files(chat_id: int, conn: sqlite3.Connection) -> None:
    """Delete the on-disk files a chat owns (called before the rows vanish)."""
    rows = conn.execute("SELECT path FROM files WHERE chat_id = ?", (chat_id,)).fetchall()
    with conn:
        conn.execute("DELETE FROM files WHERE chat_id = ?", (chat_id,))
    for r in rows:
        try:
            Path(r["path"]).unlink(missing_ok=True)
        except OSError:
            pass


def link_files(conn: sqlite3.Connection, ids: list, chat_id: int, message_id: int) -> list[sqlite3.Row]:
    """Attach freshly uploaded files to the user message just inserted."""
    if not ids:
        return []
    ids = [int(i) for i in ids][:10]
    marks = ",".join("?" * len(ids))
    conn.execute(
        f"UPDATE files SET chat_id = ?, message_id = ? WHERE id IN ({marks}) AND message_id IS NULL",
        (chat_id, message_id, *ids),
    )
    return conn.execute(
        f"SELECT * FROM files WHERE id IN ({marks}) AND message_id = ?", (*ids, message_id)
    ).fetchall()


def files_for_messages(conn: sqlite3.Connection, message_ids: list) -> dict:
    if not message_ids:
        return {}
    marks = ",".join("?" * len(message_ids))
    out: dict = {}
    rows = conn.execute(
        f"SELECT * FROM files WHERE message_id IN ({marks}) ORDER BY id", message_ids
    ).fetchall()
    for r in rows:
        out.setdefault(r["message_id"], []).append(r)
    return out


# ---------------------------------------------------------------- streaming

def strip_images(messages: list) -> list:
    """Text-only copy of the payload (fallback when the model has no vision)."""
    out = []
    for m in messages:
        if isinstance(m.get("content"), list):
            text = " ".join(
                p.get("text", "") for p in m["content"] if p.get("type") == "text"
            )
            out.append({**m, "content": text})
        else:
            out.append(m)
    return out


def has_images(messages: list) -> bool:
    return any(
        isinstance(m.get("content"), list)
        and any(p.get("type") == "image_url" for p in m["content"])
        for m in messages
    )


async def generate(
    run: dict,
    messages: list,
    chat_id: int,
    target_id: int | None = None,
    prefix: str = "",
    persist: bool = True,
):
    """Yield SSE events, always persisting whatever the model produced.

    target_id set  -> append to that existing message (Continue).
    persist False  -> incognito chat, nothing is written.
    """
    new_text = ""
    saved = False

    def save_partial() -> None:
        nonlocal saved
        if saved or not new_text.strip() or not persist:
            return
        saved = True
        full = prefix + new_text
        conn = connect()
        try:
            if target_id is not None:
                conn.execute(
                    "UPDATE messages SET content = ?, model = ? WHERE id = ?",
                    (full, run["model"], target_id),
                )
            else:
                conn.execute(
                    "INSERT INTO messages (chat_id, role, content, model) VALUES (?, 'assistant', ?, ?)",
                    (chat_id, full, run["model"]),
                )
            conn.commit()
        finally:
            conn.close()

    if not run["api_key"]:
        yield sse({"type": "error", "error": "No API key set. Open Settings and add a provider API key."})
        return

    client = AsyncOpenAI(api_key=run["api_key"], base_url=run["base_url"])
    kwargs: dict = {
        "model": run["model"],
        "messages": messages,
        "temperature": run["temperature"],
        "max_tokens": run["max_tokens"],
        "stream": True,
    }
    if run.get("top_p") is not None:
        kwargs["top_p"] = run["top_p"]
    try:
        try:
            stream = await client.chat.completions.create(**kwargs)
        except openai.BadRequestError:
            if not has_images(messages):
                raise
            # Model/provider has no vision - resend as text only.
            kwargs["messages"] = strip_images(messages)
            stream = await client.chat.completions.create(**kwargs)
        async for chunk in stream:
            choices = getattr(chunk, "choices", None)
            if not choices:
                continue
            delta = choices[0].delta
            piece = getattr(delta, "content", None) if delta else None
            if piece:
                new_text += piece
                yield sse({"type": "token", "content": piece})
        yield sse({"type": "done", "model": run["model"]})
    except Exception as exc:  # noqa: BLE001 - reported to the client as SSE
        yield sse({"type": "error", "error": friendly_error(exc)})
    finally:
        save_partial()  # also runs when the client hits Stop / disconnects


class MessageIn(BaseModel):
    content: str = ""
    model: str | None = None
    append: bool = True
    truncate_from: int | None = None
    continue_last: bool = False
    history: list[dict] | None = None
    files: list[int] = []


def build_content(content: str, rows: list[sqlite3.Row], allow_images: bool = True):
    """Message payload for the model: text + extracted file text + image parts."""
    notes = []
    parts = []
    for r in rows:
        if r["kind"] == "image":
            if allow_images and r["mime"].startswith("image/"):
                try:
                    data = Path(r["path"]).read_bytes()
                except OSError:
                    continue
                if len(data) <= 8 * 1024 * 1024:
                    b64 = base64.b64encode(data).decode()
                    parts.append(
                        {"type": "image_url", "image_url": {"url": f"data:{r['mime']};base64,{b64}"}}
                    )
                    continue
            notes.append(f"[image attached: {r['name']}]")
        elif r["kind"] in ("text", "pdf") and r["extracted"].strip():
            notes.append(f"[file: {r['name']}]\n{r['extracted'].strip()}")
        else:
            notes.append(f"[file attached: {r['name']} - content not readable as text]")
    text = content.strip()
    if notes:
        text = (text + "\n\n" if text else "") + "\n\n".join(notes)
    if parts:
        return [{"type": "text", "text": text or "Please look at the attached image(s)."}, *parts]
    return text


CONTINUE_NUDGE = (
    "Continue exactly from where you stopped. Do not repeat any text that is "
    "already written - just keep going."
)


def build_run(chat: sqlite3.Row, picked_model: str | None, st: dict) -> dict:
    """Merge global settings, per-chat overrides and the model picked in the UI."""
    base_url, key = provider_creds(load_provider(), st)
    temperature = chat["temperature"] if chat["temperature"] is not None else float(st["temperature"])
    max_tokens = chat["max_tokens"] if chat["max_tokens"] is not None else int(st["max_tokens"])
    system_prompt = chat["system_prompt"] if chat["system_prompt"] is not None else st["system_prompt"]
    model = (picked_model or "").strip() or chat["model"] or st["model"]
    return {
        "api_key": key,
        "base_url": base_url,
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "top_p": chat["top_p"],
        "system_prompt": system_prompt,
    }


@app.post("/api/chats/{chat_id}/stream")
async def stream_message(chat_id: int, body: MessageIn):
    conn = connect()
    try:
        chat = conn.execute(f"SELECT {CHAT_COLS} FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if chat is None:
            return JSONResponse({"error": "Chat not found"}, status_code=404)

        st = load_settings()
        run = build_run(chat, body.model, st)
        persist = not bool(chat["incognito"])
        limit = max(1, int(st["history_limit"]))

        # Rows for files uploaded with this message (works for incognito too,
        # where nothing gets linked to a message).
        file_rows: list[sqlite3.Row] = []
        if body.files:
            marks = ",".join("?" * len(body.files[:10]))
            file_rows = conn.execute(
                f"SELECT * FROM files WHERE id IN ({marks})",
                [int(i) for i in body.files[:10]],
            ).fetchall()

        if body.truncate_from is not None:
            # Edit & resend / regenerate: drop the messages being replaced.
            conn.execute(
                "DELETE FROM messages WHERE chat_id = ? AND id >= ?",
                (chat_id, body.truncate_from),
            )

        target_id = None
        prefix = ""
        if body.continue_last:
            if persist:
                last = conn.execute(
                    "SELECT id, role, content FROM messages WHERE chat_id = ? "
                    "ORDER BY id DESC LIMIT 1",
                    (chat_id,),
                ).fetchone()
                if last is None or last["role"] != "assistant":
                    return JSONResponse({"error": "Nothing to continue."}, status_code=400)
                target_id = last["id"]
                prefix = last["content"]

        if body.append and persist:
            previous = conn.execute(
                "SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?", (chat_id,)
            ).fetchone()["n"]
            cur = conn.execute(
                "INSERT INTO messages (chat_id, role, content, model) VALUES (?, 'user', ?, ?)",
                (chat_id, body.content, run["model"]),
            )
            link_files(conn, body.files, chat_id, cur.lastrowid)
            if previous == 0:
                conn.execute(
                    "UPDATE chats SET title = ? WHERE id = ?",
                    (body.content.strip()[:40] or (file_rows[0]["name"] if file_rows else "New Chat"), chat_id),
                )
        conn.commit()

        # History: the client sends it for incognito chats (nothing in the DB),
        # otherwise we read our own.
        if body.history is not None:
            history = [
                {"role": m["role"], "content": m["content"]}
                for m in body.history
                if isinstance(m, dict)
                and m.get("role") in ("user", "assistant")
                and isinstance(m.get("content"), (str, list))
            ]
            if body.append and file_rows and history:
                # Incognito: the client history has no file text - add it here.
                history[-1]["content"] = build_content(
                    history[-1]["content"] if isinstance(history[-1]["content"], str) else "",
                    file_rows,
                )
        elif persist:
            rows = conn.execute(
                "SELECT id, role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?",
                (chat_id, limit),
            ).fetchall()
            past = files_for_messages(conn, [r["id"] for r in rows])
            history = []
            for i, r in enumerate(reversed(rows)):
                newest = i == len(rows) - 1
                fs = file_rows if (body.append and newest) else past.get(r["id"], [])
                history.append(
                    {
                        "role": r["role"],
                        "content": build_content(r["content"], fs, allow_images=newest),
                    }
                )
        else:
            history = [{"role": "user", "content": body.content}] if body.append else []
    finally:
        conn.close()

    messages = []
    if run["system_prompt"].strip():
        messages.append({"role": "system", "content": run["system_prompt"]})
    messages.extend(history)
    if body.continue_last:
        if not history or history[-1]["role"] != "assistant":
            return JSONResponse({"error": "Nothing to continue."}, status_code=400)
        messages.append({"role": "user", "content": CONTINUE_NUDGE})

    return StreamingResponse(
        generate(run, messages, chat_id, target_id, prefix, persist),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
