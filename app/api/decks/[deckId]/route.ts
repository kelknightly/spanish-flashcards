import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { createClient } from '@supabase/supabase-js'

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
    .select('id, name, book_number, chapter_number, category')
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

  return NextResponse.json({ deck, cards: cards ?? [] })
}
