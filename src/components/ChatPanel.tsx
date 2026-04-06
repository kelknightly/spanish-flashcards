'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ImagePlus, Send, X, Sparkles, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

interface PendingImage {
  base64: string
  mimeType: string
  url: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  imageUrls?: string[]
}

interface ExtractedDeck {
  deckName: string
  bookNumber?: number
  chapterNumber?: number
  cards: Array<{
    spanish: string
    english: string
    sourceSentences?: Array<{ es: string; en: string }>
  }>
}

function parseExtractedDeck(text: string): ExtractedDeck | null {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (!match) return null
  try {
    return JSON.parse(match[1]) as ExtractedDeck
  } catch {
    return null
  }
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neon-purple/20 text-sm">
          ✨
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-neon-pink/20 border border-neon-pink/30 text-white'
            : 'glass border border-white/10 text-white/90'
        )}
      >
        {msg.imageUrls && msg.imageUrls.length > 0 && (
          <div className={cn('mb-2 gap-1.5', msg.imageUrls.length > 1 ? 'grid grid-cols-2' : 'flex')}>
            {msg.imageUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Screenshot ${i + 1}`}
                className="max-h-48 w-full rounded-lg object-cover"
              />
            ))}
          </div>
        )}
        <div className="whitespace-pre-wrap">{msg.content}</div>
        <div className="mt-1 text-right text-[10px] text-white/30">
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neon-pink/20 text-sm">
          🧑
        </div>
      )}
    </div>
  )
}

export function ChatPanel() {
  const { session } = useAuth()
  const router = useRouter()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [extractedDeck, setExtractedDeck] = useState<ExtractedDeck | null>(null)
  const [saving, setSaving] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Create a session on first load
  useEffect(() => {
    if (!session?.access_token) return
    fetch('/api/chat', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((d) => setSessionId(d.sessionId))
      .catch(console.error)
  }, [session?.access_token])

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  const handleImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    const toAdd = files.slice(0, 10) // hard cap
    let loaded = 0
    const results: PendingImage[] = []
    toAdd.forEach((file, idx) => {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        results[idx] = { base64: dataUrl.split(',')[1], mimeType: file.type, url: dataUrl }
        loaded++
        if (loaded === toAdd.length) {
          setPendingImages((prev) => [...prev, ...results].slice(0, 10))
        }
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }, [])

  const sendMessage = useCallback(async () => {
    if ((!input.trim() && !pendingImages.length) || streaming || !session?.access_token) return

    const userMsg: Message = {
      role: 'user',
      content: input.trim() || (pendingImages.length ? `[${pendingImages.length} screenshot${pendingImages.length > 1 ? 's' : ''} uploaded]` : ''),
      timestamp: new Date().toISOString(),
      imageUrls: pendingImages.map((p) => p.url),
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    const images = pendingImages
    setPendingImages([])
    setStreaming(true)
    setStreamingText('')
    setExtractedDeck(null)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          message: userMsg.content,
          images: images.map((img) => ({ base64: img.base64, mimeType: img.mimeType })),
          sessionId,
          history: messages,
        }),
      })

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => 'unknown error')
        let errMsg = 'Something went wrong.'
        try { errMsg = (JSON.parse(errText) as { error: string }).error } catch { errMsg = errText }
        throw new Error(errMsg)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = decoder.decode(value).split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break
          try {
            const parsed = JSON.parse(data)
            full += parsed.text ?? ''
            setStreamingText(full)
          } catch {
            // partial chunk, skip
          }
        }
      }

      const assistantMsg: Message = {
        role: 'assistant',
        content: full,
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, assistantMsg])
      setStreamingText('')

      // Check if the response contains a deck extraction
      const deck = parseExtractedDeck(full)
      if (deck) setExtractedDeck(deck)
    } catch (err) {
      console.error('[chat]', err)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'Something went wrong. Please try again.'}`,
          timestamp: new Date().toISOString(),
        },
      ])
      setStreamingText('')
    } finally {
      setStreaming(false)
    }
  }, [input, pendingImages, streaming, session?.access_token, sessionId, messages])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const saveDeck = async () => {
    if (!extractedDeck || !session?.access_token) return
    setSaving(true)
    try {
      const res = await fetch('/api/decks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          deckName: extractedDeck.deckName,
          bookNumber: extractedDeck.bookNumber,
          chapterNumber: extractedDeck.chapterNumber,
          ...(!extractedDeck.bookNumber && !extractedDeck.chapterNumber
            ? { subcategory: 'general', category: 'general' }
            : {}),
          cards: extractedDeck.cards,
          chatSessionId: sessionId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      router.push(`/decks/${data.deckId}`)
    } catch (err) {
      console.error('[saveDeck]', err)
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-12">
            <div className="text-5xl">📖</div>
            <h2 className="text-xl font-bold text-neon-pink">New Conversation</h2>
            <p className="text-sm text-white/50 max-w-sm">
              Upload a screenshot of a Narnia chapter and I'll help you build a Spanish flashcard deck.
            </p>
            <div className="flex flex-col gap-2 text-xs text-white/30">
              <p>Try: "What vocabulary should I learn from this page?"</p>
              <p>Or: "Extract a flashcard deck from this screenshot"</p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}

        {/* Streaming in-progress bubble */}
        {streaming && streamingText && (
          <div className="flex gap-3 justify-start">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neon-purple/20 text-sm">
              ✨
            </div>
            <div className="glass border border-white/10 max-w-[80%] rounded-2xl px-4 py-3 text-sm text-white/90 leading-relaxed">
              <div className="whitespace-pre-wrap">{streamingText}</div>
              <span className="inline-block w-1 h-4 bg-neon-pink ml-1 animate-pulse align-text-bottom" />
            </div>
          </div>
        )}

        {streaming && !streamingText && (
          <div className="flex gap-3 justify-start">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neon-purple/20 text-sm">
              ✨
            </div>
            <div className="glass border border-white/10 rounded-2xl px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-neon-purple" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Deck extraction banner */}
      {extractedDeck && (
        <div className="mx-4 mb-2 glass border border-neon-green/40 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-neon-green">Deck ready to save</p>
            <p className="text-xs text-white/60 mt-0.5">
              {extractedDeck.deckName} · {extractedDeck.cards.length} cards
            </p>
          </div>
          <button
            onClick={saveDeck}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-neon-green/20 border border-neon-green/40 px-4 py-2 text-sm font-semibold text-neon-green hover:bg-neon-green/30 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save Deck'}
          </button>
        </div>
      )}

      {/* Image previews */}
      {pendingImages.length > 0 && (
        <div className="mx-4 mb-2 glass border border-white/10 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-white/60">{pendingImages.length} screenshot{pendingImages.length > 1 ? 's' : ''} ready to send</p>
            <button onClick={() => setPendingImages([])} className="text-white/40 hover:text-white/80 text-xs">Clear all</button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative shrink-0">
                <img src={img.url} alt={`Preview ${i + 1}`} className="h-16 w-16 rounded-lg object-cover" />
                <button
                  onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white/70 hover:text-white"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="p-4 border-t border-white/10">
        <div className="flex gap-2 items-end glass border border-white/10 rounded-2xl p-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleImageChange}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="relative p-2 rounded-xl text-white/40 hover:text-neon-pink hover:bg-neon-pink/10 transition-colors"
            title="Upload screenshots (up to 10)"
          >
            <ImagePlus className="h-5 w-5" />
            {pendingImages.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-neon-pink text-[9px] font-bold text-white">
                {pendingImages.length}
              </span>
            )}
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about vocabulary, upload a screenshot…"
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-white placeholder-white/30 focus:outline-none max-h-32 py-2"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />

          <button
            onClick={sendMessage}
            disabled={streaming || (!input.trim() && !pendingImages.length)}
            className="p-2 rounded-xl bg-neon-pink/20 border border-neon-pink/30 text-neon-pink hover:bg-neon-pink/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {streaming ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-white/20">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  )
}
