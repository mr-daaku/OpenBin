import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Owns the message list for the active chat plus streaming via fetch +
 * ReadableStream (SSE frames parsed by hand, no EventSource).
 */
export default function useChat(chatId, onChatChanged) {
  const [messages, setMessages] = useState([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState(null)

  const abortRef = useRef(null)
  const sessionRef = useRef(0)
  const changedRef = useRef(onChatChanged)
  changedRef.current = onChatChanged

  // Load messages whenever the active chat changes; kill any running stream.
  useEffect(() => {
    sessionRef.current += 1
    abortRef.current?.abort()
    setStreaming(false)
    setError(null)
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

  const send = useCallback(
    async (raw) => {
      const content = String(raw || '').trim()
      if (!content || streaming || chatId == null) return

      const session = ++sessionRef.current
      setError(null)
      setMessages((prev) => [
        ...prev,
        { id: `local-${session}`, role: 'user', content },
        { id: `stream-${session}`, role: 'assistant', content: '', local: true },
      ])
      setStreaming(true)
      const controller = new AbortController()
      abortRef.current = controller
      let aborted = false

      try {
        const res = await fetch(`/api/chats/${chatId}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
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
              const piece = data.content
              setMessages((prev) => {
                const next = prev.slice()
                const last = next[next.length - 1]
                if (last && last.role === 'assistant' && last.local) {
                  next[next.length - 1] = { ...last, content: last.content + piece }
                } else {
                  next.push({ id: `stream-${session}`, role: 'assistant', content: piece, local: true })
                }
                return next
              })
            } else if (data.type === 'error') {
              throw new Error(data.error)
            }
          }
        }
      } catch (err) {
        if (err?.name === 'AbortError') aborted = true
        else if (sessionRef.current === session) setError(err?.message || 'Something went wrong. Please try again.')
      } finally {
        abortRef.current = null
        if (sessionRef.current !== session) return // user switched chat mid-stream
        setStreaming(false)
        if (aborted) await delay(400) // give the server a moment to save the partial reply
        try {
          const fresh = await api.getMessages(chatId)
          if (sessionRef.current === session) setMessages(fresh)
        } catch {
          /* keep the optimistic view */
        }
        changedRef.current?.()
      }
    },
    [chatId, streaming],
  )

  return { messages, streaming, error, send, stop, clearError, showError: setError }
}
