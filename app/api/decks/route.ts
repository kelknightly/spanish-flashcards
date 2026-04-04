import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { createClient } from '@supabase/supabase-js'

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

interface CardInput {
  spanish: string
  english: string
  sourceSentences?: Array<{ es: string; en: string }>
}

interface DeckInput {
  deckName: string
  bookNumber?: number
  chapterNumber?: number
  category?: string
  cards: CardInput[]
  chatSessionId?: string
}

export async function POST(request: NextRequest) {
  const user = await getAuthUserFromRequest(request)
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: DeckInput
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { deckName, bookNumber, chapterNumber, category, cards, chatSessionId } = body

  if (!deckName?.trim() || !cards?.length) {
    return NextResponse.json({ error: 'deckName and cards are required' }, { status: 400 })
  }

  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  // 1. Create the deck
  const { data: deck, error: deckError } = await sb
    .from('decks')
    .insert({
      user_id: user.id,
      name: deckName.trim(),
      book_number: bookNumber ?? null,
      chapter_number: chapterNumber ?? null,
      category: category ?? null,
    })
    .select('id')
    .single()

  if (deckError) {
    return NextResponse.json({ error: deckError.message }, { status: 500 })
  }

  const deckId = deck.id

  // 2. Upsert vocabulary_terms (shared across decks by user)
  const terms = cards.map((c) => ({
    user_id: user.id,
    spanish_term: c.spanish.trim().toLowerCase(),
  }))

  const { error: termUpsertError } = await sb
    .from('vocabulary_terms')
    .upsert(terms, { onConflict: 'user_id,spanish_term', ignoreDuplicates: true })

  if (termUpsertError) {
    return NextResponse.json({ error: termUpsertError.message }, { status: 500 })
  }

  // 3. Fetch the term IDs we just upserted
  const spanishTerms = terms.map((t) => t.spanish_term)
  const { data: termRows, error: termFetchError } = await sb
    .from('vocabulary_terms')
    .select('id, spanish_term')
    .eq('user_id', user.id)
    .in('spanish_term', spanishTerms)

  if (termFetchError || !termRows) {
    return NextResponse.json({ error: termFetchError?.message ?? 'Term fetch failed' }, { status: 500 })
  }

  const termIdMap = new Map(termRows.map((r) => [r.spanish_term, r.id]))

  // 4. Insert cards
  const cardRows = cards
    .map((c, i) => {
      const termId = termIdMap.get(c.spanish.trim().toLowerCase())
      if (!termId) return null
      return {
        deck_id: deckId,
        vocab_term_id: termId,
        spanish_term: c.spanish.trim(),
        english_answer: c.english.trim(),
        source_sentences: c.sourceSentences ?? [],
        position: i,
      }
    })
    .filter(Boolean)

  const { error: cardsError } = await sb.from('cards').insert(cardRows)

  if (cardsError) {
    return NextResponse.json({ error: cardsError.message }, { status: 500 })
  }

  // 5. Link chat session to deck if provided
  if (chatSessionId) {
    await sb
      .from('chat_sessions')
      .update({ deck_id: deckId })
      .eq('id', chatSessionId)
      .eq('user_id', user.id)
  }

  return NextResponse.json({ deckId, cardCount: cardRows.length })
}

// List all decks for the authenticated user
export async function GET(request: NextRequest) {
  const user = await getAuthUserFromRequest(request)
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data, error } = await sb
    .from('decks')
    .select(
      `id, name, book_number, chapter_number, category, created_at, last_studied_at,
       cards(count)`
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ decks: data })
}
