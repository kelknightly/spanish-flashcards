'use client'

'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getBooks } from '@/data/books'
import { BookListPanel } from '@/components/library/BookListPanel'
import { ChapterListPanel } from '@/components/library/ChapterListPanel'
import { ChapterDecksPanel } from '@/components/library/ChapterDecksPanel'
import { TypeBrowseView } from '@/components/library/TypeBrowseView'

function LibraryContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const view = searchParams.get('view') ?? 'chapter'
  const selectedBook = searchParams.get('book') ? parseInt(searchParams.get('book')!) : null
  const selectedChapter = searchParams.get('chapter') ? parseInt(searchParams.get('chapter')!) : null

  const books = getBooks()
  const activeBook = books.find((b) => b.bookNumber === selectedBook) ?? null

  const selectBook = (bookNumber: number) => {
    router.push(`/decks?view=chapter&book=${bookNumber}`)
  }

  const selectChapter = (chapterNumber: number) => {
    router.push(`/decks?view=chapter&book=${selectedBook}&chapter=${chapterNumber}`)
  }

  const setView = (v: string) => router.push(`/decks?view=${v}`)

  return (
    <div className="flex flex-col h-screen overflow-hidden">
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

          {/* Mobile back button strip when in deep panel */}
          {selectedChapter && (
            <div className="md:hidden absolute top-14 left-0 right-0 z-10 flex gap-2 px-4 py-2 bg-brand-bg/80 backdrop-blur border-b border-white/10">
              <button
                onClick={() => router.push(`/decks?view=chapter&book=${selectedBook}`)}
                className="text-xs text-white/50 hover:text-white flex items-center gap-1"
              >
                ← Chapters
              </button>
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
