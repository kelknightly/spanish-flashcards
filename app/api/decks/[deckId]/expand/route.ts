import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { createClient } from '@supabase/supabase-js'
import { getModel } from '@/lib/gemini'
import { buildDeckName, DECK_TYPES } from '@/data/books'
import { getChapterText } from '@/data/books/text-loader'

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

interface CardJson {
  spanish: string
  english: string
  sourceSentences?: Array<{ es: string; en: string }>
}

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

  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  // ── 1. Load the source deck ──────────────────────────────────────────────
  const { data: sourceDeck, error: deckErr } = await sb
    .from('decks')
    .select('id, name, book_number, chapter_number, subcategory, version, parent_deck_id, user_id')
    .eq('id', deckId)
    .eq('user_id', user.id)
    .single()

  if (deckErr || !sourceDeck) {
    return NextResponse.json({ error: 'Deck not found' }, { status: 404 })
  }

  const { book_number, chapter_number, subcategory, version } = sourceDeck
  if (!book_number || !chapter_number || !subcategory) {
    return NextResponse.json(
      { error: 'This deck does not belong to a book chapter and cannot be expanded.' },
      { status: 400 }
    )
  }

  // ── 2. Verify all cards in this deck are mastered ────────────────────────
  const { data: deckCards, error: cardsErr } = await sb
    .from('cards')
    .select('id, vocab_term_id, spanish_term')
    .eq('deck_id', deckId)

  if (cardsErr || !deckCards?.length) {
    return NextResponse.json({ error: 'No cards found in deck.' }, { status: 400 })
  }

  const vocabTermIds = deckCards.map((c) => c.vocab_term_id)

  const { data: progressRows, error: progressErr } = await sb
    .from('card_progress')
    .select('vocab_term_id, mastered_at')
    .eq('user_id', user.id)
    .in('vocab_term_id', vocabTermIds)

  if (progressErr) {
    return NextResponse.json({ error: progressErr.message }, { status: 500 })
  }

  const masteredSet = new Set(
    (progressRows ?? []).filter((p) => p.mastered_at).map((p) => p.vocab_term_id)
  )
  const allMastered = vocabTermIds.every((id) => masteredSet.has(id))

  if (!allMastered) {
    return NextResponse.json(
      { error: 'Not all cards in this deck are mastered yet.' },
      { status: 409 }
    )
  }

  // ── 3. Collect ALL already-used Spanish terms across the lineage ─────────
  // Find the root deck (either this deck or its ancestor)
  const rootDeckId = sourceDeck.parent_deck_id ?? sourceDeck.id

  // Fetch all decks in this lineage
  const { data: relatedDecks } = await sb
    .from('decks')
    .select('id')
    .or(`id.eq.${rootDeckId},parent_deck_id.eq.${rootDeckId}`)
    .eq('user_id', user.id)

  const relatedDeckIds = (relatedDecks ?? []).map((d) => d.id)

  const { data: usedCards } = await sb
    .from('cards')
    .select('spanish_term')
    .in('deck_id', relatedDeckIds)

  const usedTerms = [...new Set((usedCards ?? []).map((c) => c.spanish_term.toLowerCase()))]

  // ── 4. Load chapter text ─────────────────────────────────────────────────
  const chapterText = getChapterText(book_number, chapter_number)
  if (!chapterText.trim()) {
    return NextResponse.json(
      { error: 'Chapter text is not yet loaded. Please add the chapter text first.' },
      { status: 400 }
    )
  }

  // ── 5. Build Gemini prompt for the deck type ─────────────────────────────
  const deckTypeInfo = DECK_TYPES.find((t) => t.subcategory === subcategory)
  const prompt = buildExtractionPrompt(
    subcategory,
    deckTypeInfo?.label ?? subcategory,
    chapterText,
    usedTerms,
  )

  // ── 6. Call Gemini ───────────────────────────────────────────────────────
  let newCards: CardJson[]
  try {
    const model = getModel()
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    // Strip markdown code fences if present
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

  // ── 7. Create new deck version ───────────────────────────────────────────
  const newVersion = (version ?? 1) + 1
  const newDeckName = buildDeckName(book_number, chapter_number, subcategory, newVersion)

  const { data: newDeck, error: newDeckErr } = await sb
    .from('decks')
    .insert({
      user_id: user.id,
      name: newDeckName,
      book_number,
      chapter_number,
      category: sourceDeck.subcategory?.startsWith('verbs') ? 'verbs' : 'nouns',
      subcategory,
      version: newVersion,
      parent_deck_id: rootDeckId,
      is_system_generated: true,
    })
    .select('id')
    .single()

  if (newDeckErr || !newDeck) {
    return NextResponse.json({ error: newDeckErr?.message ?? 'Failed to create deck' }, { status: 500 })
  }

  const newDeckId = newDeck.id

  // ── 8. Upsert vocabulary terms + insert cards ────────────────────────────
  const terms = newCards.map((c) => ({
    user_id: user.id,
    spanish_term: c.spanish.trim().toLowerCase(),
  }))

  await sb
    .from('vocabulary_terms')
    .upsert(terms, { onConflict: 'user_id,spanish_term', ignoreDuplicates: true })

  const spanishTerms = terms.map((t) => t.spanish_term)
  const { data: termRows } = await sb
    .from('vocabulary_terms')
    .select('id, spanish_term')
    .eq('user_id', user.id)
    .in('spanish_term', spanishTerms)

  const termIdMap = new Map((termRows ?? []).map((r) => [r.spanish_term, r.id]))

  const cardRows = newCards
    .map((c, i) => {
      const termId = termIdMap.get(c.spanish.trim().toLowerCase())
      if (!termId) return null
      return {
        deck_id: newDeckId,
        vocab_term_id: termId,
        spanish_term: c.spanish.trim(),
        english_answer: c.english.trim(),
        source_sentences: c.sourceSentences ?? [],
        position: i,
      }
    })
    .filter(Boolean)

  const { error: cardsInsertErr } = await sb.from('cards').insert(cardRows)
  if (cardsInsertErr) {
    return NextResponse.json({ error: cardsInsertErr.message }, { status: 500 })
  }

  return NextResponse.json({ newDeckId, version: newVersion, cardCount: cardRows.length })
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
    'verbs-present': 'Extract exactly 10 verbs conjugated in the present tense (presente de indicativo) as they appear in the text. If a verb appears with attached clitic pronouns (e.g. "dímelo", "cuéntame"), card the full combined form exactly as written — do NOT split off the pronouns.',
    'verbs-preterite': 'Extract exactly 10 verbs conjugated in the preterite past tense (pretérito indefinido) as they appear in the text. If a verb appears with attached clitic pronouns (e.g. "díjomelo"), card the full combined form exactly as written.',
    'verbs-imperfect': 'Extract exactly 10 verbs conjugated in the imperfect past tense (pretérito imperfecto) as they appear in the text. If a verb appears with attached clitic pronouns, card the full combined form exactly as written.',
    'verbs-future': 'Extract exactly 10 verbs conjugated in the future tense (futuro simple) as they appear in, or that are thematically relevant to, the text.',
    'verbs-conditional': 'Extract exactly 10 verbs conjugated in the conditional tense (condicional simple) as they appear in, or that are thematically relevant to, the text.',
    'verbs-imperative': 'Extract exactly 10 verbs conjugated in the imperative mood (imperativo) as they appear in, or that are thematically relevant to, the text. Imperative forms very commonly have clitic pronouns attached (e.g. "pásamelo", "dámelo", "cuéntame", "llévatelo") — when this is the case, ALWAYS card the full composite form exactly as it appears in the text. Do NOT card just the bare imperative (e.g. do not card "pasa" when "pásamelo" appears).',
    'verbs-subjunctive': 'Extract exactly 10 verbs conjugated in the subjunctive mood (subjuntivo) as they appear in, or that are thematically relevant to, the text.',
    'pronoun-composites': 'Extract exactly 10 composite pronoun constructions as they appear in the text — these are verb forms with one or two clitic pronouns attached (e.g. "pásamelo", "dáselo", "cuéntamelo", "llévatelo"). Card the full composite form exactly as written. The English translation should explain the verb meaning AND the pronouns (e.g. "pásamelo" → "pass it to me").',
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
