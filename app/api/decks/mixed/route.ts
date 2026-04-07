import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { createClient } from '@supabase/supabase-js'
import { NEW_CARD_DAILY_CAP } from '@/lib/sm2'

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

const MIXED_DECK_SIZE = 20

/** Fisher-Yates shuffle (in-place) */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export async function GET(request: NextRequest) {
  const user = await getAuthUserFromRequest(request)
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const bookParam = searchParams.get('book')
  const chapterParam = searchParams.get('chapter')

  if (!bookParam || !chapterParam) {
    return NextResponse.json({ error: 'book and chapter are required' }, { status: 400 })
  }

  const bookNumber = parseInt(bookParam, 10)
  const chapterNumber = parseInt(chapterParam, 10)

  if (isNaN(bookNumber) || isNaN(chapterNumber)) {
    return NextResponse.json({ error: 'book and chapter must be integers' }, { status: 400 })
  }

  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  // 1. Fetch all decks for this chapter
  const { data: allDecks, error: deckError } = await sb
    .from('decks')
    .select('id, name, subcategory, version')
    .eq('user_id', user.id)
    .eq('book_number', bookNumber)
    .eq('chapter_number', chapterNumber)

  if (deckError) {
    return NextResponse.json({ error: deckError.message }, { status: 500 })
  }

  if (!allDecks?.length) {
    return NextResponse.json({ error: 'No decks found for this chapter' }, { status: 404 })
  }

  // 2. Keep only the latest version per subcategory (same logic as ChapterDecksPanel)
  const latestBySubcategory = new Map<string, string>() // subcategory → deck id
  for (const deck of allDecks) {
    const key = deck.subcategory ?? deck.id
    const existing = latestBySubcategory.get(key)
    if (!existing) {
      latestBySubcategory.set(key, deck.id)
    } else {
      const existingDeck = allDecks.find((d) => d.id === existing)
      if (existingDeck && deck.version > existingDeck.version) {
        latestBySubcategory.set(key, deck.id)
      }
    }
  }

  const deckIds = [...latestBySubcategory.values()]

  // 3. Fetch all cards from those decks
  const { data: allCards, error: cardsError } = await sb
    .from('cards')
    .select('id, spanish_term, english_answer, source_sentences, position, vocab_term_id')
    .in('deck_id', deckIds)

  if (cardsError) {
    return NextResponse.json({ error: cardsError.message }, { status: 500 })
  }

  if (!allCards?.length) {
    return NextResponse.json({ error: 'No cards found in this chapter' }, { status: 404 })
  }

  const allVocabTermIds = allCards.map((c) => c.vocab_term_id)

  // 4. Fetch mastered vocab_term_ids for this user (within this card set)
  const { data: masteredRows, error: masteredError } = await sb
    .from('card_progress')
    .select('vocab_term_id')
    .eq('user_id', user.id)
    .not('mastered_at', 'is', null)
    .in('vocab_term_id', allVocabTermIds)

  if (masteredError) {
    return NextResponse.json({ error: masteredError.message }, { status: 500 })
  }

  const masteredSet = new Set((masteredRows ?? []).map((r) => r.vocab_term_id))

  // 5. Filter out mastered cards and deduplicate by vocab_term_id
  const seen = new Set<string>()
  const eligible: typeof allCards = []

  for (const card of allCards) {
    if (masteredSet.has(card.vocab_term_id)) continue
    if (seen.has(card.vocab_term_id)) continue
    seen.add(card.vocab_term_id)
    eligible.push(card)
  }

  if (!eligible.length) {
    return NextResponse.json({ error: 'All cards in this chapter have been mastered!' }, { status: 404 })
  }

  // 6. Shuffle and take up to MIXED_DECK_SIZE
  shuffle(eligible)
  const selected = eligible.slice(0, MIXED_DECK_SIZE)

  // 7. Tag new cards (no card_progress row yet)
  const selectedTermIds = selected.map((c) => c.vocab_term_id)

  const { data: progressRows } = await sb
    .from('card_progress')
    .select('vocab_term_id')
    .eq('user_id', user.id)
    .in('vocab_term_id', selectedTermIds)

  const seenTermIds = new Set((progressRows ?? []).map((r) => r.vocab_term_id))

  const taggedCards = selected.map((c) => ({
    ...c,
    isNew: !seenTermIds.has(c.vocab_term_id),
  }))

  // 8. Count new cards introduced today (for the daily cap)
  const today = new Date().toISOString().slice(0, 10)
  const { count: newCardsIntroducedToday } = await sb
    .from('card_progress')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('introduced_at', `${today}T00:00:00.000Z`)
    .lt('introduced_at', `${today}T23:59:59.999Z`)

  return NextResponse.json({
    deck: {
      id: 'mixed',
      name: `Mixed Deck`,
      book_number: bookNumber,
      chapter_number: chapterNumber,
      category: null,
      subcategory: null,
    },
    cards: taggedCards,
    newCardsIntroducedToday: newCardsIntroducedToday ?? 0,
    newCardDailyCap: NEW_CARD_DAILY_CAP,
  })
}
