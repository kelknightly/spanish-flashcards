import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { getChapterText } from '@/data/books/text-loader'
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

  const { searchParams } = new URL(request.url)
  const book = parseInt(searchParams.get('book') ?? '', 10)
  const chapter = parseInt(searchParams.get('chapter') ?? '', 10)

  if (!book || !chapter) {
    return NextResponse.json({ error: 'book and chapter params required' }, { status: 400 })
  }

  // Load chapter text from filesystem (server-only)
  const text = getChapterText(book, chapter)

  // Fetch all decks for this user/book/chapter, with their cards
  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: deckRows, error } = await sb
    .from('decks')
    .select('subcategory, cards(spanish_term, english_answer)')
    .eq('user_id', user.id)
    .eq('book_number', book)
    .eq('chapter_number', chapter)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Build a map of term → subcategory, preferring the most specific subcategory
  // Priority order (most specific first):
  const SUBCATEGORY_PRIORITY = [
    'verbs-subjunctive',
    'verbs-imperative',
    'verbs-conditional',
    'verbs-future',
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

  for (const deck of deckRows ?? []) {
    const subcategory = (deck.subcategory as string | null) ?? 'general'
    const cards = deck.cards as Array<{ spanish_term: string; english_answer: string | null }>
    for (const card of cards ?? []) {
      const term = card.spanish_term.toLowerCase()
      const translation = card.english_answer ?? ''
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
  }

  const terms = Array.from(termMap.entries()).map(([term, { subcategory, translation }]) => ({
    term,
    subcategory,
    translation,
  }))

  return NextResponse.json({ text, terms })
}
