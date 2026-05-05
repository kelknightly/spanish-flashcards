import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAllowedEmail } from '@/lib/auth-api'
import { sql } from '@/lib/db'

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
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const bookParam = searchParams.get('book')
  const chapterParam = searchParams.get('chapter')
  const typesParam = searchParams.get('types')
  const allowedTypes = typesParam ? new Set(typesParam.split(',').map((s) => s.trim()).filter(Boolean)) : null

  if (!bookParam || !chapterParam) {
    return NextResponse.json({ error: 'book and chapter are required' }, { status: 400 })
  }

  const bookNumber = parseInt(bookParam, 10)
  const chapterNumber = parseInt(chapterParam, 10)

  if (isNaN(bookNumber) || isNaN(chapterNumber)) {
    return NextResponse.json({ error: 'book and chapter must be integers' }, { status: 400 })
  }

  // 1. Fetch all decks for this chapter
  const allDecks = (await sql`
    SELECT id, subcategory, version FROM decks
    WHERE user_id = ${user.id} AND book_number = ${bookNumber} AND chapter_number = ${chapterNumber}
  `) as { id: string; subcategory: string | null; version: number }[]

  if (!allDecks.length) {
    return NextResponse.json({ error: 'No decks found for this chapter' }, { status: 404 })
  }

  // 2. Keep only the latest version per subcategory
  const latestBySubcategory = new Map<string, string>()
  for (const deck of allDecks) {
    const key = deck.subcategory ?? deck.id
    const existing = latestBySubcategory.get(key)
    if (!existing) {
      latestBySubcategory.set(key, deck.id)
    } else {
      const existingDeck = (allDecks as { id: string; version: number }[]).find((d) => d.id === existing)
      if (existingDeck && deck.version > existingDeck.version) {
        latestBySubcategory.set(key, deck.id)
      }
    }
  }

  const deckIds = [...latestBySubcategory.entries()]
    .filter(([sub]) => !allowedTypes || allowedTypes.has(sub))
    .map(([, id]) => id)

  if (!deckIds.length) {
    return NextResponse.json({ error: 'No decks found for this chapter' }, { status: 404 })
  }

  // 3. Fetch all cards from those decks
  const allCards = (await sql`
    SELECT id, spanish_term, english_answer, source_sentences, position, vocab_term_id
    FROM cards WHERE deck_id = ANY(${deckIds})
  `) as Record<string, unknown>[]

  if (!allCards.length) {
    return NextResponse.json({ error: 'No cards found in this chapter' }, { status: 404 })
  }

  const allVocabTermIds = (allCards as { vocab_term_id: string }[]).map((c) => c.vocab_term_id)

  // 4. Fetch mastered vocab_term_ids for this user
  const masteredRows = (await sql`
    SELECT vocab_term_id FROM card_progress
    WHERE user_id = ${user.id} AND mastered_at IS NOT NULL
      AND vocab_term_id = ANY(${allVocabTermIds})
  `) as Record<string, unknown>[]
  const masteredSet = new Set((masteredRows as { vocab_term_id: string }[]).map((r) => r.vocab_term_id))

  // 5. Filter mastered and deduplicate by vocab_term_id
  const seen = new Set<string>()
  const eligible: Record<string, unknown>[] = []

  for (const card of allCards as Record<string, unknown>[]) {
    const termId = card.vocab_term_id as string
    if (masteredSet.has(termId)) continue
    if (seen.has(termId)) continue
    seen.add(termId)
    eligible.push(card)
  }

  if (!eligible.length) {
    return NextResponse.json({ error: 'All cards in this chapter have been mastered!' }, { status: 404 })
  }

  // 6. Shuffle and take up to MIXED_DECK_SIZE
  shuffle(eligible)
  const selected = eligible.slice(0, MIXED_DECK_SIZE)

  // 7. Tag new cards
  const selectedTermIds = selected.map((c) => c.vocab_term_id as string)
  const progressRows = (await sql`
    SELECT vocab_term_id FROM card_progress
    WHERE user_id = ${user.id} AND vocab_term_id = ANY(${selectedTermIds})
  `) as Record<string, unknown>[]
  const seenTermIds = new Set((progressRows as { vocab_term_id: string }[]).map((r) => r.vocab_term_id))

  const taggedCards = selected.map((c) => ({
    ...c,
    isNew: !seenTermIds.has(c.vocab_term_id as string),
  }))

  return NextResponse.json({
    deck: {
      id: 'mixed',
      name: 'Mixed Deck',
      book_number: bookNumber,
      chapter_number: chapterNumber,
      category: null,
      subcategory: null,
    },
    cards: taggedCards,
  })
}
