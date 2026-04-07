import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { createClient } from '@supabase/supabase-js'

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

export async function POST(
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

  let body: { spanish: string; english: string; sourceSentences?: Array<{ es: string; en: string }> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { spanish, english, sourceSentences } = body
  if (!spanish?.trim() || !english?.trim()) {
    return NextResponse.json({ error: 'spanish and english are required' }, { status: 400 })
  }

  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  // Verify the deck belongs to this user
  const { data: deck, error: deckError } = await sb
    .from('decks')
    .select('id')
    .eq('id', deckId)
    .eq('user_id', user.id)
    .single()

  if (deckError || !deck) {
    return NextResponse.json({ error: 'Deck not found' }, { status: 404 })
  }

  // Upsert vocabulary term (idempotent)
  const spanishLower = spanish.trim().toLowerCase()
  const { error: termUpsertError } = await sb
    .from('vocabulary_terms')
    .upsert(
      { user_id: user.id, spanish_term: spanishLower },
      { onConflict: 'user_id,spanish_term', ignoreDuplicates: true }
    )

  if (termUpsertError) {
    return NextResponse.json({ error: termUpsertError.message }, { status: 500 })
  }

  // Fetch the term ID
  const { data: termRow, error: termFetchError } = await sb
    .from('vocabulary_terms')
    .select('id')
    .eq('user_id', user.id)
    .eq('spanish_term', spanishLower)
    .single()

  if (termFetchError || !termRow) {
    return NextResponse.json({ error: 'Term lookup failed' }, { status: 500 })
  }

  // Get current max position in the deck so we can append
  const { data: maxPosRow } = await sb
    .from('cards')
    .select('position')
    .eq('deck_id', deckId)
    .order('position', { ascending: false })
    .limit(1)
    .single()

  const nextPosition = maxPosRow ? (maxPosRow.position as number) + 1 : 0

  // Insert the card
  const { data: card, error: cardError } = await sb
    .from('cards')
    .insert({
      deck_id: deckId,
      vocab_term_id: termRow.id,
      spanish_term: spanish.trim(),
      english_answer: english.trim(),
      source_sentences: sourceSentences ?? [],
      position: nextPosition,
    })
    .select('id')
    .single()

  if (cardError) {
    return NextResponse.json({ error: cardError.message }, { status: 500 })
  }

  return NextResponse.json({ cardId: card.id })
}
