'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DECK_TYPES } from '@/data/books'

interface DeckInfo {
  id: string
  name: string
  book_number: number | null
  chapter_number: number | null
  subcategory: string | null
  card_count: number
  mastered_count: number
  created_at: string
  is_custom: boolean
}

export function CustomDecksView() {
  const { session } = useAuth()
  const router = useRouter()
  const [decks, setDecks] = useState<DeckInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session) return
    fetch('/api/decks', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        const custom: DeckInfo[] = (data.decks ?? [])
          .filter((d: DeckInfo) => d.is_custom)
          .sort(
            (a: DeckInfo, b: DeckInfo) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
        setDecks(custom)
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

  if (decks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-3xl mb-4">✏️</p>
          <p className="text-sm text-white/50">No custom decks yet</p>
          <p className="text-xs text-white/30 mt-1">
            Click any word in the Reader to add it to a deck
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="space-y-2 max-w-2xl mx-auto">
        {decks.map((deck) => {
          const pct = deck.card_count
            ? Math.round((deck.mastered_count / deck.card_count) * 100)
            : 0
          const allMastered = deck.card_count > 0 && deck.mastered_count >= deck.card_count

          const typeLabel = deck.subcategory
            ? (DECK_TYPES.find((t) => t.subcategory === deck.subcategory)?.label ??
               deck.subcategory)
            : null

          const location =
            deck.book_number
              ? `Bk ${deck.book_number}${deck.chapter_number ? ` · Ch ${deck.chapter_number}` : ''}`
              : 'General'

          return (
            <div
              key={deck.id}
              className="glass rounded-xl flex items-center gap-4 px-5 py-3.5 hover:bg-white/5 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <p className="text-sm font-semibold text-white truncate">{deck.name}</p>
                  {typeLabel && (
                    <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-neon-purple/20 text-neon-purple/80 font-medium">
                      {typeLabel}
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/40 mb-2">{location}</p>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-neon-green transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-white/30 mt-0.5">
                  {deck.mastered_count}/{deck.card_count}
                  {allMastered && <span className="ml-2 text-neon-gold">🏆</span>}
                </p>
              </div>
              <button
                onClick={() => router.push(`/decks/${deck.id}`)}
                className="shrink-0 rounded-lg bg-neon-purple/80 px-3 py-1 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
              >
                Study
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
