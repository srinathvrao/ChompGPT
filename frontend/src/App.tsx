import { useState, useRef, useEffect, useMemo } from 'react'
import './App.css'
import { useConfig } from './config'
import { createApiClient } from './aws'

interface Message {
  id: number
  role: 'user' | 'assistant' | 'error'
  text: string
}

interface Session {
  id: string
  messages: Message[]
}

const COOKIE_KEY = 'rf_sessions'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

function readSessionIds(): string[] {
  const match = document.cookie.match(/(?:^|;\s*)rf_sessions=([^;]*)/)
  if (!match?.[1]) return []
  return match[1].split(',').filter(Boolean)
}

function persistSessionIds(ids: string[]) {
  document.cookie = `${COOKIE_KEY}=${ids.join(',')}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax`
}

function sessionLabel(session: Session): string {
  const first = session.messages.find(m => m.role === 'user')
  if (!first) return 'New chat'
  return first.text.length > 26 ? first.text.slice(0, 26) + '…' : first.text
}

function App() {
  const config = useConfig()
  const api = useMemo(() => createApiClient(config), [config])
  const [sessions, setSessions] = useState<Session[]>(() =>
    readSessionIds().map(id => ({ id, messages: [] }))
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const nextMsgId = useRef(0)

  const activeSession = sessions.find(s => s.id === activeId) ?? null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeSession?.messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [activeId])

  useEffect(() => {
    if (!menuOpenId) return
    const close = () => setMenuOpenId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpenId])

  function patchMessages(sessionId: string, updater: (m: Message[]) => Message[]) {
    setSessions(prev =>
      prev.map(s => s.id === sessionId ? { ...s, messages: updater(s.messages) } : s)
    )
  }

  function deleteSession(id: string) {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id)
      persistSessionIds(next.map(s => s.id))
      return next
    })
    if (activeId === id) setActiveId(null)
    setMenuOpenId(null)
  }

  function startNewChat() {
    setActiveId(null)
    setInput('')
    setMenuOpenId(null)
    setSidebarOpen(false)
    inputRef.current?.focus()
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return

    let sessionId: string
    if (activeId) {
      sessionId = activeId
    } else {
      sessionId = crypto.randomUUID()
      const newSess: Session = { id: sessionId, messages: [] }
      setSessions(prev => {
        const next = [...prev, newSess]
        persistSessionIds(next.map(s => s.id))
        return next
      })
      setActiveId(sessionId)
    }

    patchMessages(sessionId, msgs => [
      ...msgs,
      { id: nextMsgId.current++, role: 'user', text },
    ])
    setInput('')
    setLoading(true)

    try {
      const res = await api.fetch('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
      })
      const data = await res.json()
      const reply = data.message ?? data.reply ?? data.response ?? data.text ?? JSON.stringify(data)
      patchMessages(sessionId, msgs => [
        ...msgs,
        { id: nextMsgId.current++, role: 'assistant', text: reply },
      ])
    } catch (err) {
      patchMessages(sessionId, msgs => [
        ...msgs,
        { id: nextMsgId.current++, role: 'error', text: `Error: ${(err as Error).message}` },
      ])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const emptyPrompt = sessions.length === 0
    ? 'Send a message to start your first chat'
    : 'Select a chat or send a message to start a new one'

  return (
    <div className="page">
      <div className="chat-container">

        {/* Permanent left strip — pancake always visible here */}
        <div className="sidebar-strip">
          <button
            className="menu-toggle"
            aria-label="Toggle sidebar"
            onClick={() => setSidebarOpen(o => !o)}
          >
            <span /><span /><span />
          </button>
        </div>

        {/* Chat area — sidebar overlays this */}
        <div className="chat-area">
          <aside className={`sidebar-overlay${sidebarOpen ? ' sidebar-overlay--open' : ''}`}>
            <button className="new-chat-btn" onClick={startNewChat}>+ New Chat</button>
            <ul className="session-list">
              {sessions.slice().reverse().map(s => (
                <li
                  key={s.id}
                  className={`session-item${s.id === activeId ? ' active' : ''}`}
                  onClick={() => { setActiveId(s.id); setMenuOpenId(null); setSidebarOpen(false); }}
                >
                  <span className="session-preview">{sessionLabel(s)}</span>
                  <div className="session-actions" onClick={e => e.stopPropagation()}>
                    {menuOpenId === s.id && (
                      <button className="delete-btn" onClick={() => deleteSession(s.id)}>
                        Delete
                      </button>
                    )}
                    <button
                      className="dots-btn"
                      aria-label="More options"
                      onClick={e => {
                        e.stopPropagation()
                        setMenuOpenId(menuOpenId === s.id ? null : s.id)
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </aside>

          <div className="chat-shell">
            <header className="chat-header">
              <span className="chat-title">Restaurant Finder</span>
            </header>

            <main className="message-list">
              {!activeSession
                ? <div className="empty-state">{emptyPrompt}</div>
                : activeSession.messages.length === 0
                  ? <div className="empty-state">Send a message to get started</div>
                  : activeSession.messages.map(msg => (
                      <div key={msg.id} className={`bubble-row ${msg.role}`}>
                        <div className={`bubble ${msg.role}`}>{msg.text}</div>
                      </div>
                    ))
              }
              {loading && (
                <div className="bubble-row assistant">
                  <div className="bubble assistant typing">
                    <span /><span /><span />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </main>

            <footer className="chat-footer">
              <textarea
                ref={inputRef}
                className="chat-input"
                rows={1}
                placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
              />
              <button
                className="send-btn"
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                aria-label="Send"
              >
                &#9658;
              </button>
            </footer>
          </div>
        </div>

      </div>
    </div>
  )
}

export default App
