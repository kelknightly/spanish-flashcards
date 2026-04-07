'use client'

import { useEffect, useMemo, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { getBooks } from '@/data/books'
import { BookListPanel } from '@/components/library/BookListPanel'
import { ChapterListPanel } from '@/components/library/ChapterListPanel'
import { WordAddPopover } from '@/components/WordAddPopover'
import { ConjugationPanel } from '@/components/ConjugationPanel'

// ── Types ──────────────────────────────────────────────────────────────────

interface VerbForm {
  form: string        // lowercase surface form
  translation: string // e.g. "Future: he/she/it will have"
}

interface TermAnnotation {
  term: string       // lowercase
  subcategory: string
  translation?: string
}

interface Span {
  text: string
  subcategory: string | null
  translation?: string
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
    subcategory: 'verbs-perfect',
    label: 'Present Perfect',
    spanClass: 'bg-emerald-500/25 text-emerald-200 rounded px-0.5',
    activeClass: 'bg-emerald-500/30 text-emerald-200 border-emerald-400/60',
    dotClass: 'bg-emerald-400',
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
  {
    subcategory: 'verb-search',
    label: 'Verb Search',
    spanClass: 'bg-teal-400/30 text-teal-200 rounded px-0.5',
    activeClass: 'bg-teal-400/30 text-teal-200 border-teal-400/60',
    dotClass: 'bg-teal-400',
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
 * Verb search forms (verbForms) are prepended at highest priority and always highlighted.
 */
function annotateText(
  text: string,
  terms: TermAnnotation[],
  activeSubcategories: Set<string>,
  verbForms: VerbForm[] = []
): Span[] {
  if (!text) return []

  // Verb search forms get highest priority — prepend them as special annotations
  const verbAnnotations: TermAnnotation[] = verbForms.map((vf) => ({
    term: vf.form,
    subcategory: 'verb-search',
    translation: vf.translation,
  }))

  // Sort longest first so multi-word terms take priority
  const sorted = [
    ...verbAnnotations.sort((a, b) => b.term.length - a.term.length),
    ...[...terms]
      .filter((t) => {
        const normalised = normaliseSubcategory(t.subcategory)
        return activeSubcategories.has(normalised)
      })
      .sort((a, b) => b.term.length - a.term.length),
  ]

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
          translation: annotation.translation,
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

/**
 * Splits already-annotated spans further to highlight plain text search matches.
 */
function applySearchHighlight(spans: Span[], query: string): Span[] {
  if (!query) return spans
  const lowerQuery = query.toLowerCase()
  const result: Span[] = []

  for (const span of spans) {
    const lowerText = span.text.toLowerCase()
    let i = 0
    while (i < span.text.length) {
      const idx = lowerText.indexOf(lowerQuery, i)
      if (idx === -1) {
        const remaining = span.text.slice(i)
        if (remaining) result.push({ text: remaining, subcategory: span.subcategory, translation: span.translation })
        break
      }
      if (idx > i) {
        result.push({ text: span.text.slice(i, idx), subcategory: span.subcategory, translation: span.translation })
      }
      result.push({ text: span.text.slice(idx, idx + lowerQuery.length), subcategory: 'text-search' })
      i = idx + lowerQuery.length
    }
  }

  return result
}

// ── Chapter text renderer ──────────────────────────────────────────────────

function AnnotatedText({
  text,
  terms,
  activeSubcategories,
  verbForms,
  searchQuery,
  onWordSelect,
}: {
  text: string
  terms: TermAnnotation[]
  activeSubcategories: Set<string>
  verbForms: VerbForm[]
  searchQuery?: string
  onWordSelect?: (selectedText: string, translation: string | null, subcategory: string | null, paragraph: string, anchor: { x: number; y: number }) => void
}) {
  const spans = useMemo(() => {
    const annotated = annotateText(text, terms, activeSubcategories, verbForms)
    return searchQuery ? applySearchHighlight(annotated, searchQuery) : annotated
  }, [text, terms, activeSubcategories, verbForms, searchQuery])

  const handleClick = useCallback((event: React.MouseEvent<HTMLParagraphElement>) => {
    if (!onWordSelect) return

    // Prefer an active text selection (drag or double-click)
    const selection = window.getSelection()
    const selText = selection?.toString().trim() ?? ''
    if (selText.length > 0) {
      // Don't clear the selection — let the user copy it normally (Ctrl+C)
      onWordSelect(selText, null, null, text, { x: event.clientX, y: event.clientY })
      return
    }

    // Fall back to a single click on an annotated <mark>
    const target = event.target as HTMLElement
    if (target.tagName === 'MARK') {
      const wordText = target.textContent?.trim() ?? ''
      if (!wordText) return
      const wordSubcategory = target.dataset.subcategory ?? null
      const wordTranslation = target.dataset.translation ?? null
      onWordSelect(wordText, wordTranslation, wordSubcategory, text, { x: event.clientX, y: event.clientY })
    }
  }, [onWordSelect, text])

  return (
    <p
      className="whitespace-pre-wrap leading-8 text-base md:text-[15px] text-white/85"
      onClick={onWordSelect ? handleClick : undefined}
    >
      {spans.map((span, idx) => {
        if (span.subcategory === null) {
          return <span key={idx}>{span.text}</span>
        }
        if (span.subcategory === 'text-search') {
          return <mark key={idx} className="bg-yellow-400/50 text-yellow-100 rounded px-0.5">{span.text}</mark>
        }
        const wordType = getWordType(span.subcategory)
        if (!wordType) return <span key={idx}>{span.text}</span>
        return (
          <mark
            key={idx}
            className={`${wordType.spanClass} cursor-pointer`}
            data-subcategory={span.subcategory}
            data-translation={span.translation ?? undefined}
            title={span.translation ?? wordType.label}
          >
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
  verbSearch,
  onVerbSearchChange,
  onVerbSearchSubmit,
  isConjugating,
  verbInfinitive,
  onVerbSearchClear,
  textSearch,
  onTextSearchChange,
  textSearchMatchCount,
  readerMode,
  onReaderModeChange,
}: {
  presentTypes: string[]          // normalised subcategories that appear in this chapter
  activeSubcategories: Set<string>
  onToggle: (sub: string) => void
  onToggleAll: () => void
  verbSearch: string
  onVerbSearchChange: (value: string) => void
  onVerbSearchSubmit: () => void
  isConjugating: boolean
  verbInfinitive: string | null
  onVerbSearchClear: () => void
  textSearch: string
  onTextSearchChange: (value: string) => void
  textSearchMatchCount: number
  readerMode: 'read' | 'build'
  onReaderModeChange: (mode: 'read' | 'build') => void
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

      {/* Mode toggle */}
      <div className="flex items-center rounded-full border border-white/15 overflow-hidden shrink-0">
        <button
          onClick={() => onReaderModeChange('read')}
          className={`text-xs font-semibold px-3 py-1 transition-colors ${
            readerMode === 'read'
              ? 'bg-white/15 text-white'
              : 'bg-transparent text-white/40 hover:text-white/70'
          }`}
        >
          📖 Read
        </button>
        <button
          onClick={() => onReaderModeChange('build')}
          className={`text-xs font-semibold px-3 py-1 border-l border-white/15 transition-colors ${
            readerMode === 'build'
              ? 'bg-white/15 text-white'
              : 'bg-transparent text-white/40 hover:text-white/70'
          }`}
        >
          🗂 Build
        </button>
      </div>

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

      {/* Text search */}
      <div className="flex items-center gap-1 ml-auto shrink-0">
        <input
          type="text"
          value={textSearch}
          onChange={(e) => onTextSearchChange(e.target.value)}
          placeholder="Find in chapter…"
          className="text-xs bg-white/5 border border-white/15 rounded-full px-3 py-1 text-white/70 placeholder:text-white/25 focus:outline-none focus:border-yellow-400/50 focus:text-white transition-colors w-36"
        />
        {textSearch && (
          <span className="text-xs text-white/35 shrink-0">
            {textSearchMatchCount} {textSearchMatchCount === 1 ? 'match' : 'matches'}
          </span>
        )}
        {textSearch && (
          <button
            onClick={() => onTextSearchChange('')}
            aria-label="Clear text search"
            className="text-white/40 hover:text-white transition-colors leading-none"
          >
            ×
          </button>
        )}
      </div>

      {/* Verb search input */}
      <div className="flex items-center gap-1.5 shrink-0">
        {verbInfinitive ? (
          <span className="flex items-center gap-1 text-xs font-semibold rounded-full px-3 py-1 border bg-teal-400/20 text-teal-200 border-teal-400/50">
            {verbInfinitive}
            <button
              onClick={onVerbSearchClear}
              aria-label="Clear verb search"
              className="ml-1 text-teal-300/70 hover:text-teal-100 transition-colors"
            >
              ×
            </button>
          </span>
        ) : (
          <input
            type="text"
            value={verbSearch}
            onChange={(e) => onVerbSearchChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isConjugating && verbSearch.trim() && onVerbSearchSubmit()}
            placeholder="Search verb…"
            className="text-xs bg-white/5 border border-white/15 rounded-full px-3 py-1 text-white/70 placeholder:text-white/25 focus:outline-none focus:border-teal-400/50 focus:text-white transition-colors w-32"
          />
        )}
        {isConjugating && (
          <span className="text-teal-400/70 text-xs animate-pulse">looking up…</span>
        )}
        {!verbInfinitive && !isConjugating && verbSearch.trim() && (
          <button
            onClick={onVerbSearchSubmit}
            className="text-xs font-semibold rounded-full px-3 py-1 border bg-teal-500/20 text-teal-200 border-teal-400/50 hover:bg-teal-500/30 transition-colors shrink-0"
          >
            Search
          </button>
        )}
      </div>
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

  // Text search state
  const [textSearch, setTextSearch] = useState('')

  // Verb search state — persists across chapter/book changes and navigation away
  const [verbSearchInput, setVerbSearchInput] = useState('')
  const [verbForms, setVerbForms] = useState<VerbForm[]>([])
  const [verbInfinitive, setVerbInfinitive] = useState<string | null>(null)
  const [isConjugating, setIsConjugating] = useState(false)

  // Reader mode: 'read' = conjugation panel on verb click, 'build' = word-add popover
  const [readerMode, setReaderMode] = useState<'read' | 'build'>('read')

  // Conjugation panel state
  const [conjPanelWord, setConjPanelWord] = useState<{ surfaceForm: string; subcategory: string } | null>(null)

  // Word-add popover state
  type WordPopover = {
    text: string
    translation: string | null
    subcategory: string | null
    paragraph: string
    anchor: { x: number; y: number }
  }
  const [wordPopover, setWordPopover] = useState<WordPopover | null>(null)

  const handleWordSelect = useCallback((
    text: string,
    translation: string | null,
    subcategory: string | null,
    paragraph: string,
    anchor: { x: number; y: number }
  ) => {
    if (readerMode === 'read') {
      // In read mode, verb clicks open the conjugation panel; other clicks do nothing
      if (subcategory?.startsWith('verbs') || subcategory === 'verb-search') {
        setConjPanelWord({ surfaceForm: text, subcategory })
      }
    } else {
      // In build mode, all clicks open the word-add popover (existing behaviour)
      setWordPopover({ text, translation, subcategory, paragraph, anchor })
    }
  }, [readerMode])

  // Restore verb search from localStorage on mount (survives navigating away and back)
  useEffect(() => {
    try {
      const storedInfinitive = localStorage.getItem('reader-verb-infinitive')
      const storedForms = localStorage.getItem('reader-verb-forms')
      if (storedInfinitive && storedForms) {
        const parsed = JSON.parse(storedForms) as unknown[]
        // Guard against old string[] format in localStorage
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
          setVerbInfinitive(storedInfinitive)
          setVerbForms(parsed as VerbForm[])
        } else {
          localStorage.removeItem('reader-verb-infinitive')
          localStorage.removeItem('reader-verb-forms')
        }
      }
    } catch { /* ignore */ }
  }, [])

  // Sync verb search to localStorage whenever it changes
  useEffect(() => {
    try {
      if (verbInfinitive && verbForms.length > 0) {
        localStorage.setItem('reader-verb-infinitive', verbInfinitive)
        localStorage.setItem('reader-verb-forms', JSON.stringify(verbForms))
      } else {
        localStorage.removeItem('reader-verb-infinitive')
        localStorage.removeItem('reader-verb-forms')
      }
    } catch { /* ignore */ }
  }, [verbInfinitive, verbForms])

  // Mobile: which step of the drill-down are we on?
  // 'books' | 'chapters' | 'text'
  const mobileStep = !selectedBook ? 'books' : !selectedChapter ? 'chapters' : 'text'

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

  // Count text search matches in the chapter
  const textSearchMatchCount = useMemo(() => {
    if (!textSearch || !chapterText) return 0
    const q = textSearch.toLowerCase()
    let count = 0
    let idx = 0
    const lower = chapterText.toLowerCase()
    while ((idx = lower.indexOf(q, idx)) !== -1) {
      count++
      idx += q.length
    }
    return count
  }, [textSearch, chapterText])

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
        return new Set()
      } else {
        return new Set(presentTypes)
      }
    })
  }, [presentTypes])

  const handleVerbSearchSubmit = useCallback(async () => {
    const infinitive = verbSearchInput.trim().toLowerCase()
    if (!infinitive || isConjugating) return
    setIsConjugating(true)
    try {
      const res = await fetch('/api/conjugate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ infinitive }),
      })
      if (res.ok) {
        const data = await res.json() as { forms: VerbForm[]; infinitive: string }
        setVerbForms(data.forms)
        setVerbInfinitive(data.infinitive)
        setVerbSearchInput('')
      }
    } finally {
      setIsConjugating(false)
    }
  }, [verbSearchInput, isConjugating, session])

  const handleVerbSearchClear = useCallback(() => {
    setVerbForms([] as VerbForm[])
    setVerbInfinitive(null)
    setVerbSearchInput('')
  }, [])

  // ── Mobile layout ──────────────────────────────────────────────────────
  // Renders as a drill-down: Books → Chapters → Text
  // Each step fills the full screen; back button returns to previous step.

  const mobileHeader = (title: string, backHref?: string) => (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-brand-surface/60 backdrop-blur shrink-0">
      {backHref && (
        <button
          onClick={() => router.push(backHref)}
          className="text-white/50 hover:text-white transition-colors p-1 -ml-1"
          aria-label="Go back"
        >
          ←
        </button>
      )}
      <span className="text-sm font-semibold text-white/80 truncate">{title}</span>
    </div>
  )

  // ── Mobile: Books step ─────────────────────────────────────────────────
  const mobileBooksView = (
    <div className="flex flex-col h-[calc(100vh-56px)] md:hidden">
      {mobileHeader('Reader — Choose a Book')}
      <ul className="flex-1 overflow-y-auto py-2">
        {books.map((book) => (
          <li key={book.bookNumber}>
            <button
              onClick={() => selectBook(book.bookNumber)}
              className="w-full text-left px-5 py-4 border-b border-white/5 hover:bg-white/5 transition-colors active:bg-white/10"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-0.5">
                Book {book.bookNumber}
              </p>
              <p className="text-base font-medium text-white leading-snug">{book.titleEs}</p>
              <p className="text-xs text-white/30 mt-0.5">{book.chapters.length} chapters</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )

  // ── Mobile: Chapters step ──────────────────────────────────────────────
  const mobileChaptersView = activeBook ? (
    <div className="flex flex-col h-[calc(100vh-56px)] md:hidden">
      {mobileHeader(activeBook.titleEs, '/reader')}
      <ul className="flex-1 overflow-y-auto py-2">
        {activeBook.chapters.map((chapter) => {
          const hasText = !!chapter.hasText
          return (
            <li key={chapter.number}>
              <button
                onClick={() => hasText && selectChapter(chapter.number)}
                disabled={!hasText}
                className={`w-full text-left px-5 py-3.5 border-b border-white/5 transition-colors flex items-center gap-3 ${
                  hasText
                    ? 'hover:bg-white/5 active:bg-white/10'
                    : 'opacity-40 cursor-not-allowed'
                }`}
              >
                <span className="text-sm font-bold text-white/30 min-w-[1.75rem]">{chapter.number}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white/80 leading-snug truncate">{chapter.titleEs}</p>
                  {!hasText && <p className="text-xs text-white/25 mt-0.5">No text loaded</p>}
                </div>
                {hasText && <span className="text-white/20 text-lg">›</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  ) : null

  // ── Mobile: Text step ──────────────────────────────────────────────────
  const mobileChapterMeta = activeBook?.chapters.find((c) => c.number === selectedChapter)
  const mobileTextView = (
    <div className="flex flex-col h-[calc(100vh-56px)] md:hidden">
      {mobileHeader(
        mobileChapterMeta?.titleEs ?? 'Chapter',
        `/reader?book=${selectedBook}`
      )}

      {/* Filter bar */}
      {!loading && chapterText && (
        <FilterBar
          presentTypes={presentTypes}
          activeSubcategories={activeSubcategories}
          onToggle={handleToggle}
          onToggleAll={handleToggleAll}
          verbSearch={verbSearchInput}
          onVerbSearchChange={setVerbSearchInput}
          onVerbSearchSubmit={handleVerbSearchSubmit}
          isConjugating={isConjugating}
          verbInfinitive={verbInfinitive}
          onVerbSearchClear={handleVerbSearchClear}
          textSearch={textSearch}
          onTextSearchChange={setTextSearch}
          textSearchMatchCount={textSearchMatchCount}
          readerMode={readerMode}
          onReaderModeChange={setReaderMode}
        />
      )}

      {/* Scrollable text */}
      <div className="flex-1 overflow-y-auto px-5 py-5 pb-24">
        {loading && (
          <p className="text-white/40 text-sm animate-pulse">Loading chapter…</p>
        )}
        {!loading && !chapterText && (
          <div className="text-center mt-20">
            <p className="text-white/30 text-sm">No text loaded for this chapter yet.</p>
          </div>
        )}
        {!loading && chapterText && (
          <div className="space-y-5">
            <div className="text-xs text-white/25 mb-4">
              {terms.length} terms annotated
            </div>
            {chapterText.split(/\n\n+/).map((paragraph, pIdx) => (
              <AnnotatedText
                key={pIdx}
                text={paragraph}
                terms={terms}
                activeSubcategories={activeSubcategories}
                verbForms={verbForms}
                searchQuery={textSearch || undefined}
                onWordSelect={handleWordSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* ── Mobile drill-down (hidden on md+) ─────────────────── */}
      {mobileStep === 'books' && mobileBooksView}
      {mobileStep === 'chapters' && mobileChaptersView}
      {mobileStep === 'text' && mobileTextView}

      {/* ── Desktop 3-panel layout (hidden on mobile) ─────────── */}
      <div className="hidden md:flex h-[calc(100vh-56px)] overflow-hidden">
        {/* Book panel */}
        <BookListPanel books={books} selectedBook={selectedBook} onSelect={selectBook} />

        {/* Chapter panel */}
        {activeBook && (
          <ChapterListPanel
            book={activeBook}
            selectedChapter={selectedChapter}
            onSelect={selectChapter}
          />
        )}

        {/* Text panel */}
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
              {!loading && chapterText && (
                <FilterBar
                  presentTypes={presentTypes}
                  activeSubcategories={activeSubcategories}
                  onToggle={handleToggle}
                  onToggleAll={handleToggleAll}
                  verbSearch={verbSearchInput}
                  onVerbSearchChange={setVerbSearchInput}
                  onVerbSearchSubmit={handleVerbSearchSubmit}
                  isConjugating={isConjugating}
                  verbInfinitive={verbInfinitive}
                  onVerbSearchClear={handleVerbSearchClear}
                  textSearch={textSearch}
                  onTextSearchChange={setTextSearch}
                  textSearchMatchCount={textSearchMatchCount}
                  readerMode={readerMode}
                  onReaderModeChange={setReaderMode}
                />
              )}
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
                        verbForms={verbForms}
                        searchQuery={textSearch || undefined}
                        onWordSelect={handleWordSelect}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Word-add popover (Build mode) ──────────────────── */}
      {wordPopover && (
        <WordAddPopover
          selectedText={wordPopover.text}
          translation={wordPopover.translation}
          subcategory={wordPopover.subcategory}
          paragraph={wordPopover.paragraph}
          bookNumber={selectedBook}
          chapterNumber={selectedChapter}
          anchor={wordPopover.anchor}
          onClose={() => setWordPopover(null)}
        />
      )}

      {/* ── Conjugation panel (Read mode) ────────────────────── */}
      {conjPanelWord && (
        <ConjugationPanel
          surfaceForm={conjPanelWord.surfaceForm}
          subcategory={conjPanelWord.subcategory}
          onClose={() => setConjPanelWord(null)}
        />
      )}
    </>
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
