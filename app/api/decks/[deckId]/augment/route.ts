import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAllowedEmail } from '@/lib/auth-api'
import { sql } from '@/lib/db'
import { getModel } from '@/lib/gemini'
import { DECK_TYPES } from '@/data/books'
import { getChapterText } from '@/data/books/text-loader'

interface CardJson {
  spanish: string
  english: string
  sourceSentences?: Array<{ es: string; en: string }>
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> }
) {
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { deckId } = await params

  // ── 1. Load the deck ─────────────────────────────────────────────────────
  const deck = (await sql`
    SELECT id, name, book_number, chapter_number, subcategory, user_id
    FROM decks WHERE id = ${deckId} AND user_id = ${user.id}
  ` as Record<string, unknown>[])[0]

  if (!deck) {
    return NextResponse.json({ error: 'Deck not found' }, { status: 404 })
  }

  const { book_number, chapter_number, subcategory } = deck as Record<string, unknown>
  if (!book_number || !chapter_number || !subcategory) {
    return NextResponse.json(
      { error: 'This deck does not belong to a book chapter and cannot be augmented.' },
      { status: 400 }
    )
  }

  // ── 2. Collect already-used terms and current max position ───────────────
  const existingCards = (await sql`SELECT spanish_term, position FROM cards WHERE deck_id = ${deckId}`) as { spanish_term: string; position: number }[]
  const usedTerms = [...new Set(existingCards.map((c) => c.spanish_term.toLowerCase()))]
  const maxPos = existingCards.length > 0
    ? Math.max(...existingCards.map((c) => c.position))
    : -1
  const nextPosition = maxPos + 1

  // ── 3. Load chapter text ─────────────────────────────────────────────────
  const chapterText = getChapterText(book_number as number, chapter_number as number)
  if (!chapterText.trim()) {
    return NextResponse.json({ error: 'Chapter text is not yet loaded for this deck.' }, { status: 400 })
  }

  // ── 4. Build Gemini prompt ───────────────────────────────────────────────
  const deckTypeInfo = DECK_TYPES.find((t) => t.subcategory === subcategory)
  const prompt = buildExtractionPrompt(
    subcategory as string,
    deckTypeInfo?.label ?? (subcategory as string),
    chapterText,
    usedTerms,
  )

  // ── 5. Call Gemini ───────────────────────────────────────────────────────
  let newCards: CardJson[]
  try {
    const model = getModel()
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    newCards = JSON.parse(jsonText)
    if (!Array.isArray(newCards)) throw new Error('Expected JSON array')
  } catch (e) {
    return NextResponse.json(
      { error: `Gemini extraction failed: ${e instanceof Error ? e.message : 'unknown error'}` },
      { status: 500 }
    )
  }

  if (!newCards.length) {
    return NextResponse.json(
      { error: 'No additional vocabulary found in this chapter for this category.' },
      { status: 409 }
    )
  }

  // ── 6. Upsert vocabulary terms ───────────────────────────────────────────
  for (const c of newCards) {
    await sql`
      INSERT INTO vocabulary_terms (user_id, spanish_term)
      VALUES (${user.id}, ${c.spanish.trim().toLowerCase()})
      ON CONFLICT (user_id, spanish_term) DO NOTHING
    `
  }

  const spanishTerms = newCards.map((c) => c.spanish.trim().toLowerCase())
  const termRows = (await sql`
    SELECT id, spanish_term FROM vocabulary_terms
    WHERE user_id = ${user.id} AND spanish_term = ANY(${spanishTerms})
  `) as Record<string, unknown>[]
  const termIdMap = new Map((termRows as { id: string; spanish_term: string }[]).map((r) => [r.spanish_term, r.id]))

  // ── 7. Insert cards ──────────────────────────────────────────────────────
  let addedCount = 0
  for (let i = 0; i < newCards.length; i++) {
    const c = newCards[i]
    const termId = termIdMap.get(c.spanish.trim().toLowerCase())
    if (!termId) continue
    await sql`
      INSERT INTO cards (deck_id, vocab_term_id, spanish_term, english_answer, source_sentences, position)
      VALUES (
        ${deckId}, ${termId},
        ${c.spanish.trim()}, ${c.english.trim()},
        ${JSON.stringify(c.sourceSentences ?? [])}, ${nextPosition + i}
      )
    `
    addedCount++
  }

  return NextResponse.json({ addedCount })
}

