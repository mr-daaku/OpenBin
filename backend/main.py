"""OpenBin backend: FastAPI + SQLite + NVIDIA NIM (OpenAI-compatible).

Run from the backend/ folder:
    uvicorn main:app --reload --port 8000

Only ever bind to 127.0.0.1 (the Vite dev server proxies /api here).
"""

import json
import sqlite3
from pathlib import Path

import openai
from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
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


class TitleIn(BaseModel):
    title: str


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

CHAT_COLS = "id, title, created_at, model, temperature, max_tokens, top_p, system_prompt"


def chat_settings(row: sqlite3.Row) -> dict:
    return {
        "model": row["model"],
        "temperature": row["temperature"],
        "max_tokens": row["max_tokens"],
        "top_p": row["top_p"],
        "system_prompt": row["system_prompt"],
    }


@app.get("/api/chats")
def list_chats():
    conn = connect()
    try:
        rows = conn.execute(f"SELECT {CHAT_COLS} FROM chats ORDER BY id DESC").fetchall()
        return [{**dict(r), "settings": chat_settings(r)} for r in rows]
    finally:
        conn.close()


@app.post("/api/chats")
def create_chat():
    conn = connect()
    try:
        cur = conn.execute("INSERT INTO chats (title) VALUES ('New Chat')")
        conn.commit()
        row = conn.execute(f"SELECT {CHAT_COLS} FROM chats WHERE id = ?", (cur.lastrowid,)).fetchone()
        return {**dict(row), "settings": chat_settings(row)}
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
        return {**dict(fresh), "settings": chat_settings(fresh)}
    finally:
        conn.close()


@app.patch("/api/chats/{chat_id}")
def rename_chat(chat_id: int, body: TitleIn):
    conn = connect()
    try:
        cur = conn.execute("UPDATE chats SET title = ? WHERE id = ?", (body.title.strip()[:80], chat_id))
        conn.commit()
        if cur.rowcount == 0:
            return JSONResponse({"error": "Chat not found"}, status_code=404)
        row = conn.execute(f"SELECT {CHAT_COLS} FROM chats WHERE id = ?", (chat_id,)).fetchone()
        return {**dict(row), "settings": chat_settings(row)}
    finally:
        conn.close()


@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: int):
    conn = connect()
    try:
        cur = conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
        conn.commit()
        if cur.rowcount == 0:
            return JSONResponse({"error": "Chat not found"}, status_code=404)
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
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------- streaming

async def generate(run: dict, messages: list, chat_id: int):
    """Yield SSE events, always persisting whatever the model produced."""
    text = ""
    saved = False

    def save_partial() -> None:
        nonlocal saved
        if saved or not text.strip():
            return
        saved = True
        conn = connect()
        try:
            conn.execute(
                "INSERT INTO messages (chat_id, role, content, model) VALUES (?, 'assistant', ?, ?)",
                (chat_id, text, run["model"]),
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
        stream = await client.chat.completions.create(**kwargs)
        async for chunk in stream:
            choices = getattr(chunk, "choices", None)
            if not choices:
                continue
            delta = choices[0].delta
            piece = getattr(delta, "content", None) if delta else None
            if piece:
                text += piece
                yield sse({"type": "token", "content": piece})
        yield sse({"type": "done", "model": run["model"]})
    except Exception as exc:  # noqa: BLE001 - reported to the client as SSE
        yield sse({"type": "error", "error": friendly_error(exc)})
    finally:
        save_partial()  # also runs when the client hits Stop / disconnects


class MessageIn(BaseModel):
    content: str
    model: str | None = None


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

        run = build_run(chat, body.model, load_settings())

        previous = conn.execute(
            "SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?", (chat_id,)
        ).fetchone()["n"]
        conn.execute(
            "INSERT INTO messages (chat_id, role, content, model) VALUES (?, 'user', ?, ?)",
            (chat_id, body.content, run["model"]),
        )
        if previous == 0:
            title = body.content.strip()[:40] or "New Chat"
            conn.execute("UPDATE chats SET title = ? WHERE id = ?", (title, chat_id))
        conn.commit()

        st = load_settings()
        limit = max(1, int(st["history_limit"]))
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?",
            (chat_id, limit),
        ).fetchall()
    finally:
        conn.close()

    history = [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]
    messages = []
    if run["system_prompt"].strip():
        messages.append({"role": "system", "content": run["system_prompt"]})
    messages.extend(history)

    return StreamingResponse(
        generate(run, messages, chat_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
