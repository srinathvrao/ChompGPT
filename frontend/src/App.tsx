import { useState, useRef, useEffect, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
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
  historyLoaded: boolean
  hasMore: boolean
  oldestTimestamp: string | null
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
  'Pizza in park slope',
  'Cheap eats in midtown',
  'Kevin\'s famous chili?',
  'Vegan options near Rockefeller',
  'Best sushi in upper west',
  'Coffee near empire state',
  'Brunch in williamsburg',
  'Best spots in chinatown',
  'Hidden gem restaurants',
  'Tacos!!!',
  'Rooftop dining options',
  'Date night ideas',
  'Vegan options near me',
]

const STORAGE_KEY = 'rf_sessions'

function closeIncompleteLink(text: string): string {
  // If the text ends with an unclosed [text](url, close it so ReactMarkdown can render it
  return text.replace(/(\[[^\]]+\]\([^)]*?)$/, '$1)')
}

function hideBareUrls(text: string): string {
  // Replace bare URLs (not already inside markdown link syntax) with a compact link
  return text.replace(/(?<!\]\()https?:\/\/[^\s)>\]"]+/g, url => `[↗](${url})`)
}

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
}

function readSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const stored: { id: string; title?: string }[] = raw ? JSON.parse(raw) : []
    return stored.map(s => ({ id: s.id, title: s.title, messages: [], historyLoaded: false, hasMore: false, oldestTimestamp: null }))
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
  const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'granted' | 'denied' | 'dismissed'>('idle')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [toolInProgress, setToolInProgress] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollBehaviorRef = useRef<ScrollBehavior>('instant')
  const messageListRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const nextMsgId = useRef(0)
  const suggestions = useMemo(() =>
    [...ALL_SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 4),
  [])

  const inputPlaceholder = useMemo(() => {
    const options = [
      'hungry? let\'s find something good',
      'craving anything specific?',
      'i know a guy. a few thousand, actually',
    ]
    return options[Math.floor(Math.random() * options.length)]
  }, [])

  const activeSession = sessions.find(s => s.id === activeId) ?? null

  function requestLocation() {
    if (locationStatus === 'denied') return
    navigator.geolocation?.getCurrentPosition(
      ({ coords }) => {
        setLocation({ lat: coords.latitude, lon: coords.longitude })
        setLocationStatus('granted')
      },
      () => setLocationStatus('denied'),
    )
  }

  const lastMessageId = activeSession?.messages[activeSession.messages.length - 1]?.id
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: scrollBehaviorRef.current })
    scrollBehaviorRef.current = 'instant'
  }, [lastMessageId])

  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) {
      inputRef.current?.focus()
    }
  }, [activeId])

  useEffect(() => {
    if (!menuOpenId) return
    const close = () => setMenuOpenId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpenId])

  useEffect(() => {
    if (!activeId) return
    const session = sessions.find(s => s.id === activeId)
    if (!session || session.historyLoaded) return
    fetchHistory(activeId)
  }, [activeId])

  async function fetchHistory(sessionId: string) {
    setHistoryLoading(true)
    try {
      const res = await fetch(`/history?sessionId=${encodeURIComponent(sessionId)}`)
      const data = await res.json()
      setSessions(prev => prev.map(s => s.id === sessionId ? {
        ...s,
        messages: data.messages.map((m: { role: 'user' | 'assistant'; content: string; timestamp: string }) => ({
          id: nextMsgId.current++,
          role: m.role,
          text: m.content,
        })),
        oldestTimestamp: data.messages[0]?.timestamp ?? null,
        hasMore: data.hasMore,
        historyLoaded: true,
      } : s))
    } catch {
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, historyLoaded: true } : s))
    } finally {
      setHistoryLoading(false)
    }
  }

  async function loadMoreHistory() {
    if (!activeId || !activeSession?.hasMore || historyLoading) return
    const cursor = activeSession.oldestTimestamp
    if (!cursor) return

    setHistoryLoading(true)
    try {
      const res = await fetch(`/history?sessionId=${encodeURIComponent(activeId)}&before=${encodeURIComponent(cursor)}`)
      const data = await res.json()
      const prepended: Message[] = data.messages.map((m: { role: 'user' | 'assistant'; content: string; timestamp: string }) => ({
        id: nextMsgId.current++,
        role: m.role,
        text: m.content,
      }))
      setSessions(prev => prev.map(s => s.id === activeId ? {
        ...s,
        messages: [...prepended, ...s.messages],
        oldestTimestamp: data.messages[0]?.timestamp ?? s.oldestTimestamp,
        hasMore: data.hasMore,
      } : s))
    } catch {
      // silently fail — user can scroll up again to retry
    } finally {
      setHistoryLoading(false)
    }
  }

  function handleMessageListScroll(e: React.UIEvent<HTMLDivElement>) {
    if (e.currentTarget.scrollTop < 50 && activeSession?.hasMore && !historyLoading) {
      loadMoreHistory()
    }
  }

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
    fetch(`/session?sessionId=${encodeURIComponent(id)}`, { method: 'DELETE' })
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
        const next = [...prev, { id: sessionId, title, messages: [], historyLoaded: true, hasMore: false, oldestTimestamp: null }]
        persistSessions(next)
        return next
      })
      setActiveId(sessionId)
    }

    scrollBehaviorRef.current = 'smooth'
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
        body: JSON.stringify(
          location
            ? { prompt: text, sessionId, location }
            : { prompt: text, sessionId }
        ),
      })

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let replyText = ''
      let replyId: number | null = null
      let toolActive = false

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
            if (parsed?.event?.messageStart && replyId !== null) {
              replyText += '\n\n'
            }
            if (parsed?.event?.contentBlockStart?.start?.toolUse) {
              toolActive = true
              setToolInProgress(true)
            }
            const text = parsed?.event?.contentBlockDelta?.delta?.text
            if (text) {
              if (toolActive) {
                toolActive = false
                setToolInProgress(false)
              }
              replyText += text
              if (replyId === null) {
                replyId = nextMsgId.current++
                setLoading(false)
                setStreaming(true)
                scrollBehaviorRef.current = 'smooth'
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
      setStreaming(false)
      setToolInProgress(false)
      if (!window.matchMedia('(pointer: coarse)').matches) {
        inputRef.current?.focus()
      }
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
              <span className="chat-title">hungry.nyc 🗽<span className="chat-title-sub">more coming soon</span></span>
            </header>

            <main className="message-list" ref={messageListRef} onScroll={handleMessageListScroll}>
              {historyLoading && (
                <div className="bubble-row assistant">
                  <div className="bubble assistant typing">
                    <span /><span /><span />
                  </div>
                </div>
              )}
              {!activeSession
                ? <div className="empty-state">{emptyPrompt}</div>
                : activeSession.messages.length === 0
                  ? <div className="empty-state">Send a message to get started</div>
                  : activeSession.messages.map((msg, i) => {
                      const isLast = i === activeSession.messages.length - 1
                      return (
                        <div key={msg.id} className={`bubble-row ${msg.role}`}>
                          <div className={`bubble ${msg.role}`}>
                            {msg.role === 'assistant'
                              ? <div className={isLast && streaming ? 'streaming-md' : undefined}><ReactMarkdown components={markdownComponents}>{hideBareUrls(closeIncompleteLink(msg.text))}</ReactMarkdown>{isLast && streaming && <span className="stream-cursor" />}{isLast && toolInProgress && <span className="tool-spinner" />}</div>
                              : msg.text}
                          </div>
                        </div>
                      )
                    })
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

            {locationStatus === 'idle' && (
              <div className="location-banner">
                <button className="location-share-btn" onClick={requestLocation}>Share my location</button>
                <button className="location-dismiss-btn" aria-label="Dismiss" onClick={() => setLocationStatus('dismissed')}>✕</button>
              </div>
            )}
            <footer className="chat-footer">
              <div className="chat-input-wrapper">
                <textarea
                  ref={inputRef}
                  className="chat-input"
                  rows={1}
                  placeholder={inputPlaceholder}
                  value={input}
                  onChange={e => setInput(e.target.value.slice(0, 140))}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  maxLength={140}
                />
                <span className={`char-count${input.length >= 130 ? ' char-count--warn' : ''}`}>
                  {input.length}/140
                </span>
              </div>
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
