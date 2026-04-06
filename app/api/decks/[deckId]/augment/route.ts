import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { createClient } from '@supabase/supabase-js'
import { getModel } from '@/lib/gemini'
import { DECK_TYPES } from '@/data/books'
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

  // ── 1. Load the deck ─────────────────────────────────────────────────────
  const { data: deck, error: deckErr } = await sb
    .from('decks')
    .select('id, name, book_number, chapter_number, subcategory, user_id')
    .eq('id', deckId)
    .eq('user_id', user.id)
    .single()

  if (deckErr || !deck) {
    return NextResponse.json({ error: 'Deck not found' }, { status: 404 })
  }

  const { book_number, chapter_number, subcategory } = deck
  if (!book_number || !chapter_number || !subcategory) {
    return NextResponse.json(
      { error: 'This deck does not belong to a book chapter and cannot be augmented.' },
      { status: 400 }
    )
  }

  // ── 2. Collect all already-used Spanish terms in this deck ───────────────
  const { data: existingCards } = await sb
    .from('cards')
    .select('spanish_term')
    .eq('deck_id', deckId)

  const usedTerms = [...new Set((existingCards ?? []).map((c) => c.spanish_term.toLowerCase()))]

  // Get the highest position so new cards go after existing ones
  const { data: positionRows } = await sb
    .from('cards')
    .select('position')
    .eq('deck_id', deckId)
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = positionRows?.[0]?.position != null ? positionRows[0].position + 1 : 0

  // ── 3. Load chapter text ─────────────────────────────────────────────────
  const chapterText = getChapterText(book_number, chapter_number)
  if (!chapterText.trim()) {
    return NextResponse.json(
      { error: 'Chapter text is not yet loaded for this deck.' },
      { status: 400 }
    )
  }

  // ── 4. Build Gemini prompt ───────────────────────────────────────────────
  const deckTypeInfo = DECK_TYPES.find((t) => t.subcategory === subcategory)
  const prompt = buildExtractionPrompt(
    subcategory,
    deckTypeInfo?.label ?? subcategory,
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

  // ── 7. Insert cards directly into this deck ──────────────────────────────
  const cardRows = newCards
    .map((c, i) => {
      const termId = termIdMap.get(c.spanish.trim().toLowerCase())
      if (!termId) return null
      return {
        deck_id: deckId,
        vocab_term_id: termId,
        spanish_term: c.spanish.trim(),
        english_answer: c.english.trim(),
        source_sentences: c.sourceSentences ?? [],
        position: nextPosition + i,
      }
    })
    .filter(Boolean)

  const { error: cardsInsertErr } = await sb.from('cards').insert(cardRows)
  if (cardsInsertErr) {
    return NextResponse.json({ error: cardsInsertErr.message }, { status: 500 })
  }

  return NextResponse.json({ addedCount: cardRows.length })
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
- "spanish": the Spanish term exactly as it appears in (or is derived from) the text
- "english": the English translation  
- "sourceSentences": an array of 1–2 example sentences from the text (each with "es" and "en" keys)

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