function buildExtractionPrompt(
  subcategory: string,
  label: string,
  chapterText: string,
  excludeTerms: string[],
): string {
  const exclusionClause =
    excludeTerms.length > 0
      ? `Do NOT include any of these already-studied terms: ${excludeTerms.slice(0, 60).join(', ')}.`
      : ''

  const typeInstructions: Record<string, string> = {
    'nouns': 'Extract exactly 10 common nouns (sustantivos) that appear in or are directly relevant to the text. Include the article (el/la) with each noun.',
    'nouns-a1': 'Extract exactly 10 A1-level common nouns (sustantivos) from or relevant to the text. Include the article (el/la) with each noun.',
    'nouns-a2': 'Extract exactly 10 A2-level nouns (sustantivos) from or relevant to the text. Include the article (el/la) with each noun.',
    'nouns-b1': 'Extract exactly 10 B1-level nouns (sustantivos) from or relevant to the text. Include the article (el/la) with each noun.',
    'nouns-b2': 'Extract exactly 10 B2-level nouns (sustantivos) from or relevant to the text. Include the article (el/la) with each noun.',
    'verbs-present': 'Extract exactly 10 verbs conjugated in the present tense (presente de indicativo) as they appear in the text.',
    'verbs-preterite': 'Extract exactly 10 verbs conjugated in the preterite past tense (pretérito indefinido) as they appear in the text.',
    'verbs-imperfect': 'Extract exactly 10 verbs conjugated in the imperfect past tense (pretérito imperfecto) as they appear in the text.',
    'verbs-future': 'Extract exactly 10 verbs conjugated in the future tense (futuro simple) as they appear in, or that are thematically relevant to, the text.',
    'verbs-conditional': 'Extract exactly 10 verbs conjugated in the conditional tense (condicional simple) as they appear in, or that are thematically relevant to, the text.',
    'verbs-imperative': 'Extract exactly 10 verbs conjugated in the imperative mood (imperativo) as they appear in, or that are thematically relevant to, the text.',
    'verbs-subjunctive': 'Extract exactly 10 verbs conjugated in the subjunctive mood (subjuntivo) as they appear in, or that are thematically relevant to, the text.',
    'adjectives': 'Extract exactly 10 adjectives (adjetivos) that appear in or are directly relevant to the text.',
    'pronoun-composites': 'Extract exactly 10 verb+clitic composite forms from the text — conjugated verbs with one or two object pronouns directly attached (e.g. "dímelo", "pásamelo", "dáselo", "cuéntame", "llévatelo"). The "spanish" field must be ONLY the composite verb form itself (never a full sentence or phrase). The "english" field should translate both the verb and the pronouns (e.g. "dímelo" → "tell it to me").'
  }

  const instruction = typeInstructions[subcategory] ?? `Extract exactly 10 ${label} from the text.`

  return `You are a Spanish language teacher creating flashcards for language learners.

${instruction}
${exclusionClause}

For each item provide:
- "spanish": the Spanish term exactly as it appears in the text (exact spelling and accents)
- "english": the English translation
- "sourceSentences": an array of 1–2 example sentences copied verbatim from the text (each with "es" and "en" keys). CRITICAL: each "es" sentence MUST contain the exact "spanish" term verbatim — same spelling, same accents. Do NOT use a sentence that contains a different conjugation or form of the word; if no sentence contains the exact term, omit sourceSentences entirely.

Return ONLY valid JSON — an array of exactly 10 objects. No markdown, no explanation.

Example format:
[
  {
    "spanish": "corría",
    "english": "was running / used to run",
    "sourceSentences": [
      { "es": "El niño corría por el bosque.", "en": "The child was running through the forest." }
    ]
  }
]

TEXT:
${chapterText}`
}
