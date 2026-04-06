'use client'

import { useEffect, useMemo, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { getBooks } from '@/data/books'
import { BookListPanel } from '@/components/library/BookListPanel'
import { ChapterListPanel } from '@/components/library/ChapterListPanel'

// ── Types ──────────────────────────────────────────────────────────────────

interface TermAnnotation {
  term: string       // lowercase
  subcategory: string
}

interface Span {
  text: string
  subcategory: string | null
}

// ── Subcategory colours & labels ───────────────────────────────────────────

export const WORD_TYPES: Array<{
  subcategory: string
  label: string
  // Classes applied to highlighted spans
  spanClass: string
  // Classes for the filter toggle button (active state)
  activeClass: string
  // Dot colour for the legend
  dotClass: string
}> = [
  {
    subcategory: 'verbs-subjunctive',
    label: 'Subjunctive',
    spanClass: 'bg-fuchsia-500/25 text-fuchsia-200 rounded px-0.5',
    activeClass: 'bg-fuchsia-500/30 text-fuchsia-200 border-fuchsia-400/60',
    dotClass: 'bg-fuchsia-400',
  },
  {
    subcategory: 'verbs-imperative',
    label: 'Imperative',
    spanClass: 'bg-red-500/25 text-red-200 rounded px-0.5',
    activeClass: 'bg-red-500/30 text-red-200 border-red-400/60',
    dotClass: 'bg-red-400',
  },
  {
    subcategory: 'verbs-conditional',
    label: 'Conditional',
    spanClass: 'bg-violet-500/25 text-violet-200 rounded px-0.5',
    activeClass: 'bg-violet-500/30 text-violet-200 border-violet-400/60',
    dotClass: 'bg-violet-400',
  },
  {
    subcategory: 'verbs-future',
    label: 'Future',
    spanClass: 'bg-purple-500/25 text-purple-200 rounded px-0.5',
    activeClass: 'bg-purple-500/30 text-purple-200 border-purple-400/60',
    dotClass: 'bg-purple-400',
  },
  {
    subcategory: 'verbs-imperfect',
    label: 'Imperfect',
    spanClass: 'bg-orange-500/25 text-orange-200 rounded px-0.5',
    activeClass: 'bg-orange-500/30 text-orange-200 border-orange-400/60',
    dotClass: 'bg-orange-400',
  },
  {
    subcategory: 'verbs-preterite',
    label: 'Preterite',
    spanClass: 'bg-amber-500/25 text-amber-200 rounded px-0.5',
    activeClass: 'bg-amber-500/30 text-amber-200 border-amber-400/60',
    dotClass: 'bg-amber-400',
  },
  {
    subcategory: 'verbs-present',
    label: 'Present',
    spanClass: 'bg-blue-500/25 text-blue-200 rounded px-0.5',
    activeClass: 'bg-blue-500/30 text-blue-200 border-blue-400/60',
    dotClass: 'bg-blue-400',
  },
  {
    subcategory: 'pronoun-composites',
    label: 'Pronouns',
    spanClass: 'bg-yellow-500/25 text-yellow-200 rounded px-0.5',
    activeClass: 'bg-yellow-500/30 text-yellow-200 border-yellow-400/60',
    dotClass: 'bg-yellow-400',
  },
  {
    subcategory: 'adjectives',
    label: 'Adjectives',
    spanClass: 'bg-green-500/25 text-green-200 rounded px-0.5',
    activeClass: 'bg-green-500/30 text-green-200 border-green-400/60',
    dotClass: 'bg-green-400',
  },
  {
    subcategory: 'nouns',
    label: 'Nouns',
    spanClass: 'bg-cyan-500/25 text-cyan-200 rounded px-0.5',
    activeClass: 'bg-cyan-500/30 text-cyan-200 border-cyan-400/60',
    dotClass: 'bg-cyan-400',
  },
  {
    subcategory: 'general',
    label: 'General',
    spanClass: 'bg-slate-500/25 text-slate-200 rounded px-0.5',
    activeClass: 'bg-slate-500/30 text-slate-200 border-slate-400/60',
    dotClass: 'bg-slate-400',
  },
]

// Noun subcategories all map to the "nouns" colour group
const NOUN_SUBCATEGORIES = new Set(['nouns', 'nouns-a1', 'nouns-a2', 'nouns-b1', 'nouns-b2'])

function normaliseSubcategory(subcategory: string): string {
  return NOUN_SUBCATEGORIES.has(subcategory) ? 'nouns' : subcategory
}

function getWordType(subcategory: string) {
  const normalised = normaliseSubcategory(subcategory)
  return WORD_TYPES.find((w) => w.subcategory === normalised) ?? null
}

// ── Text annotation ────────────────────────────────────────────────────────

function isWordChar(c: string): boolean {
  return /[\p{L}\p{N}]/u.test(c)
}

/**
 * Splits the raw text into spans, tagging each match with its subcategory.
 * Only terms whose subcategory is in `activeSubcategories` are highlighted.
 */
function annotateText(
  text: string,
  terms: TermAnnotation[],
  activeSubcategories: Set<string>
): Span[] {
  if (!text) return []

  // Sort longest first so multi-word terms take priority
  const sorted = [...terms]
    .filter((t) => {
      const normalised = normaliseSubcategory(t.subcategory)
      return activeSubcategories.has(normalised)
    })
    .sort((a, b) => b.term.length - a.term.length)

  const textLower = text.toLowerCase()
  const spans: Span[] = []
  let i = 0

  while (i < text.length) {
    let matched = false

    for (const annotation of sorted) {
      const term = annotation.term // already lowercase
      if (!textLower.startsWith(term, i)) continue

      // Word-boundary check
      const before = i > 0 ? text[i - 1] : ''
      const afterIdx = i + term.length
      const after = afterIdx < text.length ? text[afterIdx] : ''

      if ((i === 0 || !isWordChar(before)) && (afterIdx >= text.length || !isWordChar(after))) {
        // Emit the original-cased slice
        spans.push({
          text: text.slice(i, afterIdx),
          subcategory: normaliseSubcategory(annotation.subcategory),
        })
        i = afterIdx
        matched = true
        break
      }
    }

    if (!matched) {
      // Accumulate plain characters
      const last = spans.at(-1)
      if (last && last.subcategory === null) {
        last.text += text[i]
      } else {
        spans.push({ text: text[i], subcategory: null })
      }
      i++
    }
  }

  return spans
}

// ── Chapter text renderer ──────────────────────────────────────────────────

function AnnotatedText({
  text,
  terms,
  activeSubcategories,
}: {
  text: string
  terms: TermAnnotation[]
  activeSubcategories: Set<string>
}) {
  const spans = useMemo(
    () => annotateText(text, terms, activeSubcategories),
    [text, terms, activeSubcategories]
  )

  return (
    <p className="whitespace-pre-wrap leading-8 text-[15px] text-white/85">
      {spans.map((span, idx) => {
        if (span.subcategory === null) {
          return <span key={idx}>{span.text}</span>
        }
        const wordType = getWordType(span.subcategory)
        if (!wordType) return <span key={idx}>{span.text}</span>
        return (
          <mark key={idx} className={`${wordType.spanClass} cursor-default`} title={wordType.label}>
            {span.text}
          </mark>
        )
      })}
    </p>
  )
}

// ── Filter bar ─────────────────────────────────────────────────────────────

function FilterBar({
  presentTypes,
  activeSubcategories,
  onToggle,
  onToggleAll,
}: {
  presentTypes: string[]          // normalised subcategories that appear in this chapter
  activeSubcategories: Set<string>
  onToggle: (sub: string) => void
  onToggleAll: () => void
}) {
  const allActive = presentTypes.every((s) => activeSubcategories.has(s))

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-white/10 bg-brand-surface/40 backdrop-blur sticky top-0 z-10">
      <span className="text-xs font-semibold text-white/40 uppercase tracking-wider mr-1 shrink-0">
        Highlight
      </span>
      <button
        onClick={onToggleAll}
        className={`text-xs font-semibold rounded-full px-3 py-1 border transition-colors shrink-0 ${
          allActive
            ? 'bg-white/15 text-white border-white/30'
            : 'bg-transparent text-white/40 border-white/15 hover:border-white/30 hover:text-white/70'
        }`}
      >
        All
      </button>
      {WORD_TYPES.filter((wt) => presentTypes.includes(wt.subcategory)).map((wt) => {
        const active = activeSubcategories.has(wt.subcategory)
        return (
          <button
            key={wt.subcategory}
            onClick={() => onToggle(wt.subcategory)}
            className={`flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 border transition-colors shrink-0 ${
              active
                ? wt.activeClass
                : 'bg-transparent text-white/40 border-white/15 hover:border-white/30 hover:text-white/70'
            }`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${active ? wt.dotClass : 'bg-white/20'}`} />
            {wt.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Main view ──────────────────────────────────────────────────────────────

function ReaderContent() {
  const { session } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  const selectedBook = searchParams.get('book') ? parseInt(searchParams.get('book')!) : null
  const selectedChapter = searchParams.get('chapter') ? parseInt(searchParams.get('chapter')!) : null

  const books = getBooks()
  const activeBook = books.find((b) => b.bookNumber === selectedBook) ?? null

  const [chapterText, setChapterText] = useState<string>('')
  const [terms, setTerms] = useState<TermAnnotation[]>([])
  const [loading, setLoading] = useState(false)
  const [activeSubcategories, setActiveSubcategories] = useState<Set<string>>(
    new Set(WORD_TYPES.map((w) => w.subcategory))
  )

  const selectBook = (bookNumber: number) => {
    router.push(`/reader?book=${bookNumber}`)
  }

  const selectChapter = (chapterNumber: number) => {
    router.push(`/reader?book=${selectedBook}&chapter=${chapterNumber}`)
  }

  // Load chapter text + annotations when book+chapter change
  useEffect(() => {
    if (!session || !selectedBook || !selectedChapter) return
    setLoading(true)
    setChapterText('')
    setTerms([])

    fetch(`/api/reader?book=${selectedBook}&chapter=${selectedChapter}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setChapterText(data.text ?? '')
        setTerms(data.terms ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [session, selectedBook, selectedChapter])

  // Which subcategory types actually appear in this chapter's vocab
  const presentTypes = useMemo(() => {
    const set = new Set<string>()
    for (const t of terms) {
      set.add(normaliseSubcategory(t.subcategory))
    }
    return WORD_TYPES.map((w) => w.subcategory).filter((s) => set.has(s))
  }, [terms])

  const handleToggle = useCallback((sub: string) => {
    setActiveSubcategories((prev) => {
      const next = new Set(prev)
      if (next.has(sub)) {
        next.delete(sub)
      } else {
        next.add(sub)
      }
      return next
    })
  }, [])

  const handleToggleAll = useCallback(() => {
    setActiveSubcategories((prev) => {
      const allPresent = presentTypes.every((s) => prev.has(s))
      if (allPresent) {
        // Deselect all
        return new Set()
      } else {
        // Select all present
        return new Set(presentTypes)
      }
    })
  }, [presentTypes])

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      {/* ── Book panel ────────────────────────────────────────── */}
      <BookListPanel books={books} selectedBook={selectedBook} onSelect={selectBook} />

      {/* ── Chapter panel ─────────────────────────────────────── */}
      {activeBook && (
        <ChapterListPanel
          book={activeBook}
          selectedChapter={selectedChapter}
          onSelect={selectChapter}
        />
      )}

      {/* ── Text panel ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedBook && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-white/30 text-sm">Select a book to start reading</p>
          </div>
        )}

        {selectedBook && !selectedChapter && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-white/30 text-sm">Select a chapter</p>
          </div>
        )}

        {selectedBook && selectedChapter && (
          <>
            {/* Filter bar (sticky within this panel) */}
            {!loading && chapterText && (
              <FilterBar
                presentTypes={presentTypes}
                activeSubcategories={activeSubcategories}
                onToggle={handleToggle}
                onToggleAll={handleToggleAll}
              />
            )}

            {/* Scrollable text area */}
            <div className="flex-1 overflow-y-auto px-6 py-6 md:px-10 md:py-8">
              {loading && (
                <p className="text-white/40 text-sm animate-pulse">Loading chapter…</p>
              )}

              {!loading && !chapterText && (
                <div className="text-center mt-20">
                  <p className="text-white/30 text-sm">No text loaded for this chapter yet.</p>
                </div>
              )}

              {!loading && chapterText && (
                <div className="max-w-2xl mx-auto space-y-4">
                  {/* Word count + annotation info */}
                  <div className="flex items-center gap-4 mb-6 text-xs text-white/30">
                    <span>{terms.length} vocabulary terms annotated</span>
                    {activeSubcategories.size === 0 && (
                      <span className="text-amber-400/70">No filters active — all text plain</span>
                    )}
                  </div>

                  {chapterText.split(/\n\n+/).map((paragraph, pIdx) => (
                    <AnnotatedText
                      key={pIdx}
                      text={paragraph}
                      terms={terms}
                      activeSubcategories={activeSubcategories}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function ReaderView() {
  return (
    <Suspense fallback={
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-white/30 text-sm animate-pulse">Loading…</p>
      </div>
    }>
      <ReaderContent />
    </Suspense>
  )
}
