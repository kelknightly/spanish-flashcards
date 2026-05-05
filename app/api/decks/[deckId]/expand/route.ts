import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAllowedEmail } from '@/lib/auth-api'
import { sql } from '@/lib/db'
import { getModel } from '@/lib/gemini'
import { buildDeckName, DECK_TYPES } from '@/data/books'
import { getChapterText } from '@/data/books/text-loader'

interface CardJson {
  spanish: string
  english: string
  sourceSentences?: Array<{ es: string; en: string }>
}

// ── Post-generation validators ───────────────────────────────────────────────

/** True if `sentence` contains `term` (strips leading articles for matching). */
function sentenceContainsTerm(sentence: string, term: string): boolean {
  const bare = term.replace(/^(el|la|los|las|un|una)\s+/i, '').trim()
  return sentence.toLowerCase().includes(bare.toLowerCase())
}

/** True if `term` is obviously the wrong tense for `subcategory` (regex-based). */
function hasObviousTenseMismatch(term: string, subcategory: string): boolean {
  const t = term.trim()
  if (subcategory === 'verbs-conditional') {
    // Must contain a word ending in -ría/-rías/-ríamos/-rían
    return !t.split(/\s+/).some(w => /ría$|rías$|ríamos$|rían$/i.test(w))
  }
  if (subcategory === 'verbs-perfect') {
    // Must contain he/has/ha/hemos/han as a standalone token
    const FINITE_HABER = new Set(['he', 'has', 'ha', 'hemos', 'han'])
    return !t.split(/\s+/).map(w => w.toLowerCase()).some(tok => FINITE_HABER.has(tok))
  }
  if (subcategory === 'verbs-future') {
    // Must contain a word ending in -ré/-rás/-rá/-remos/-rán
    return !t.split(/\s+/).some(w => /ré$|rás$|rá$|remos$|rán$/i.test(w))
  }
  if (subcategory === 'verbs-present') {
    const first = t.split(/\s+/)[0].toLowerCase()
    // Block obvious preterite (3rd person sg -ó, 3rd plural -aron/-ieron/-eron)
    if (/ó$/.test(first)) return true
    if (/aron$|ieron$|eron$/.test(first)) return true
    // Block gerunds
    if (/ando$|iendo$/.test(first)) return true
  }
  if (subcategory === 'verbs-imperfect') {
    const first = t.split(/\s+/)[0].toLowerCase()
    if (/ó$/.test(first)) return true
    if (/aron$|ieron$|eron$/.test(first)) return true
    if (/ando$|iendo$/.test(first)) return true
  }
  return false
}

/**
 * Validate and clean Gemini-generated cards:
 * 1. Remove source sentences where the `es` text does not contain the term.
 * 2. Remove cards that fail the regex tense check.
 */
