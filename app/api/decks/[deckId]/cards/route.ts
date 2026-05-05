import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAllowedEmail } from '@/lib/auth-api'
import { sql } from '@/lib/db'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> }
) {
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  const deck = (await sql`SELECT id FROM decks WHERE id = ${deckId} AND user_id = ${user.id}` as Record<string, unknown>[])[0]
  if (!deck) return NextResponse.json({ error: 'Deck not found' }, { status: 404 })

  const spanishLower = spanish.trim().toLowerCase()

  await sql`
    INSERT INTO vocabulary_terms (user_id, spanish_term)
    VALUES (${user.id}, ${spanishLower})
    ON CONFLICT (user_id, spanish_term) DO NOTHING
  `

  const termRow = (await sql`
    SELECT id FROM vocabulary_terms WHERE user_id = ${user.id} AND spanish_term = ${spanishLower}
  ` as Record<string, unknown>[])[0]
  if (!termRow) return NextResponse.json({ error: 'Term lookup failed' }, { status: 500 })

  const maxPosRow = (await sql`
    SELECT MAX(position) AS max_pos FROM cards WHERE deck_id = ${deckId}
  ` as Record<string, unknown>[])[0]
  const nextPosition = maxPosRow?.max_pos != null ? Number(maxPosRow.max_pos) + 1 : 0

  const card = (await sql`
    INSERT INTO cards (deck_id, vocab_term_id, spanish_term, english_answer, source_sentences, position)
    VALUES (
      ${deckId}, ${(termRow as { id: string }).id},
      ${spanish.trim()}, ${english.trim()},
      ${JSON.stringify(sourceSentences ?? [])}, ${nextPosition}
    )
    RETURNING id
  ` as Record<string, unknown>[])[0]

  return NextResponse.json({ cardId: (card as { id: string }).id })
}
