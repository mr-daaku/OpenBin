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

DEFAULTS = {
    "api_key": "",
    "base_url": "https://integrate.api.nvidia.com/v1",
    "model": "meta/llama-3.1-8b-instruct",
    "system_prompt": "",
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
    return {
        "api_key": mask_key(st["api_key"]),
        "has_api_key": bool(st["api_key"]),
        "base_url": st["base_url"],
        "model": st["model"],
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


class MessageIn(BaseModel):
    content: str


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
    save_settings(updates)
    return public_settings(load_settings())


@app.get("/api/models")
async def list_models():
    st = load_settings()
    if not st["api_key"]:
        return {"models": [], "error": "No API key saved yet. Add it in Settings."}
    client = AsyncOpenAI(api_key=st["api_key"], base_url=st["base_url"])
    try:
        res = await client.models.list()
        names = sorted(m.id for m in res.data if getattr(m, "id", None))
        return {"models": names, "error": None}
    except Exception as exc:  # noqa: BLE001 - return the reason to the UI
        return {"models": [], "error": friendly_error(exc)}


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


# ---------------------------------------------------------------- chats api

@app.get("/api/chats")
def list_chats():
    conn = connect()
    try:
        rows = conn.execute("SELECT id, title, created_at FROM chats ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/api/chats")
def create_chat():
    conn = connect()
    try:
        cur = conn.execute("INSERT INTO chats (title) VALUES ('New Chat')")
        conn.commit()
        row = conn.execute(
            "SELECT id, title, created_at FROM chats WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return dict(row)
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
        row = conn.execute("SELECT id, title, created_at FROM chats WHERE id = ?", (chat_id,)).fetchone()
        return dict(row)
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
            "SELECT id, chat_id, role, content, created_at FROM messages "
            "WHERE chat_id = ? ORDER BY id",
            (chat_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------- streaming

async def generate(st: dict, messages: list, chat_id: int):
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
                "INSERT INTO messages (chat_id, role, content) VALUES (?, 'assistant', ?)",
                (chat_id, text),
            )
            conn.commit()
        finally:
            conn.close()

    if not st["api_key"]:
        yield sse({"type": "error", "error": "No API key set. Open Settings and add your NVIDIA API key."})
        return

    client = AsyncOpenAI(api_key=st["api_key"], base_url=st["base_url"])
    try:
        stream = await client.chat.completions.create(
            model=st["model"],
            messages=messages,
            temperature=float(st["temperature"]),
            max_tokens=int(st["max_tokens"]),
            stream=True,
        )
        async for chunk in stream:
            choices = getattr(chunk, "choices", None)
            if not choices:
                continue
            delta = choices[0].delta
            piece = getattr(delta, "content", None) if delta else None
            if piece:
                text += piece
                yield sse({"type": "token", "content": piece})
        yield sse({"type": "done"})
    except Exception as exc:  # noqa: BLE001 - reported to the client as SSE
        yield sse({"type": "error", "error": friendly_error(exc)})
    finally:
        save_partial()  # also runs when the client hits Stop / disconnects


@app.post("/api/chats/{chat_id}/stream")
async def stream_message(chat_id: int, body: MessageIn):
    conn = connect()
    try:
        chat = conn.execute("SELECT id FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if chat is None:
            return JSONResponse({"error": "Chat not found"}, status_code=404)

        previous = conn.execute(
            "SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?", (chat_id,)
        ).fetchone()["n"]
        conn.execute(
            "INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', ?)",
            (chat_id, body.content),
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
    if st["system_prompt"].strip():
        messages.append({"role": "system", "content": st["system_prompt"]})
    messages.extend(history)

    return StreamingResponse(
        generate(st, messages, chat_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
