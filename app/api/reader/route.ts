import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAllowedEmail } from '@/lib/auth-api'
import { getChapterText } from '@/data/books/text-loader'
import { sql } from '@/lib/db'

export async function GET(request: NextRequest) {
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authHeader = request.headers.get('authorization')
  void authHeader // no longer needed

  const { searchParams } = new URL(request.url)
  const book = parseInt(searchParams.get('book') ?? '', 10)
  const chapter = parseInt(searchParams.get('chapter') ?? '', 10)

  if (!book || !chapter) {
    return NextResponse.json({ error: 'book and chapter params required' }, { status: 400 })
  }

  const text = getChapterText(book, chapter)

  // Fetch all decks + their cards for this chapter
  const deckRows = (await sql`
    SELECT d.subcategory, c.spanish_term, c.english_answer
    FROM decks d
    JOIN cards c ON c.deck_id = d.id
    WHERE d.user_id = ${user.id} AND d.book_number = ${book} AND d.chapter_number = ${chapter}
  `) as Record<string, unknown>[]

  // Build a map of term → subcategory, preferring the most specific subcategory
  // Priority order (most specific first):
  const SUBCATEGORY_PRIORITY = [
    'verbs-subjunctive',
    'verbs-imperative',
    'verbs-conditional',
    'verbs-future',
    'verbs-perfect',
    'verbs-imperfect',
    'verbs-preterite',
    'verbs-present',
    'pronoun-composites',
    'adjectives',
    'nouns-b2',
    'nouns-b1',
    'nouns-a2',
    'nouns-a1',
    'nouns',
    'general',
  ]

  const termMap = new Map<string, { subcategory: string; translation: string }>()

  for (const row of deckRows as { subcategory: string | null; spanish_term: string; english_answer: string | null }[]) {
    const subcategory = row.subcategory ?? 'general'
    const term = row.spanish_term.toLowerCase()
    const translation = row.english_answer ?? ''
    const existing = termMap.get(term)
    if (!existing) {
      termMap.set(term, { subcategory, translation })
    } else {
      const existingPriority = SUBCATEGORY_PRIORITY.indexOf(existing.subcategory)
      const newPriority = SUBCATEGORY_PRIORITY.indexOf(subcategory)
      if (newPriority < existingPriority) {
        termMap.set(term, { subcategory, translation })
      }
    }
  }

  const terms = Array.from(termMap.entries()).map(([term, { subcategory, translation }]) => ({
    term,
    subcategory,
    translation,
  }))

  return NextResponse.json({ text, terms })
}
