'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { getBooks } from '@/data/books'
import { BookListPanel } from '@/components/library/BookListPanel'
import { ChapterListPanel } from '@/components/library/ChapterListPanel'
import { ChapterDecksPanel } from '@/components/library/ChapterDecksPanel'
import { TypeBrowseView } from '@/components/library/TypeBrowseView'

function LibraryContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { session } = useAuth()

  const view = searchParams.get('view') ?? 'chapter'
  const selectedBook = searchParams.get('book') ? parseInt(searchParams.get('book')!) : null
  const selectedChapter = searchParams.get('chapter') ? parseInt(searchParams.get('chapter')!) : null

  const books = getBooks()
  const activeBook = books.find((b) => b.bookNumber === selectedBook) ?? null

  // ── Quote of the day ───────────────────────────────────────
  const [quote, setQuote] = useState<{ quote: string; bookNumber: number; chapterNumber: number } | null>(null)

  useEffect(() => {
    fetch('/api/quote-of-day')
      .then((r) => r.json())
      .then((data) => { if (data.quote) setQuote(data) })
      .catch(() => {})
  }, [])

  // ── Nemesis cards ──────────────────────────────────────────
  type NemesisCard = { vocab_term_id: string; spanish_term: string; english_answer: string; wrong_count: number; total_reviews: number }
  const [nemesisCards, setNemesisCards] = useState<NemesisCard[]>([])
  const [nemesisOpen, setNemesisOpen] = useState(true)

  useEffect(() => {
    if (!session?.access_token) return
    fetch('/api/nemesis-cards', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => { if (data.cards?.length >= 3) setNemesisCards(data.cards) })
      .catch(() => {})
  }, [session])

  const selectBook = (bookNumber: number) => {
    router.push(`/decks?view=chapter&book=${bookNumber}`)
  }

  const selectChapter = (chapterNumber: number) => {
    router.push(`/decks?view=chapter&book=${selectedBook}&chapter=${chapterNumber}`)
  }

  const setView = (v: string) => router.push(`/decks?view=${v}`)

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* ── Narnia quote of the day ───────────────────────────── */}
      {quote && (
        <div className="shrink-0 glass mx-4 mt-3 mb-1 rounded-xl px-4 py-3 flex items-start gap-3 border border-white/10">
          <span className="text-lg shrink-0 mt-0.5">📖</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white/50 italic leading-relaxed line-clamp-3">
              &ldquo;{quote.quote}&rdquo;
            </p>
            <p className="text-[10px] text-white/25 mt-1">
              Book {quote.bookNumber} · Chapter {quote.chapterNumber}
            </p>
          </div>
        </div>
      )}

      {/* ── Nemesis words ─────────────────────────────────────── */}
      {nemesisCards.length >= 3 && (
        <div className="shrink-0 mx-4 mt-1 mb-1">
          <button
            onClick={() => setNemesisOpen((o) => !o)}
            className="flex items-center gap-2 text-xs font-semibold text-neon-pink/80 hover:text-neon-pink transition-colors w-full py-1.5"
          >
            <span>🗡️ Nemesis Words</span>
            <span className="text-white/25 font-normal">{nemesisOpen ? '▲' : '▼'}</span>
          </button>
          {nemesisOpen && (
            <div className="glass rounded-xl overflow-hidden border border-neon-pink/15">
              {nemesisCards.map((c, i) => (
                <div
                  key={c.vocab_term_id}
                  className={`flex items-center gap-3 px-4 py-2.5 ${i < nemesisCards.length - 1 ? 'border-b border-white/5' : ''}`}
                >
                  <span className="text-sm font-semibold text-white flex-1 truncate">{c.spanish_term}</span>
                  <span className="text-xs text-white/40 flex-1 truncate">{c.english_answer}</span>
                  <span className="text-[10px] shrink-0 px-2 py-0.5 rounded-full bg-neon-pink/15 text-neon-pink font-semibold">
                    ✗ {c.wrong_count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab bar ──────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center gap-1 px-4 py-3 border-b border-white/10 bg-brand-surface/60 backdrop-blur">
        <h1 className="text-sm font-bold text-neon-pink text-glow-pink mr-4">My Decks</h1>
        <div className="flex rounded-lg border border-white/15 overflow-hidden text-xs font-semibold">
          <button
            onClick={() => setView('chapter')}
            className={`px-3 py-1.5 transition-colors ${
              view !== 'type'
                ? 'bg-neon-purple text-white'
                : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            By Chapter
          </button>
          <button
            onClick={() => setView('type')}
            className={`px-3 py-1.5 transition-colors border-l border-white/15 ${
              view === 'type'
                ? 'bg-neon-purple text-white'
                : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            By Type
          </button>
        </div>
      </header>

      {/* ── Mobile back strip — flows below the tab bar, not absolutely positioned ── */}
      {selectedChapter && (
        <div className="md:hidden shrink-0 flex gap-2 px-4 py-2 bg-brand-bg/80 backdrop-blur border-b border-white/10">
          <button
            onClick={() => router.push(`/decks?view=chapter&book=${selectedBook}`)}
            className="text-xs text-white/50 hover:text-white flex items-center gap-1"
          >
            ← Chapters
          </button>
        </div>
      )}

      {/* ── Main area ────────────────────────────────────────── */}
      {view === 'type' ? (
        <div className="flex flex-1 overflow-hidden">
          <TypeBrowseView />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Panel 1 — Books (hidden on mobile when deeper panel is active) */}
          <div className={`${selectedBook && selectedChapter ? 'hidden md:flex' : selectedBook ? 'hidden md:flex' : 'flex'}`}>
            <BookListPanel books={books} selectedBook={selectedBook} onSelect={selectBook} />
          </div>

          {/* Panel 2 — Chapters (hidden on mobile when deck panel is active) */}
          {activeBook && (
            <div className={`${selectedChapter ? 'hidden md:flex' : 'flex'}`}>
              <ChapterListPanel
                book={activeBook}
                selectedChapter={selectedChapter}
                onSelect={selectChapter}
              />
            </div>
          )}

          {/* Panel 3 — Decks for selected chapter */}
          {selectedBook && selectedChapter ? (
            <ChapterDecksPanel bookNumber={selectedBook} chapterNumber={selectedChapter} />
          ) : (
            <div className="flex-1 hidden md:flex items-center justify-center">
              <div className="text-center text-white/30">
                <p className="text-4xl mb-4">📚</p>
                <p className="text-sm">
                  {selectedBook ? 'Select a chapter' : 'Select a book to begin'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function DeckLibraryView() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-white/40 animate-pulse text-sm">Loading library…</div>
        </div>
      }
    >
      <LibraryContent />
    </Suspense>
  )
}
