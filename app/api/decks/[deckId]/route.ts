import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAllowedEmail } from '@/lib/auth-api'
import { sql } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> }
) {
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { deckId } = await params

  const deck = (await sql`
    SELECT id, name, book_number, chapter_number, category, subcategory
    FROM decks WHERE id = ${deckId} AND user_id = ${user.id}
  ` as Record<string, unknown>[])[0]

  if (!deck) {
    return NextResponse.json({ error: 'Deck not found' }, { status: 404 })
  }

  const cards = (await sql`
    SELECT id, spanish_term, english_answer, source_sentences, position, vocab_term_id
    FROM cards WHERE deck_id = ${deckId}
    ORDER BY position
  `) as Record<string, unknown>[]

  const vocabTermIds = (cards as { vocab_term_id: string }[]).map((c) => c.vocab_term_id)
  const progressRows = vocabTermIds.length
    ? await sql`
        SELECT vocab_term_id, interval_days, mastered_at
        FROM card_progress
        WHERE user_id = ${user.id} AND vocab_term_id = ANY(${vocabTermIds})
      `
    : []

  const progressByTermId = new Map(
    (progressRows as { vocab_term_id: string; interval_days: number; mastered_at: string | null }[])
      .map((r) => [r.vocab_term_id, r])
  )

  const taggedCards = (cards as Record<string, unknown>[]).map((c) => {
    const prog = progressByTermId.get(c.vocab_term_id as string)
    return {
      ...c,
      isNew: !prog,
      interval_days: prog?.interval_days ?? 0,
      mastered_at: prog?.mastered_at ?? null,
    }
  })

  return NextResponse.json({ deck, cards: taggedCards })
}
