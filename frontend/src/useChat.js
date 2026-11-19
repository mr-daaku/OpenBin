import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const pick = (m) => ({ role: m.role, content: m.content })

// The backend stamps every request with this so "today"/"latest" mean the
// user's own day, not the server's.
const TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
})()

/**
 * Owns the message list for the active chat plus streaming via fetch +
 * ReadableStream (SSE frames parsed by hand, no EventSource).
 *
 * options.incognito -> nothing is persisted server-side, so the client sends
 * its own history and never re-reads the message list from the DB.
 */
export default function useChat(chatId, onChatChanged, options = {}) {
  const [messages, setMessages] = useState([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState(null)
  const [stopReason, setStopReason] = useState(null) // 'stopped' | 'error' | null

  const abortRef = useRef(null)
  const sessionRef = useRef(0)
  const targetRef = useRef(null)
  const messagesRef = useRef(messages)
  const changedRef = useRef(onChatChanged)
  const optsRef = useRef(options)
  messagesRef.current = messages
  changedRef.current = onChatChanged
  optsRef.current = options

  const isIncognito = () => !!optsRef.current.incognito

  // Load messages whenever the active chat changes; kill any running stream.
  useEffect(() => {
    sessionRef.current += 1
    abortRef.current?.abort()
    setStreaming(false)
    setError(null)
    setStopReason(null)
    setMessages([])
    if (chatId == null) return
    let alive = true
    api
      .getMessages(chatId)
      .then((rows) => alive && setMessages(rows))
      .catch((err) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [chatId])

  const stop = useCallback(() => abortRef.current?.abort(), [])
  const clearError = useCallback(() => setError(null), [])

  // Attach the next token to whichever message this run is writing into.
  const applyToken = useCallback((piece, model) => {
    const target = targetRef.current
    if (!target) return
    setMessages((prev) => {
      const next = prev.slice()
      const i = next.findIndex((m) => m.id === target.id)
      if (i === -1) {
        if (target.create) {
          next.push({ id: target.id, role: 'assistant', content: piece, model: model || null })
        }
        return next
      }
      next[i] = { ...next[i], content: next[i].content + piece }
      return next
    })
  }, [])

  // Live "Sources & steps" trace: appended step by step while the answer is
  // being written, replaced wholesale when the server sends its final meta.
  const applyTrace = useCallback((patch) => {
    const target = targetRef.current
    if (!target) return
    setMessages((prev) => {
      const next = prev.slice()
      const i = next.findIndex((m) => m.id === target.id)
      if (i === -1) return prev
      const msg = { ...next[i] }
      if (patch.step || patch.notice) {
        const entry = patch.step || { kind: 'notice', text: patch.notice.text }
        msg.steps = [...(msg.steps || []), entry]
      }
      if (patch.steps) msg.steps = patch.steps
      if (patch.sources) msg.sources = patch.sources
      next[i] = msg
      return next
    })
  }, [])

  const run = useCallback(
    async (payload, session) => {
      setError(null)
      setStreaming(true)
      setStopReason(null)
      const controller = new AbortController()
      abortRef.current = controller
      let aborted = false
      let failed = false

      try {
        const res = await fetch(`/api/chats/${chatId}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          const text = await res.text()
          let data = null
          try {
            data = JSON.parse(text)
          } catch {
            /* not JSON */
          }
          throw new Error(data?.error || data?.detail || `Request failed (${res.status})`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let sawDone = false

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop()
          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data:'))
            if (!line) continue
            let data
            try {
              data = JSON.parse(line.slice(5))
            } catch {
              continue
            }
            if (data.type === 'token') {
              applyToken(data.content, payload.model)
            } else if (data.type === 'step') {
              applyTrace({ step: { kind: data.kind || 'info', text: data.text } })
            } else if (data.type === 'notice') {
              applyTrace({ notice: data })
            } else if (data.type === 'search') {
              applyTrace({ sources: data.results || [] })
            } else if (data.type === 'meta') {
              applyTrace({ sources: data.sources || [], steps: data.steps || [] })
            } else if (data.type === 'done') {
              sawDone = true
            } else if (data.type === 'error') {
              failed = true
              throw new Error(data.error)
            }
          }
        }
        if (!sawDone) failed = true
      } catch (err) {
        if (err?.name === 'AbortError') aborted = true
        else if (sessionRef.current === session) {
          failed = true
          setError(err?.message || 'Something went wrong. Please try again.')
        }
      } finally {
        abortRef.current = null
        targetRef.current = null
        if (sessionRef.current !== session) return // user switched chat mid-stream
        setStreaming(false)
        setStopReason(aborted ? 'stopped' : failed ? 'error' : null)
        if (aborted) await delay(400) // give the server a moment to save the partial reply
        if (!isIncognito()) {
          try {
            const fresh = await api.getMessages(chatId)
            if (sessionRef.current === session) setMessages(fresh)
          } catch {
            /* keep the optimistic view */
          }
        }
        changedRef.current?.()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, applyToken, applyTrace],
  )

  // Search mode + timezone travel with every request (send, regenerate,
  // edit & resend, continue), so a reply never falls back to a wrong mode.
  const searchOpts = () => ({ search: optsRef.current.searchMode || 'auto', tz: TIMEZONE })

  const send = useCallback(
    async (raw, opts = {}) => {
      const content = String(raw || '').trim()
      const files = Array.isArray(opts.files) ? opts.files : []
      if ((!content && files.length === 0) || streaming || chatId == null) return

      const session = ++sessionRef.current
      const model = opts.model || ''
      const list = messagesRef.current
      const userMsg = {
        id: `local-${session}`,
        role: 'user',
        content,
        model: model || null,
        files: files.map((f) => ({ ...f })),
      }
      const botId = `stream-${session}`

      targetRef.current = { id: botId, create: true }
      setMessages([...list, userMsg, { id: botId, role: 'assistant', content: '', model: model || null }])

      await run(
        {
          content,
          model: model || null,
          append: true,
          files: files.map((f) => f.id),
          history: isIncognito() ? [...list, userMsg].map(pick) : null,
          ...searchOpts(),
        },
        session,
      )
    },
    [chatId, streaming, run],
  )

  const regenerate = useCallback(
    async (messageId, fallbackModel = '') => {
      if (streaming || chatId == null) return
      const list = messagesRef.current
      const idx = list.findIndex((m) => m.id === messageId)
      if (idx === -1 || list[idx].role !== 'assistant') return

      const session = ++sessionRef.current
      const model = list[idx].model || fallbackModel || ''
      const serverId = typeof messageId === 'number' ? messageId : null

      targetRef.current = { id: messageId, create: false }
      setMessages(
        list.map((m, i) =>
          i === idx ? { ...m, content: '', steps: null, sources: null } : m,
        ),
      )

      await run(
        {
          content: '',
          model: model || null,
          append: false,
          truncate_from: serverId,
          history: isIncognito() ? list.slice(0, idx).map(pick) : null,
          ...searchOpts(),
        },
        session,
      )
    },
    [chatId, streaming, run],
  )

  const editAndResend = useCallback(
    async (messageId, newContent, model = '') => {
      const content = String(newContent || '').trim()
      if (!content || streaming || chatId == null) return false

      const list = messagesRef.current
      const idx = list.findIndex((m) => m.id === messageId)
      if (idx === -1) return false

      const session = ++sessionRef.current
      let kept
      if (isIncognito()) {
        kept = list.slice(0, idx).map((m) => (m.id === messageId ? { ...m, content } : m))
      } else {
        try {
          await api.editMessage(messageId, content)
        } catch (err) {
          setError(err.message)
          return false
        }
        kept = list.slice(0, idx).map((m) => (m.id === messageId ? { ...m, content } : m))
      }

      const botId = `stream-${session}`
      targetRef.current = { id: botId, create: true }
      setMessages([...kept, { id: botId, role: 'assistant', content: '', model: model || null }])

      await run(
        {
          content,
          model: model || null,
          append: false,
          history: isIncognito() ? kept.map(pick) : null,
          ...searchOpts(),
        },
        session,
      )
      return true
    },
    [chatId, streaming, run],
  )

  const removeMessage = useCallback(
    async (messageId) => {
      if (streaming || chatId == null) return
      if (!isIncognito() && typeof messageId === 'number') {
        try {
          await api.deleteMessage(messageId)
        } catch (err) {
          setError(err.message)
          return
        }
      }
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
      changedRef.current?.()
    },
    [chatId, streaming],
  )

  const continueReply = useCallback(async (model = '') => {
    if (streaming || chatId == null) return
    const list = messagesRef.current
    const last = list[list.length - 1]
    if (!last || last.role !== 'assistant' || !last.content) return

    const session = ++sessionRef.current
    targetRef.current = { id: last.id, create: false }
    await run(
      {
        content: '',
        model: model || null,
        append: false,
        continue_last: true,
        history: isIncognito() ? list.map(pick) : null,
        ...searchOpts(),
      },
      session,
    )
  }, [chatId, streaming, run])

  return {
    messages,
    streaming,
    error,
    stopReason,
    send,
    stop,
    clearError,
    showError: setError,
    regenerate,
    editAndResend,
    removeMessage,
    continueReply,
  }
}
