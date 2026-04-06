'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DECK_TYPES, getBook } from '@/data/books'

interface DeckInfo {
  id: string
  name: string
  book_number: number | null
  chapter_number: number | null
  subcategory: string | null
  version: number
  card_count: number
  mastered_count: number
}

export function TypeBrowseView() {
  const { session } = useAuth()
  const router = useRouter()
  const [decks, setDecks] = useState<DeckInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [openType, setOpenType] = useState<string | null>(DECK_TYPES[0].subcategory)

  useEffect(() => {
    if (!session) return
    fetch('/api/decks', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setDecks(data.decks ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [session])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-white/40 animate-pulse text-sm">Loading decks…</div>
      </div>
    )
  }

  // Group by subcategory, for each subcategory sort by book + chapter
  // Decks with null subcategory are treated as 'general'
  const grouped = new Map<string, DeckInfo[]>()
  for (const deckType of DECK_TYPES) {
    const matching = decks
      .filter((d) => (d.subcategory ?? 'general') === deckType.subcategory)
      .sort((a, b) => {
        if ((a.book_number ?? 0) !== (b.book_number ?? 0)) {
          return (a.book_number ?? 0) - (b.book_number ?? 0)
        }
        return (a.chapter_number ?? 0) - (b.chapter_number ?? 0)
      })
    grouped.set(deckType.subcategory, matching)
  }

  const totalDecks = decks.length
  const totalMastered = decks.filter((d) => d.card_count > 0 && d.mastered_count >= d.card_count).length

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Summary */}
      <div className="flex gap-6 mb-6">
        <div className="text-center">
          <p className="text-2xl font-bold text-neon-purple">{totalDecks}</p>
          <p className="text-xs text-white/40">Total decks</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-neon-gold">{totalMastered}</p>
          <p className="text-xs text-white/40">Fully mastered</p>
        </div>
      </div>

      {/* Accordion by deck type */}
      <div className="space-y-3">
        {DECK_TYPES.map((deckType) => {
          const typeDecks = grouped.get(deckType.subcategory) ?? []
          const isOpen = openType === deckType.subcategory
          const masteredCount = typeDecks.filter(
            (d) => d.card_count > 0 && d.mastered_count >= d.card_count
          ).length

          return (
            <div key={deckType.subcategory} className="glass rounded-xl overflow-hidden">
              {/* Accordion header */}
              <button
                onClick={() => setOpenType(isOpen ? null : deckType.subcategory)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-white">{deckType.label}</span>
                  <span className="text-xs text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
                    {typeDecks.length} {typeDecks.length === 1 ? 'deck' : 'decks'}
                  </span>
                  {masteredCount > 0 && (
                    <span className="text-xs text-neon-gold">
                      🏆 {masteredCount} mastered
                    </span>
                  )}
                </div>
                <span className={`text-white/40 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                  ▾
                </span>
              </button>

              {/* Accordion body */}
              {isOpen && (
                <div className="border-t border-white/10 divide-y divide-white/5">
                  {typeDecks.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-white/30 italic">
                      No decks generated yet for this type.
                    </p>
                  ) : (
                    typeDecks.map((deck) => {
                      const book = deck.book_number ? getBook(deck.book_number) : null
                      const isGeneral = deckType.subcategory === 'general'
                      const allMastered =
                        deck.card_count > 0 && deck.mastered_count >= deck.card_count
                      const pct = deck.card_count
                        ? Math.round((deck.mastered_count / deck.card_count) * 100)
                        : 0

                      return (
                        <div
                          key={deck.id}
                          className="flex items-center gap-4 px-5 py-3 hover:bg-white/5 transition-colors"
                        >
                          {/* Chapter label */}
                          <div className="min-w-[8rem]">
                            {isGeneral ? (
                              <p className="text-xs text-white/70 font-medium truncate max-w-[10rem]" title={deck.name}>
                                {deck.name}
                              </p>
                            ) : (
                              <>
                                <p className="text-xs text-white/40 font-medium">
                                  Bk {deck.book_number} · Ch {deck.chapter_number}
                                  {deck.version > 1 && (
                                    <span className="ml-1 text-neon-purple">v{deck.version}</span>
                                  )}
                                </p>
                                <p className="text-xs text-white/60 truncate max-w-[10rem]" title={book?.titleEs}>
                                  {book?.titleEs ?? ''}
                                </p>
                              </>
                            )}
                          </div>

                          {/* Mastery bar */}
                          <div className="flex-1 space-y-1">
                            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                              <div
                                className="h-full bg-neon-green transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <p className="text-xs text-white/30">
                              {deck.mastered_count}/{deck.card_count}
                              {allMastered && (
                                <span className="ml-2 text-neon-gold">🏆</span>
                              )}
                            </p>
                          </div>

                          {/* Study button */}
                          <button
                            onClick={() => router.push(`/decks/${deck.id}`)}
                            className="shrink-0 rounded-lg bg-neon-purple/80 px-3 py-1 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
                          >
                            Study
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
