'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DECK_TYPES, getChapterMeta } from '@/data/books'

interface DeckInfo {
  id: string
  name: string
  subcategory: string | null
  version: number
  card_count: number
  mastered_count: number
  is_system_generated: boolean
  parent_deck_id: string | null
}

interface Props {
  bookNumber: number
  chapterNumber: number
}

export function ChapterDecksPanel({ bookNumber, chapterNumber }: Props) {
  const { session } = useAuth()
  const router = useRouter()
  const [decks, setDecks] = useState<DeckInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [expanding, setExpanding] = useState<string | null>(null)

  const chapter = getChapterMeta(bookNumber, chapterNumber)
  const hasText = !!chapter?.hasText

  useEffect(() => {
    if (!session) return
    setLoading(true)
    fetch(`/api/decks?book=${bookNumber}&chapter=${chapterNumber}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setDecks(data.decks ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [session, bookNumber, chapterNumber])

  // For each subcategory, show only the latest version
  const latestBySubcategory = new Map<string, DeckInfo>()
  for (const deck of decks) {
    const key = deck.subcategory ?? ''
    const existing = latestBySubcategory.get(key)
    if (!existing || deck.version > existing.version) {
      latestBySubcategory.set(key, deck)
    }
  }

  const handleAddMore = async (deck: DeckInfo) => {
    if (!session) return
    setExpanding(deck.id)
    try {
      const res = await fetch(`/api/decks/${deck.id}/expand`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (data.newDeckId) {
        router.push(`/decks/${data.newDeckId}`)
      } else {
        alert(data.error ?? 'Could not expand deck.')
      }
    } catch {
      alert('Failed to expand deck.')
    } finally {
      setExpanding(null)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-white/40 animate-pulse text-sm">Loading decks…</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Chapter header */}
      <div className="mb-6">
        <p className="text-xs text-white/40 uppercase tracking-widest font-medium">
          Book {bookNumber} · Chapter {chapterNumber}
        </p>
        <h2 className="text-xl font-bold text-white mt-1">{chapter?.titleEs}</h2>
        {!hasText && (
          <p className="mt-2 text-sm text-amber-400/80">
            ⚠️  Chapter text not yet loaded — decks cannot be generated.
          </p>
        )}
      </div>

      {/* Deck grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {DECK_TYPES.map((deckType) => {
          const deck = latestBySubcategory.get(deckType.subcategory)
          const allMastered =
            deck && deck.card_count > 0 && deck.mastered_count >= deck.card_count

          return (
            <div
              key={deckType.subcategory}
              className="glass rounded-xl p-4 flex flex-col gap-3"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-white/40 uppercase tracking-wider font-medium">
                    {deckType.category}
                  </p>
                  <p className="text-sm font-semibold text-white leading-snug mt-0.5">
                    {deckType.label}
                  </p>
                </div>
                {deck && deck.version > 1 && (
                  <span className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full bg-neon-purple/20 text-neon-purple border border-neon-purple/30">
                    v{deck.version}
                  </span>
                )}
              </div>

              {/* Mastery bar */}
              {deck ? (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-white/40">
                    <span>{deck.mastered_count}/{deck.card_count} mastered</span>
                    {allMastered && (
                      <span className="text-neon-gold">🏆 All mastered</span>
                    )}
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-neon-green transition-all duration-500"
                      style={{
                        width: deck.card_count
                          ? `${Math.round((deck.mastered_count / deck.card_count) * 100)}%`
                          : '0%',
                      }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-white/30 italic">Not generated yet</p>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-auto">
                {deck ? (
                  <>
                    <button
                      onClick={() => router.push(`/decks/${deck.id}`)}
                      className="flex-1 rounded-lg bg-neon-purple py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
                    >
                      Study
                    </button>
                    {allMastered && (
                      <button
                        onClick={() => handleAddMore(deck)}
                        disabled={expanding === deck.id}
                        className="flex-1 rounded-lg border border-neon-gold/50 text-neon-gold py-1.5 text-xs font-semibold hover:bg-neon-gold/10 transition-colors disabled:opacity-50"
                      >
                        {expanding === deck.id ? 'Adding…' : '+ Add More'}
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-white/25 py-1.5">
                    {hasText ? 'Run seed script to generate' : 'Load chapter text first'}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
