'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DECK_TYPES, getChapterMeta, getDeckLabel } from '@/data/books'

/** CEFR level badge colours keyed by subcategory */
const CEFR_BADGE: Record<string, { label: string; className: string }> = {
  'nouns-a1': { label: 'A1', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  'nouns-a2': { label: 'A2', className: 'bg-teal-500/20 text-teal-300 border-teal-500/40' },
  'nouns-b1': { label: 'B1', className: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
  'nouns-b2': { label: 'B2', className: 'bg-violet-500/20 text-violet-300 border-violet-500/40' },
}

interface DeckInfo {
  id: string
  name: string
  subcategory: string | null
  version: number
  card_count: number
  mastered_count: number
  reviewed_count: number
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
  const [showMixedFilter, setShowMixedFilter] = useState(false)
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())

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
        const deckList: DeckInfo[] = data.decks ?? []
        setDecks(deckList)
        // Derive latest subcategory for each type to pre-select all
        const latestMap = new Map<string, DeckInfo>()
        for (const d of deckList) {
          const key = d.subcategory ?? ''
          const ex = latestMap.get(key)
          if (!ex || d.version > ex.version) latestMap.set(key, d)
        }
        setSelectedTypes(new Set([...latestMap.keys()].filter(Boolean)))
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
        {DECK_TYPES.map((deckType) => {          const deck = latestBySubcategory.get(deckType.subcategory)
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
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <p className="text-sm font-semibold text-white leading-snug">
                      {deckType.label}
                    </p>
                    {CEFR_BADGE[deckType.subcategory] && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${CEFR_BADGE[deckType.subcategory].className}`}>
                        CEFR {CEFR_BADGE[deckType.subcategory].label}
                      </span>
                    )}
                  </div>
                </div>
                {deck && deck.version > 1 && (
                  <span className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full bg-neon-purple/20 text-neon-purple border border-neon-purple/30">
                    v{deck.version}
                  </span>
                )}
              </div>

          {/* Progress bar */}
              {deck ? (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-white/40">
                    <span>
                      {deck.reviewed_count}/{deck.card_count} reviewed
                      {deck.mastered_count > 0 && ` · ${deck.mastered_count} mastered`}
                    </span>
                    {allMastered && (
                      <span className="text-neon-gold">🏆 All mastered</span>
                    )}
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    {/* Reviewed progress (base layer) */}
                    <div
                      className="relative h-full rounded-full bg-neon-purple/60 transition-all duration-500"
                      style={{
                        width: deck.card_count
                          ? `${Math.round((deck.reviewed_count / deck.card_count) * 100)}%`
                          : '0%',
                      }}
                    >
                      {/* Mastered progress (overlay) */}
                      {deck.mastered_count > 0 && (
                        <div
                          className="absolute inset-y-0 left-0 bg-neon-green transition-all duration-500"
                          style={{
                            width: deck.reviewed_count
                              ? `${Math.round((deck.mastered_count / deck.reviewed_count) * 100)}%`
                              : '0%',
                          }}
                        />
                      )}
                    </div>
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

      {/* Mixed Deck — only shown when at least one deck exists */}
      {latestBySubcategory.size > 0 && (() => {
        const availableSubcats = DECK_TYPES
          .map((t) => t.subcategory)
          .filter((s) => latestBySubcategory.has(s)) as string[]

        const allSelected = availableSubcats.every((s) => selectedTypes.has(s))
        const noneSelected = availableSubcats.every((s) => !selectedTypes.has(s))
        const selectedCount = availableSubcats.filter((s) => selectedTypes.has(s)).length

        const handleStartMixed = () => {
          if (noneSelected) return
          const params = new URLSearchParams({ book: String(bookNumber), chapter: String(chapterNumber) })
          if (!allSelected) params.set('types', availableSubcats.filter((s) => selectedTypes.has(s)).join(','))
          router.push(`/decks/mixed?${params.toString()}`)
        }

        const toggleType = (sub: string) => {
          setSelectedTypes((prev) => {
            const next = new Set(prev)
            if (next.has(sub)) next.delete(sub)
            else next.add(sub)
            return next
          })
        }

        return (
          <div className="mt-6 pt-6 border-t border-white/10">
            {/* Header row */}
            <button
              onClick={() => setShowMixedFilter((v) => !v)}
              className="w-full rounded-xl glass border border-neon-blue/40 py-3 px-4 text-sm font-semibold text-neon-blue hover:bg-neon-blue/10 transition-colors flex items-center gap-2"
            >
              <span>🎲</span>
              <span>Mixed Deck</span>
              <span className="text-xs font-normal text-white/40 ml-1">
                20 random cards ·{' '}
                {allSelected ? 'all types' : `${selectedCount} type${selectedCount !== 1 ? 's' : ''}`}
              </span>
              <span className="ml-auto text-white/30 text-xs">{showMixedFilter ? '▲' : '▼'}</span>
            </button>

            {/* Expandable type filter */}
            {showMixedFilter && (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {availableSubcats.map((sub) => {
                    const checked = selectedTypes.has(sub)
                    return (
                      <button
                        key={sub}
                        onClick={() => toggleType(sub)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          checked
                            ? 'bg-neon-blue/20 border-neon-blue/60 text-neon-blue'
                            : 'bg-white/5 border-white/15 text-white/40 hover:border-white/30'
                        }`}
                      >
                        {getDeckLabel(sub)}
                      </button>
                    )
                  })}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex gap-3">
                    <button
                      onClick={() => setSelectedTypes(new Set(availableSubcats))}
                      className="text-xs text-white/40 hover:text-white/70 transition-colors"
                    >
                      Select all
                    </button>
                    <button
                      onClick={() => setSelectedTypes(new Set())}
                      className="text-xs text-white/40 hover:text-white/70 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                  <button
                    onClick={handleStartMixed}
                    disabled={noneSelected}
                    className="px-4 py-1.5 rounded-lg bg-neon-blue/20 border border-neon-blue/50 text-neon-blue text-xs font-semibold hover:bg-neon-blue/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Start →
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