function validateCards(cards: CardJson[], subcategory: string): CardJson[] {
  return cards
    .map((c) => ({
      ...c,
      sourceSentences: (c.sourceSentences ?? []).filter((s) =>
        sentenceContainsTerm(s.es, c.spanish)
      ),
    }))
    .filter((c) => !hasObviousTenseMismatch(c.spanish, subcategory))
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> }
) {
  void request
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { deckId } = await params

  // ── 1. Load the source deck ──────────────────────────────────────────────
  const sourceDeck = (await sql`
    SELECT id, name, book_number, chapter_number, subcategory, version, parent_deck_id
    FROM decks WHERE id = ${deckId} AND user_id = ${user.id}
  ` as Record<string, unknown>[])[0]

  if (!sourceDeck) {
    return NextResponse.json({ error: 'Deck not found' }, { status: 404 })
  }

  const sd = sourceDeck as Record<string, unknown>
  const { book_number, chapter_number, subcategory, version } = sd

  if (!book_number || !chapter_number || !subcategory) {
    return NextResponse.json(
      { error: 'This deck does not belong to a book chapter and cannot be expanded.' },
      { status: 400 }
    )
  }

  // ── 2. Verify all cards in this deck are mastered ────────────────────────
  const deckCards = (await sql`
    SELECT id, vocab_term_id, spanish_term FROM cards WHERE deck_id = ${deckId}
  `) as Record<string, unknown>[]
  if (!deckCards.length) {
    return NextResponse.json({ error: 'No cards found in deck.' }, { status: 400 })
  }

  const vocabTermIds = (deckCards as { vocab_term_id: string }[]).map((c) => c.vocab_term_id)

  const progressRows = (await sql`
    SELECT vocab_term_id, mastered_at FROM card_progress
    WHERE user_id = ${user.id} AND vocab_term_id = ANY(${vocabTermIds})
  `) as Record<string, unknown>[]
  const masteredSet = new Set(
    (progressRows as { vocab_term_id: string; mastered_at: string | null }[])
      .filter((p) => p.mastered_at)
      .map((p) => p.vocab_term_id)
  )
  const allMastered = vocabTermIds.every((id) => masteredSet.has(id))

  if (!allMastered) {
    return NextResponse.json({ error: 'Not all cards in this deck are mastered yet.' }, { status: 409 })
  }

  // ── 3. Collect all already-used Spanish terms across the lineage ─────────
  const rootDeckId = (sd.parent_deck_id as string | null) ?? deckId

  const relatedDecks = (await sql`
    SELECT id FROM decks
    WHERE user_id = ${user.id} AND (id = ${rootDeckId} OR parent_deck_id = ${rootDeckId})
  `) as Record<string, unknown>[]
  const relatedDeckIds = (relatedDecks as { id: string }[]).map((d) => d.id)

  const usedCards = (await sql`
    SELECT spanish_term FROM cards WHERE deck_id = ANY(${relatedDeckIds})
  `) as Record<string, unknown>[]
  const usedTerms = [...new Set((usedCards as { spanish_term: string }[]).map((c) => c.spanish_term.toLowerCase()))]

  // ── 4. Load chapter text ─────────────────────────────────────────────────
  const chapterText = getChapterText(book_number as number, chapter_number as number)
  if (!chapterText.trim()) {
    return NextResponse.json({ error: 'Chapter text is not yet loaded. Please add the chapter text first.' }, { status: 400 })
  }

  // ── 5. Build Gemini prompt for the deck type ─────────────────────────────
  const deckTypeInfo = DECK_TYPES.find((t) => t.subcategory === subcategory)
  const prompt = buildExtractionPrompt(
    subcategory as string,
    deckTypeInfo?.label ?? (subcategory as string),
    chapterText,
    usedTerms,
  )

  // ── 6. Call Gemini ───────────────────────────────────────────────────────
  let newCards: CardJson[]
  try {
    const model = getModel()
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const jsonText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(jsonText)
    if (!Array.isArray(parsed)) throw new Error('Expected JSON array')
    newCards = validateCards(parsed, subcategory as string)
  } catch (e) {
    return NextResponse.json(
      { error: `Gemini extraction failed: ${e instanceof Error ? e.message : 'unknown error'}` },
      { status: 500 }
    )
  }

  if (!newCards.length) {
    return NextResponse.json({ error: 'No additional vocabulary found in this chapter for this category.' }, { status: 409 })
  }

  // ── 7. Create new deck version ───────────────────────────────────────────
  const newVersion = ((version as number) ?? 1) + 1
  const newDeckName = buildDeckName(book_number as number, chapter_number as number, subcategory as string, newVersion)

  const newDeck = (await sql`
    INSERT INTO decks (user_id, name, book_number, chapter_number, category, subcategory, version, parent_deck_id, is_system_generated)
    VALUES (
      ${user.id}, ${newDeckName},
      ${book_number as number}, ${chapter_number as number},
      ${(subcategory as string).startsWith('verbs') ? 'verbs' : 'nouns'},
      ${subcategory as string}, ${newVersion},
      ${rootDeckId}, true
    )
    RETURNING id
  ` as Record<string, unknown>[])[0]

  if (!newDeck) {
    return NextResponse.json({ error: 'Failed to create deck' }, { status: 500 })
  }
  const newDeckId = (newDeck as { id: string }).id

  // ── 8. Upsert vocabulary terms + insert cards ────────────────────────────
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

  let insertedCount = 0
  for (let i = 0; i < newCards.length; i++) {
    const c = newCards[i]
    const termId = termIdMap.get(c.spanish.trim().toLowerCase())
    if (!termId) continue
    await sql`
      INSERT INTO cards (deck_id, vocab_term_id, spanish_term, english_answer, source_sentences, position)
      VALUES (
        ${newDeckId}, ${termId},
        ${c.spanish.trim()}, ${c.english.trim()},
        ${JSON.stringify(c.sourceSentences ?? [])}, ${i}
      )
    `
    insertedCount++
  }

  return NextResponse.json({ newDeckId, version: newVersion, cardCount: insertedCount })
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
    'verbs-present': 'Extract exactly 10 verbs conjugated in the PRESENT INDICATIVE tense (presente de indicativo) as they appear in the text. Valid examples: habla, comen, soy, voy, tiene, estoy, hay, puede. Do NOT include preterite, imperfect, or any past-tense forms.',
    'verbs-preterite': 'Extract exactly 10 verbs conjugated in the PRETERITE past tense (pretérito indefinido) as they appear in the text. E.g. habló, comieron, fue, tuvo.',
    'verbs-imperfect': 'Extract exactly 10 verbs conjugated in the IMPERFECT INDICATIVE tense (pretérito imperfecto de indicativo) as they appear in the text. Valid examples: hablaba, comían, era, tenía, vivía, había (there was). Do NOT include imperfect subjunctive (hubiera, tuviera) or preterite forms.',
    'verbs-future': 'Extract exactly 10 verbs conjugated in the FUTURE tense (futuro simple) as they appear in, or that are thematically relevant to, the text. Forms end in -ré/-rás/-rá/-remos/-rán. E.g. hablará, comeremos, será, tendrán.',
    'verbs-conditional': `Extract exactly 10 verbs conjugated in the CONDITIONAL tense (condicional simple) ONLY.
Valid forms end in: -ría, -rías, -ría, -ríamos, -rían. E.g. hablaría, comeríamos, sería, tendría, podría, diría, haría, vendría.
INVALID — DO NOT USE: infinitives (hablar), imperfect subjunctive (quisiera, hubiera, tuviera, entregara, fuera), future (hablará, volverás), preterite, present, or any non-conditional form.
Every "spanish" field MUST contain a word ending in -ría, -rías, -ríamos, or -rían.
If the text has few conditional forms, add thematically relevant conditional forms for verbs from the chapter.`,
    'verbs-perfect': `Extract exactly 10 verbs in the PRESENT PERFECT tense (pretérito perfecto compuesto) ONLY.
The auxiliary MUST be PRESENT TENSE haber: he, has, ha, hemos, han — followed by a past participle.
VALID: "ha llegado", "han visto", "hemos comido", "he dicho", "has ido".
INVALID: "había + participle" (that is pluperfect, NOT present perfect), "hubiera/haya + participle" (subjunctive), bare participles.
The "spanish" field MUST contain he/has/ha/hemos/han as a word.
If the text has few present-perfect forms, add thematically appropriate ones.`,
    'verbs-imperative': 'Extract exactly 10 verbs conjugated in the IMPERATIVE mood (imperativo) as they appear in, or that are thematically relevant to, the text. Imperative forms very commonly have clitic pronouns attached (e.g. "pásamelo", "dámelo", "cuéntame", "llévatelo") — when this is the case, ALWAYS card the full composite form exactly as it appears in the text.',
    'verbs-subjunctive': 'Extract exactly 10 verbs conjugated in the SUBJUNCTIVE mood (subjuntivo — present or imperfect) as they appear in, or that are thematically relevant to, the text. Present examples: hable, sea, tenga, vaya. Imperfect examples: hubiera, tuviera, dijera, fuera, pudiera.',
    'pronoun-composites': 'Extract exactly 10 composite pronoun constructions as they appear in the text — these are verb forms with one or two clitic pronouns attached (e.g. "pásamelo", "dáselo", "cuéntamelo", "llévatelo"). Card the full composite form exactly as written. The English translation should explain the verb meaning AND the pronouns (e.g. "pásamelo" → "pass it to me").',
  }

  const instruction = typeInstructions[subcategory] ?? `Extract exactly 10 ${label} from the text.`

  return `You are a Spanish language teacher creating flashcards for language learners.

${instruction}
${exclusionClause}

For each item provide:
- "spanish": the Spanish term exactly as it appears in the text (exact spelling and accents)
- "english": the English translation
- "sourceSentences": an array of 1–2 example sentences copied verbatim from the text (each with "es" and "en" keys).
  CRITICAL: each "es" sentence MUST contain the exact "spanish" term verbatim — same spelling, same accents, same word.
  Do NOT fabricate or paraphrase sentences. If no sentence in the text contains the exact term, set sourceSentences to [].

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
