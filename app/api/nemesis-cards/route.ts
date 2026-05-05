import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAllowedEmail } from '@/lib/auth-api'
import { sql } from '@/lib/db'

export async function GET(request: NextRequest) {
  void request
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch card_progress rows with at least 3 reviews, ordered by fewest correct
  const progressRows = (await sql`
    SELECT vocab_term_id, total_reviews, total_correct
    FROM card_progress
    WHERE user_id = ${user.id} AND total_reviews >= 3
    ORDER BY total_correct ASC
    LIMIT 30
  `) as Record<string, unknown>[]

  if (!progressRows.length) {
    return NextResponse.json({ cards: [] })
  }

  const sorted = (progressRows as { vocab_term_id: string; total_reviews: number; total_correct: number }[])
    .map((r) => ({ ...r, wrong_count: r.total_reviews - r.total_correct }))
    .sort((a, b) => b.wrong_count - a.wrong_count)
    .slice(0, 5)

  const termIds = sorted.map((r) => r.vocab_term_id)

  const cards = (await sql`
    SELECT vocab_term_id, spanish_term, english_answer
    FROM cards WHERE vocab_term_id = ANY(${termIds})
  `) as Record<string, unknown>[]

  const cardMap = new Map(
    (cards as { vocab_term_id: string; spanish_term: string; english_answer: string }[])
      .map((c) => [c.vocab_term_id, c])
  )

  const result = sorted
    .map((r) => ({
      vocab_term_id: r.vocab_term_id,
      spanish_term: cardMap.get(r.vocab_term_id)?.spanish_term ?? '',
      english_answer: cardMap.get(r.vocab_term_id)?.english_answer ?? '',
      wrong_count: r.wrong_count,
      total_reviews: r.total_reviews,
    }))
    .filter((r) => r.spanish_term)

  return NextResponse.json({ cards: result })
}
