import { useState, useRef, useEffect, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
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
  title?: string
  messages: Message[]
}

const EMPTY_PROMPTS_NO_SESSIONS = [
  'Stomach: empty. Options: endless.',
  'Food o\'clock. obviously.',
  'No thoughts, just food',
  'The tacos aren\'t gonna find themselves',
  'Okay but where are we going tho',
]

const EMPTY_PROMPTS_WITH_SESSIONS = [
  'Back again?? so predictable (same)',
  'AND NOW... WE FEAST!',
  'New chat, New meal, New me',
  'You vs hunger. Round 2. Fight.',
  'Hunger is imminent- act fast!',
]

const ALL_SUGGESTIONS = [
  'BEST PIZZA WHERE',
  'Cheap eats in Brooklyn',
  'Kevin\'s famous chili?',
  'Open late night',
  'Best sushi in town',
  'I. need. caffeine.',
  'Brunch this weekend',
  'Family friendly restaurants',
  'Hidden gem restaurants',
  'Tacos!!!!',
  'Rooftop dining options',
  'Date night ideas',
  'Vegan options near me',
]

const STORAGE_KEY = 'rf_sessions'

function readSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const stored: { id: string; title?: string }[] = raw ? JSON.parse(raw) : []
    return stored.map(s => ({ id: s.id, title: s.title, messages: [] }))
  } catch {
    return []
  }
}

function persistSessions(sessions: Session[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(
    sessions.map(s => ({ id: s.id, title: s.title }))
  ))
}

function sessionLabel(session: Session): string {
  if (session.title) return session.title
  const first = session.messages.find(m => m.role === 'user')
  if (!first) return 'New chat'
  return first.text.length > 26 ? first.text.slice(0, 26) + '…' : first.text
}

function App() {
  const config = useConfig()
  const api = useMemo(() => createApiClient(config), [config])
  const [sessions, setSessions] = useState<Session[]>(readSessions)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const nextMsgId = useRef(0)
  const suggestions = useMemo(() =>
    [...ALL_SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 4),
  [])

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
      persistSessions(next)
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

  async function sendMessage(override?: string) {
    const text = (override ?? input).trim()
    if (!text || loading) return
    if (override) setSidebarOpen(false)

    let sessionId: string
    const title = text.length > 26 ? text.slice(0, 26) + '…' : text
    if (activeId) {
      sessionId = activeId
    } else {
      sessionId = crypto.randomUUID()
      setSessions(prev => {
        const next = [...prev, { id: sessionId, title, messages: [] }]
        persistSessions(next)
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
        body: JSON.stringify({ prompt: text, sessionId }),
      })

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let replyText = ''
      let replyId: number | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const parsed = JSON.parse(line.slice(6).trim())
            const text = parsed?.event?.contentBlockDelta?.delta?.text
            if (text) {
              replyText += text
              if (replyId === null) {
                replyId = nextMsgId.current++
                setLoading(false)
                patchMessages(sessionId, msgs => [
                  ...msgs,
                  { id: replyId!, role: 'assistant', text: replyText },
                ])
              } else {
                patchMessages(sessionId, msgs =>
                  msgs.map(m => m.id === replyId ? { ...m, text: replyText } : m)
                )
              }
            }
          } catch {
            // skip non-JSON or non-event lines
          }
        }
      }

      if (replyId === null) {
        patchMessages(sessionId, msgs => [
          ...msgs,
          { id: nextMsgId.current++, role: 'error', text: 'No response received' },
        ])
      }
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

  const emptyPrompt = useMemo(() => {
    const pool = sessions.length === 0 ? EMPTY_PROMPTS_NO_SESSIONS : EMPTY_PROMPTS_WITH_SESSIONS
    return pool[Math.floor(Math.random() * pool.length)]
  }, [sessions.length === 0])

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
            <div className="sidebar-header">
              <button className="sidebar-close-btn" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}>✕</button>
              <button className="new-chat-btn" onClick={startNewChat}>+ New Chat</button>
            </div>
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
              <button
                className="menu-toggle menu-toggle--header"
                aria-label="Toggle sidebar"
                onClick={() => setSidebarOpen(o => !o)}
              >
                <span /><span /><span />
              </button>
              <span className="chat-title">hungry.nyc 🗽</span>
            </header>

            <main className="message-list">
              {!activeSession
                ? <div className="empty-state">{emptyPrompt}</div>
                : activeSession.messages.length === 0
                  ? <div className="empty-state">Send a message to get started</div>
                  : activeSession.messages.map(msg => (
                      <div key={msg.id} className={`bubble-row ${msg.role}`}>
                        <div className={`bubble ${msg.role}`}>
                          {msg.role === 'assistant'
                            ? <ReactMarkdown>{msg.text}</ReactMarkdown>
                            : msg.text}
                        </div>
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
              {(!activeSession || activeSession.messages.length === 0) && (
                <div className="prompt-suggestions">
                  {suggestions.map(suggestion => (
                    <button
                      key={suggestion}
                      className="suggestion-chip"
                      onClick={() => sendMessage(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
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
                onClick={() => sendMessage()}
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
