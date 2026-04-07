'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { DECK_TYPES } from '@/data/books'

interface WordAddPopoverProps {
  selectedText: string
  translation: string | null
  subcategory: string | null
  paragraph: string
  bookNumber: number | null
  chapterNumber: number | null
  anchor: { x: number; y: number }
  onClose: () => void
}

interface DeckInfo {
  id: string
  name: string
  book_number: number | null
  chapter_number: number | null
  subcategory: string | null
  card_count: number
  mastered_count: number
}

const POPOVER_W = 320
const POPOVER_H = 480

export function WordAddPopover({
  selectedText,
  translation,
  subcategory,
  paragraph,
  bookNumber,
  chapterNumber,
  anchor,
  onClose,
}: WordAddPopoverProps) {
  const { session } = useAuth()
  const [tab, setTab] = useState<'new' | 'existing'>('new')
  const [success, setSuccess] = useState<string | null>(null)

  // New deck form
  const [deckName, setDeckName] = useState('')
  const [english, setEnglish] = useState(translation ?? '')
  const [deckSubcategory, setDeckSubcategory] = useState(subcategory ?? '')
  const [associateBook, setAssociateBook] = useState(bookNumber !== null)
  const [associateChapter, setAssociateChapter] = useState(chapterNumber !== null)

  // Existing deck form
  const [decks, setDecks] = useState<DeckInfo[]>([])
  const [decksLoading, setDecksLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null)
  const [existingEnglish, setExistingEnglish] = useState(translation ?? '')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load decks when the Existing tab is first opened
  useEffect(() => {
    if (tab !== 'existing' || !session || decks.length > 0) return
    setDecksLoading(true)
    fetch('/api/decks', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setDecks(data.decks ?? [])
        setDecksLoading(false)
      })
      .catch(() => setDecksLoading(false))
  }, [tab, session, decks.length])

  // Auto-close after success
  useEffect(() => {
    if (!success) return
    const t = setTimeout(onClose, 1600)
    return () => clearTimeout(t)
  }, [success, onClose])

  const handleNewDeck = useCallback(async () => {
    if (!deckName.trim() || !english.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const deckRes = await fetch('/api/decks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          deckName: deckName.trim(),
          bookNumber: associateBook && bookNumber ? bookNumber : undefined,
          chapterNumber: associateBook && associateChapter && chapterNumber ? chapterNumber : undefined,
          subcategory: deckSubcategory || undefined,
          cards: [{
            spanish: selectedText,
            english: english.trim(),
            sourceSentences: paragraph ? [{ es: paragraph, en: '' }] : [],
          }],
          isCustom: true,
        }),
      })
      if (!deckRes.ok) {
        const d = await deckRes.json()
        setError(d.error ?? 'Failed to create deck')
        return
      }
      setSuccess(`Added to "${deckName.trim()}"`)
    } catch {
      setError('Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }, [deckName, english, deckSubcategory, associateBook, associateChapter, bookNumber, chapterNumber, selectedText, paragraph, session, submitting])

  const handleExistingDeck = useCallback(async () => {
    if (!selectedDeckId || !existingEnglish.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/decks/${selectedDeckId}/cards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          spanish: selectedText,
          english: existingEnglish.trim(),
          sourceSentences: paragraph ? [{ es: paragraph, en: '' }] : [],
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Failed to add card')
        return
      }
      const deck = decks.find((d) => d.id === selectedDeckId)
      setSuccess(`Added to "${deck?.name ?? 'deck'}"`)
    } catch {
      setError('Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }, [selectedDeckId, existingEnglish, selectedText, paragraph, session, decks, submitting])

  const filteredDecks = decks.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase())
  )

  // Clamp popover position to viewport
  const vw = typeof window !== 'undefined' ? window.innerWidth : 800
  const vh = typeof window !== 'undefined' ? window.innerHeight : 600
  const left = Math.max(8, Math.min(anchor.x, vw - POPOVER_W - 8))
  const top = Math.max(8, Math.min(anchor.y + 12, vh - POPOVER_H - 8))

  return (
    <>
      {/* Backdrop — captures clicks outside the popover */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Popover panel */}
      <div
        className="fixed z-50 rounded-xl bg-brand-surface border border-white/15 shadow-2xl overflow-hidden flex flex-col"
        style={{ top, left, width: POPOVER_W, maxHeight: POPOVER_H }}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-white/10 shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-white leading-snug truncate">{selectedText}</p>
              {subcategory && (
                <p className="text-[11px] text-white/40 mt-0.5 capitalize">
                  {subcategory.replace(/-/g, ' ')}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white transition-colors text-xl leading-none shrink-0 -mt-0.5"
            >
              ×
            </button>
          </div>
        </div>

        {success ? (
          <div className="px-4 py-8 text-center">
            <p className="text-neon-green text-sm font-semibold">✓ {success}</p>
          </div>
        ) : (
          <>
            {/* Tab bar */}
            <div className="flex border-b border-white/10 text-xs font-semibold shrink-0">
              <button
                onClick={() => { setTab('new'); setError(null) }}
                className={`flex-1 px-3 py-2.5 transition-colors ${
                  tab === 'new'
                    ? 'bg-neon-purple/20 text-neon-purple border-b-2 border-neon-purple'
                    : 'text-white/40 hover:text-white hover:bg-white/5'
                }`}
              >
                New Deck
              </button>
              <button
                onClick={() => { setTab('existing'); setError(null) }}
                className={`flex-1 px-3 py-2.5 transition-colors border-l border-white/10 ${
                  tab === 'existing'
                    ? 'bg-neon-purple/20 text-neon-purple border-b-2 border-neon-purple'
                    : 'text-white/40 hover:text-white hover:bg-white/5'
                }`}
              >
                Existing Deck
              </button>
            </div>

            {/* Tab content */}
            <div className="overflow-y-auto flex-1">
              {tab === 'new' ? (
                <div className="p-4 space-y-3">
                  {/* Deck name */}
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Deck name *</label>
                    <input
                      type="text"
                      value={deckName}
                      onChange={(e) => setDeckName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleNewDeck()}
                      placeholder="My custom deck"
                      className="w-full text-sm bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-white placeholder:text-white/25 focus:outline-none focus:border-neon-purple/50 transition-colors"
                      autoFocus
                    />
                  </div>

                  {/* English answer */}
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">English answer *</label>
                    <input
                      type="text"
                      value={english}
                      onChange={(e) => setEnglish(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleNewDeck()}
                      placeholder="Translation…"
                      className="w-full text-sm bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-white placeholder:text-white/25 focus:outline-none focus:border-neon-purple/50 transition-colors"
                    />
                  </div>

                  {/* Type / subcategory */}
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Type</label>
                    <select
                      value={deckSubcategory}
                      onChange={(e) => setDeckSubcategory(e.target.value)}
                      className="w-full text-sm bg-brand-bg border border-white/15 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-neon-purple/50 transition-colors"
                    >
                      <option value="">None (General)</option>
                      {DECK_TYPES.filter((t) => t.subcategory !== 'general').map((t) => (
                        <option key={t.subcategory} value={t.subcategory}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Book / Chapter association */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={associateBook}
                        onChange={(e) => {
                          setAssociateBook(e.target.checked)
                          if (!e.target.checked) setAssociateChapter(false)
                        }}
                        disabled={!bookNumber}
                        className="accent-neon-purple"
                      />
                      <span className={`text-xs ${bookNumber ? 'text-white/70' : 'text-white/25'}`}>
                        Associate with Book {bookNumber ?? '—'}
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={associateChapter}
                        onChange={(e) => setAssociateChapter(e.target.checked)}
                        disabled={!associateBook || !chapterNumber}
                        className="accent-neon-purple"
                      />
                      <span className={`text-xs ${associateBook && chapterNumber ? 'text-white/70' : 'text-white/25'}`}>
                        Associate with Chapter {chapterNumber ?? '—'}
                      </span>
                    </label>
                  </div>

                  {error && <p className="text-red-400 text-xs">{error}</p>}

                  <button
                    onClick={handleNewDeck}
                    disabled={!deckName.trim() || !english.trim() || submitting}
                    className="w-full py-2 rounded-lg bg-neon-purple text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
                  >
                    {submitting ? 'Creating…' : 'Create & Add Card'}
                  </button>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {/* Search */}
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search decks…"
                    className="w-full text-sm bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-white placeholder:text-white/25 focus:outline-none focus:border-neon-purple/50 transition-colors"
                    autoFocus
                  />

                  {/* Deck list */}
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5">
                    {decksLoading ? (
                      <p className="px-3 py-3 text-xs text-white/40 animate-pulse">Loading decks…</p>
                    ) : filteredDecks.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-white/30 italic">No decks found</p>
                    ) : (
                      filteredDecks.map((deck) => {
                        const isSelected = deck.id === selectedDeckId
                        const pct = deck.card_count
                          ? Math.round((deck.mastered_count / deck.card_count) * 100)
                          : 0
                        const location = deck.book_number
                          ? `Bk ${deck.book_number}${deck.chapter_number ? ` · Ch ${deck.chapter_number}` : ''}`
                          : 'General'
                        return (
                          <button
                            key={deck.id}
                            onClick={() => setSelectedDeckId(deck.id)}
                            className={`w-full text-left px-3 py-2.5 transition-colors ${
                              isSelected ? 'bg-neon-purple/20' : 'hover:bg-white/5'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-xs font-medium text-white truncate flex-1">
                                {deck.name}
                              </span>
                              <span className="text-[10px] text-white/30 shrink-0">{location}</span>
                            </div>
                            <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                              <div
                                className="h-full bg-neon-green"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>

                  {/* English answer */}
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">English answer *</label>
                    <input
                      type="text"
                      value={existingEnglish}
                      onChange={(e) => setExistingEnglish(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleExistingDeck()}
                      placeholder="Translation…"
                      className="w-full text-sm bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-white placeholder:text-white/25 focus:outline-none focus:border-neon-purple/50 transition-colors"
                    />
                  </div>

                  {error && <p className="text-red-400 text-xs">{error}</p>}

                  <button
                    onClick={handleExistingDeck}
                    disabled={!selectedDeckId || !existingEnglish.trim() || submitting}
                    className="w-full py-2 rounded-lg bg-neon-purple text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
                  >
                    {submitting ? 'Adding…' : 'Add Card to Deck'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
