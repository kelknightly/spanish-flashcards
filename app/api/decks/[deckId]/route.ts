import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { createClient } from '@supabase/supabase-js'
import { NEW_CARD_DAILY_CAP } from '@/lib/sm2'

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> }
) {
  const user = await getAuthUserFromRequest(request)
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { deckId } = await params

  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: deck, error: deckError } = await sb
    .from('decks')
    .select('id, name, book_number, chapter_number, category, subcategory')
    .eq('id', deckId)
    .eq('user_id', user.id)
    .single()

  if (deckError || !deck) {
    return NextResponse.json({ error: 'Deck not found' }, { status: 404 })
  }

  const { data: cards, error: cardsError } = await sb
    .from('cards')
    .select('id, spanish_term, english_answer, source_sentences, position, vocab_term_id')
    .eq('deck_id', deckId)
    .order('position')

  if (cardsError) {
    return NextResponse.json({ error: cardsError.message }, { status: 500 })
  }

  // Fetch existing progress rows for these cards' vocab terms so we can tag new cards
  const vocabTermIds = (cards ?? []).map((c) => c.vocab_term_id)
  const { data: progressRows } = vocabTermIds.length
    ? await sb
        .from('card_progress')
        .select('vocab_term_id')
        .eq('user_id', user.id)
        .in('vocab_term_id', vocabTermIds)
    : { data: [] }

  const seenTermIds = new Set((progressRows ?? []).map((r) => r.vocab_term_id))

  // Count new cards already introduced today (across all decks)
  const today = new Date().toISOString().slice(0, 10)
  const { count: newCardsIntroducedToday } = await sb
    .from('card_progress')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('introduced_at', `${today}T00:00:00.000Z`)
    .lt('introduced_at', `${today}T23:59:59.999Z`)

  const taggedCards = (cards ?? []).map((c) => ({
    ...c,
    isNew: !seenTermIds.has(c.vocab_term_id),
  }))

  return NextResponse.json({
    deck,
    cards: taggedCards,
    newCardsIntroducedToday: newCardsIntroducedToday ?? 0,
    newCardDailyCap: NEW_CARD_DAILY_CAP,
  })
}
