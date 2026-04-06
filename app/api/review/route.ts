import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { createClient } from '@supabase/supabase-js'

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

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

  const today = new Date().toISOString().slice(0, 10)

  // Fetch all due card_progress rows, oldest-due first
  const { data: progressRows, error: progressError } = await sb
    .from('card_progress')
    .select('vocab_term_id, vocabulary_terms(spanish_term)')
    .eq('user_id', user.id)
    .lte('next_review_at', today)
    .order('next_review_at', { ascending: true })

  if (progressError) {
    return NextResponse.json({ error: progressError.message }, { status: 500 })
  }

  if (!progressRows?.length) {
    return NextResponse.json({ cards: [] })
  }

  const vocabTermIds = progressRows.map((r) => r.vocab_term_id)

  // Fetch one card per vocab_term (any deck; take first)
  const { data: cardRows, error: cardError } = await sb
    .from('cards')
    .select('id, vocab_term_id, english_answer, source_sentences, deck_id, decks(name)')
    .in('vocab_term_id', vocabTermIds)

  if (cardError) {
    return NextResponse.json({ error: cardError.message }, { status: 500 })
  }

  // Deduplicate: one card per vocab_term, ordered by the due-date order from progressRows
  const seen = new Set<string>()
  const cards = []

  for (const prog of progressRows) {
    if (seen.has(prog.vocab_term_id)) continue
    const card = cardRows?.find((c) => c.vocab_term_id === prog.vocab_term_id)
    if (!card) continue
    seen.add(prog.vocab_term_id)

    const vocab = prog.vocabulary_terms as unknown as { spanish_term: string } | null
    const deck = card.decks as unknown as { name: string } | null

    cards.push({
      id: card.id,
      vocab_term_id: prog.vocab_term_id,
      spanish_term: vocab?.spanish_term ?? '',
      english_answer: card.english_answer,
      source_sentences: card.source_sentences ?? [],
      deck_id: card.deck_id,
      deck_name: deck?.name ?? '',
    })
  }

  return NextResponse.json({ cards })
}
