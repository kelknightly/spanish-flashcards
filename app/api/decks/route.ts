import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAllowedEmail } from '@/lib/auth-api'
import { sql } from '@/lib/db'

interface CardInput {
  spanish: string
  english: string
  sourceSentences?: Array<{ es: string; en: string }>
}

interface DeckInput {
  deckName: string
  bookNumber?: number
  chapterNumber?: number
  category?: string
  subcategory?: string
  version?: number
  cards: CardInput[]
  chatSessionId?: string
  isCustom?: boolean
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: DeckInput
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { deckName, bookNumber, chapterNumber, category, subcategory, version, cards, chatSessionId, isCustom } = body

  if (!deckName?.trim() || !cards?.length) {
    return NextResponse.json({ error: 'deckName and cards are required' }, { status: 400 })
  }

  // 1. Create the deck
  const deck = (await sql`
    INSERT INTO decks (user_id, name, book_number, chapter_number, category, subcategory, version, is_custom)
    VALUES (
      ${user.id}, ${deckName.trim()},
      ${bookNumber ?? null}, ${chapterNumber ?? null},
      ${category ?? null}, ${subcategory ?? null},
      ${version ?? 1}, ${isCustom ?? false}
    )
    RETURNING id
  ` as Record<string, unknown>[])[0]
  const deckId = (deck as { id: string }).id

  // 2. Upsert vocabulary_terms (shared across decks by user)
  for (const c of cards) {
    await sql`
      INSERT INTO vocabulary_terms (user_id, spanish_term)
      VALUES (${user.id}, ${c.spanish.trim().toLowerCase()})
      ON CONFLICT (user_id, spanish_term) DO NOTHING
    `
  }

  // 3. Fetch the term IDs
  const spanishTerms = cards.map((c) => c.spanish.trim().toLowerCase())
  const termRows = (await sql`
    SELECT id, spanish_term FROM vocabulary_terms
    WHERE user_id = ${user.id} AND spanish_term = ANY(${spanishTerms})
  `) as Record<string, unknown>[]
  const termIdMap = new Map((termRows as { id: string; spanish_term: string }[]).map((r) => [r.spanish_term, r.id]))

  // 4. Insert cards
  let insertedCount = 0
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]
    const termId = termIdMap.get(c.spanish.trim().toLowerCase())
    if (!termId) continue
    await sql`
      INSERT INTO cards (deck_id, vocab_term_id, spanish_term, english_answer, source_sentences, position)
      VALUES (
        ${deckId}, ${termId},
        ${c.spanish.trim()}, ${c.english.trim()},
        ${JSON.stringify(c.sourceSentences ?? [])}, ${i}
      )
    `
    insertedCount++
  }

  // 5. Link chat session to deck if provided
  if (chatSessionId) {
    await sql`
      UPDATE chat_sessions SET deck_id = ${deckId}
      WHERE id = ${chatSessionId} AND user_id = ${user.id}
    `
  }

  return NextResponse.json({ deckId, cardCount: insertedCount })
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const bookFilter = searchParams.get('book') ? parseInt(searchParams.get('book')!) : null
  const chapterFilter = searchParams.get('chapter') ? parseInt(searchParams.get('chapter')!) : null

  const rows = (await sql`
    SELECT
      id, name, book_number, chapter_number, category, subcategory,
      version, is_system_generated, is_custom, parent_deck_id,
      created_at, last_studied_at
    FROM decks
    WHERE user_id = ${user.id}
      AND (${bookFilter} IS NULL OR book_number = ${bookFilter})
      AND (${chapterFilter} IS NULL OR chapter_number = ${chapterFilter})
    ORDER BY
      book_number    ASC NULLS LAST,
      chapter_number ASC NULLS LAST,
      subcategory    ASC NULLS LAST,
      version        ASC
  `) as Record<string, unknown>[]

  const deckIds = (rows as { id: string }[]).map((d) => d.id)

  // Mastery stats (inline replacement for the get_deck_mastery_stats RPC)
  const masteryMap: Record<string, { total: number; mastered: number; reviewed: number }> = {}

  if (deckIds.length > 0) {
    const masteryRows = (await sql`
      SELECT
        c.deck_id,
        COUNT(DISTINCT c.id)                                                  AS total_cards,
        COUNT(DISTINCT CASE WHEN cp.mastered_at IS NOT NULL THEN c.id END)    AS mastered_cards,
        COUNT(DISTINCT CASE WHEN cp.id          IS NOT NULL THEN c.id END)    AS reviewed_cards
      FROM cards c
      LEFT JOIN card_progress cp
        ON cp.vocab_term_id = c.vocab_term_id AND cp.user_id = ${user.id}
      WHERE c.deck_id = ANY(${deckIds})
      GROUP BY c.deck_id
    `) as Record<string, unknown>[]
    for (const r of masteryRows as { deck_id: string; total_cards: string; mastered_cards: string; reviewed_cards: string }[]) {
      masteryMap[r.deck_id] = {
        total: Number(r.total_cards),
        mastered: Number(r.mastered_cards),
        reviewed: Number(r.reviewed_cards),
      }
    }
  }

  const decks = (rows as Record<string, unknown>[]).map((d) => {
    const m = masteryMap[d.id as string] ?? { total: 0, mastered: 0, reviewed: 0 }
    return {
      id: d.id,
      name: d.name,
      book_number: d.book_number,
      chapter_number: d.chapter_number,
      category: d.category,
      subcategory: d.subcategory,
      version: d.version ?? 1,
      is_system_generated: d.is_system_generated ?? false,
      is_custom: d.is_custom ?? false,
      parent_deck_id: d.parent_deck_id ?? null,
      created_at: d.created_at,
      last_studied_at: d.last_studied_at,
      card_count: m.total,
      mastered_count: m.mastered,
      reviewed_count: m.reviewed,
    }
  })

  return NextResponse.json({ decks })
}
