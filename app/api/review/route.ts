import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAllowedEmail } from '@/lib/auth-api'
import { sql } from '@/lib/db'

export async function GET(request: NextRequest) {
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const modeParam = searchParams.get('mode') as 'es-to-en' | 'en-to-es' | null

  const today = new Date().toISOString().slice(0, 10)

  // Fetch all due card_progress rows with vocab term, oldest-due first
  const progressRows = (await sql`
    SELECT cp.vocab_term_id, cp.repetitions, vt.spanish_term
    FROM card_progress cp
    JOIN vocabulary_terms vt ON vt.id = cp.vocab_term_id
    WHERE cp.user_id = ${user.id} AND cp.next_review_at <= ${today}
    ORDER BY cp.next_review_at ASC
  `) as Record<string, unknown>[]

  if (!progressRows.length) {
    return NextResponse.json({ cards: [] })
  }

  const vocabTermIds = (progressRows as { vocab_term_id: string }[]).map((r) => r.vocab_term_id)

  // Fetch one card per vocab_term (any deck; take first by deck join)
  const cardRows = (await sql`
    SELECT c.id, c.vocab_term_id, c.english_answer, c.source_sentences, c.deck_id, d.name AS deck_name
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    WHERE c.vocab_term_id = ANY(${vocabTermIds})
  `) as Record<string, unknown>[]

  // Deduplicate: one card per vocab_term, in due-date order
  const cardByTermId = new Map<string, Record<string, unknown>>()
  for (const card of cardRows as Record<string, unknown>[]) {
    if (!cardByTermId.has(card.vocab_term_id as string)) {
      cardByTermId.set(card.vocab_term_id as string, card)
    }
  }

  const seen = new Set<string>()
  const cards = []

  for (const prog of progressRows as Record<string, unknown>[]) {
    const termId = prog.vocab_term_id as string
    if (seen.has(termId)) continue
    const card = cardByTermId.get(termId)
    if (!card) continue
    seen.add(termId)

    let direction: 'es-to-en' | 'en-to-es'
    if (modeParam === 'en-to-es') {
      direction = 'en-to-es'
    } else if (modeParam === 'es-to-en') {
      direction = 'es-to-en'
    } else {
      const repetitions = (prog.repetitions as number) ?? 0
      direction = repetitions >= 3 && Math.random() < 0.5 ? 'en-to-es' : 'es-to-en'
    }

    cards.push({
      id: card.id,
      vocab_term_id: termId,
      spanish_term: prog.spanish_term,
      english_answer: card.english_answer,
      source_sentences: card.source_sentences ?? [],
      deck_id: card.deck_id,
      deck_name: card.deck_name ?? '',
      direction,
    })
  }

  return NextResponse.json({ cards })
}
