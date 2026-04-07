/**
 * scripts/seed-decks.ts
 *
 * One-time script to pre-generate all default flashcard decks for both
 * Narnia books using the Gemini API and insert them into Supabase.
 *
 * Usage:
 *   npx tsx scripts/seed-decks.ts --user-id <USER_UUID>
 *
 * Required environment variables (in .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   ← get from Supabase Dashboard → Settings → API
 *   GEMINI_API_KEY
 *
 * The script is IDEMPOTENT — it skips any (book, chapter, subcategory, v1)
 * deck that already exists for the given user.
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { books, DECK_TYPES, buildDeckName } from '../src/data/books/index.js'
import { getChapterText } from '../src/data/books/text-loader.js'

// ── Env vars ───────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name]?.trim()
  if (!val) {
    console.error(`\n❌  Missing required environment variable: ${name}`)
    console.error('    Set it in your .env.local file.\n')
    process.exit(1)
  }
  return val
}

// Load .env.local if available (Next.js convention).
// Install dotenv first if needed:  npm install --save-dev dotenv
// Then run with:  npx tsx --env-file=.env.local scripts/seed-decks.ts --user-id <UUID>
// OR:            node --env-file=.env.local (Node ≥ 20.12)

const supabaseUrl     = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
const serviceRoleKey  = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const geminiApiKey    = requireEnv('GEMINI_API_KEY')

// ── CLI args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const userIdIdx = args.indexOf('--user-id')
if (userIdIdx === -1 || !args[userIdIdx + 1]) {
  console.error('\nUsage: npx tsx scripts/seed-decks.ts --user-id <USER_UUID> [--book <N>] [--chapters <N-M|N>]\n')
  process.exit(1)
}
const USER_ID = args[userIdIdx + 1]

// Optional filters: --book 2 --chapters 1-2  OR  --chapters 3
const bookFilterIdx = args.indexOf('--book')
const BOOK_FILTER = bookFilterIdx !== -1 ? parseInt(args[bookFilterIdx + 1], 10) : null

const chaptersFilterIdx = args.indexOf('--chapters')
let CHAPTER_MIN: number | null = null
let CHAPTER_MAX: number | null = null
if (chaptersFilterIdx !== -1) {
  const chapArg = args[chaptersFilterIdx + 1]
  const parts = chapArg.split('-').map(Number)
  CHAPTER_MIN = parts[0]
  CHAPTER_MAX = parts.length > 1 ? parts[1] : parts[0]
}

const subcategoryFilterIdx = args.indexOf('--subcategory')
const SUBCATEGORY_FILTER = subcategoryFilterIdx !== -1 ? args[subcategoryFilterIdx + 1] : null

// ── Clients ────────────────────────────────────────────────────────────────

const sb = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

const genAI = new GoogleGenerativeAI(geminiApiKey)
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generationConfig: { thinkingConfig: { thinkingBudget: 0 } } as any,
})

// ── Prompt builder ─────────────────────────────────────────────────────────

const TYPE_INSTRUCTIONS: Record<string, string> = {
  'nouns':
    'Extract exactly 10 common nouns (sustantivos) that appear in or are directly relevant to the text. Include the article (el/la) with each noun.',
  'nouns-a1':
    'Extract exactly 10 nouns at CEFR A1 level that appear in the text. A1 nouns are the most basic, everyday words (e.g. body parts, family, colours, numbers, simple objects). Include the article (el/la) with each noun. All nouns must appear in the text.',
  'nouns-a2':
    'Extract exactly 10 nouns at CEFR A2 level that appear in the text. A2 nouns are elementary vocabulary beyond the very basics — familiar objects, routine actions, simple environments (house, school, town). Include the article (el/la) with each noun. All nouns must appear in the text.',
  'nouns-b1':
    'Extract exactly 10 nouns at CEFR B1 level that appear in the text. B1 nouns go beyond everyday basics — intermediate vocabulary such as emotions, places, social concepts, and concrete objects that require some learning. Include the article (el/la) with each noun. All nouns must appear in the text.',
  'nouns-b2':
    'Extract exactly 10 nouns at CEFR B2 level that appear in the text. B2 nouns are upper-intermediate: abstract ideas, nuanced feelings, literary or topic-specific terms. Include the article (el/la) with each noun. All nouns must appear in the text.',
  'verbs-present':
    'Extract exactly 10 verbs conjugated in the present tense (presente de indicativo) as they appear in the text.',
  'verbs-perfect':
    'Extract exactly 10 verbs conjugated in the pretérito perfecto compuesto (present perfect) as they appear in the text. Each entry must be the full two-word form: the conjugated auxiliary haber (he/has/ha/hemos/habéis/han) followed immediately by the past participle (e.g. "he caminado", "ha llegado", "hemos visto"). The "spanish" field must contain the complete two-word combination exactly as it appears in the text.',
  'verbs-preterite':
    'Extract exactly 10 verbs conjugated in the preterite past tense (pretérito indefinido) as they appear in the text.',
  'verbs-imperfect':
    'Extract exactly 10 verbs conjugated in the imperfect past tense (pretérito imperfecto) as they appear in the text.',
  'verbs-future':
    'Extract exactly 10 verbs conjugated in the future tense (futuro simple) as they appear in, or that are thematically relevant to, the text.',
  'verbs-conditional':
    'Extract exactly 10 verbs conjugated in the conditional tense (condicional simple) as they appear in, or that are thematically relevant to, the text.',
  'verbs-imperative':
    'Extract exactly 10 verbs conjugated in the imperative mood (imperativo) as they appear in, or that are thematically relevant to, the text.',
  'verbs-subjunctive':
    'Extract exactly 10 verbs conjugated in the subjunctive mood (subjuntivo) as they appear in, or that are thematically relevant to, the text.',
  'adjectives':
    'Extract exactly 10 adjectives (adjetivos) that appear in or are directly relevant to the text. Provide the masculine singular form as the headword.',
  'pronoun-composites':
    'Extract exactly 10 verb+clitic composite forms from the text — these are conjugated verbs with one or two object pronouns directly attached (e.g. "dímelo", "pásamelo", "dáselo", "cuéntame", "llévatelo"). The "spanish" field must be ONLY the composite verb form itself (e.g. "dímelo"), never a full sentence or phrase. The "english" field should translate both the verb and the pronouns (e.g. "dímelo" → "tell it to me"). If the text contains fewer than 10 such forms, use the closest thematically relevant forms from the chapter.',
}

function buildPrompt(subcategory: string, chapterText: string, excludeTerms: Set<string> = new Set()): string {
  const instruction =
    TYPE_INSTRUCTIONS[subcategory] ??
    `Extract exactly 10 items of category "${subcategory}" from the text.`

  const exclusionClause = excludeTerms.size > 0
    ? `\nIMPORTANT: The following terms have already been assigned to other noun decks for this chapter — do NOT include any of them: ${[...excludeTerms].join(', ')}.\n`
    : ''

  return `You are a Spanish language teacher creating flashcards for language learners.

${instruction}${exclusionClause}

For each item provide:
- "spanish": the Spanish term exactly as it appears in the text (exact spelling and accents)
- "english": the English translation
- "sourceSentences": an array of 1–2 example sentences copied verbatim from the text (each with "es" and "en" keys). CRITICAL: each "es" sentence MUST contain the exact "spanish" term verbatim — same spelling, same accents. Do NOT use a sentence that contains a different conjugation or form of the word; if no sentence contains the exact term, omit sourceSentences entirely.

Return ONLY valid JSON — an array of exactly 10 objects. No markdown, no explanation.

TEXT:
${chapterText}`
}

// ── Core logic ─────────────────────────────────────────────────────────────

interface CardJson {
  spanish: string
  english: string
  sourceSentences?: Array<{ es: string; en: string }>
}

async function extractCards(subcategory: string, text: string, excludeTerms: Set<string> = new Set()): Promise<CardJson[]> {
  const prompt = buildPrompt(subcategory, text, excludeTerms)
  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim()
  const jsonText = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  const parsed = JSON.parse(jsonText)
  if (!Array.isArray(parsed)) throw new Error('Response is not a JSON array')
  return parsed
}

async function ensureVocabTerms(cards: CardJson[]): Promise<Map<string, string>> {
  const terms = cards.map((c) => ({
    user_id: USER_ID,
    spanish_term: c.spanish.trim().toLowerCase(),
  }))

  await sb
    .from('vocabulary_terms')
    .upsert(terms, { onConflict: 'user_id,spanish_term', ignoreDuplicates: true })

  const { data: termRows, error } = await sb
    .from('vocabulary_terms')
    .select('id, spanish_term')
    .eq('user_id', USER_ID)
    .in('spanish_term', terms.map((t) => t.spanish_term))

  if (error) throw new Error(`Term fetch failed: ${error.message}`)
  return new Map((termRows ?? []).map((r) => [r.spanish_term, r.id]))
}

/** Fetch the lowercase Spanish terms from an already-seeded deck (for exclusion tracking). */
async function fetchExistingDeckTerms(
  bookNumber: number,
  chapterNumber: number,
  subcategory: string,
): Promise<Set<string>> {
  const { data: deck } = await sb
    .from('decks')
    .select('id')
    .eq('user_id', USER_ID)
    .eq('book_number', bookNumber)
    .eq('chapter_number', chapterNumber)
    .eq('subcategory', subcategory)
    .eq('version', 1)
    .maybeSingle()

  if (!deck) return new Set()

  const { data: cards } = await sb
    .from('cards')
    .select('spanish_term')
    .eq('deck_id', deck.id)

  return new Set((cards ?? []).map((c: { spanish_term: string }) => c.spanish_term.trim().toLowerCase()))
}

async function seedChapterDeck(
  bookNumber: number,
  chapterNumber: number,
  subcategory: string,
  chapterText: string,
  usedTerms: Set<string> = new Set(),
): Promise<Set<string>> {
  /** Returns the set of lowercase Spanish terms that ended up in this deck. */
  const deckName = buildDeckName(bookNumber, chapterNumber, subcategory, 1)
  const category = DECK_TYPES.find((t) => t.subcategory === subcategory)?.category ?? 'general'

  // Idempotency check
  const { data: existing } = await sb
    .from('decks')
    .select('id')
    .eq('user_id', USER_ID)
    .eq('book_number', bookNumber)
    .eq('chapter_number', chapterNumber)
    .eq('subcategory', subcategory)
    .eq('version', 1)
    .maybeSingle()

  if (existing) {
    console.log(`  ⏭  Already exists: ${deckName}`)
    // Return the existing deck's terms so they can be excluded from later decks.
    return fetchExistingDeckTerms(bookNumber, chapterNumber, subcategory)
  }

  // Extract cards via Gemini (excluding terms already claimed by earlier noun decks)
  let cards: CardJson[]
  try {
    cards = await extractCards(subcategory, chapterText, usedTerms)
  } catch (err) {
    console.error(`  ❌  Gemini error for ${deckName}: ${err}`)
    return new Set()
  }

  if (!cards.length) {
    console.warn(`  ⚠️   No cards returned for ${deckName}, skipping.`)
    return new Set()
  }

  // Create deck
  const { data: deck, error: deckErr } = await sb
    .from('decks')
    .insert({
      user_id: USER_ID,
      name: deckName,
      book_number: bookNumber,
      chapter_number: chapterNumber,
      category,
      subcategory,
      version: 1,
      is_system_generated: true,
    })
    .select('id')
    .single()

  if (deckErr || !deck) {
    console.error(`  ❌  Failed to create deck ${deckName}: ${deckErr?.message}`)
    return new Set()
  }

  // Upsert vocabulary terms and get IDs
  const termIdMap = await ensureVocabTerms(cards)

  // Insert cards
  const cardRows = cards
    .map((c, i) => {
      const termId = termIdMap.get(c.spanish.trim().toLowerCase())
      if (!termId) return null
      return {
        deck_id: deck.id,
        vocab_term_id: termId,
        spanish_term: c.spanish.trim(),
        english_answer: c.english.trim(),
        source_sentences: c.sourceSentences ?? [],
        position: i,
      }
    })
    .filter(Boolean)

  const { error: cardsErr } = await sb.from('cards').insert(cardRows)
  if (cardsErr) {
    console.error(`  ❌  Card insert failed for ${deckName}: ${cardsErr.message}`)
    return new Set()
  }

  console.log(`  ✅  Created: ${deckName} (${cardRows.length} cards)`)

  // Return the terms seeded so callers can exclude them from subsequent noun decks.
  return new Set(cards.map((c) => c.spanish.trim().toLowerCase()))
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log(`\n🌟  Seeding Narnia flashcard decks for user ${USER_ID}\n`)

let totalCreated = 0
let totalSkipped = 0

for (const book of books) {
  if (BOOK_FILTER !== null && book.bookNumber !== BOOK_FILTER) continue

  for (const chapter of book.chapters) {
    if (CHAPTER_MIN !== null && CHAPTER_MAX !== null &&
        (chapter.number < CHAPTER_MIN || chapter.number > CHAPTER_MAX)) continue

    const chapterText = getChapterText(book.bookNumber, chapter.number)
    if (!chapterText?.trim()) {
      console.log(`📖  Bk ${book.bookNumber} Ch ${chapter.number} — no text yet, skipping all 8 decks`)
      totalSkipped += DECK_TYPES.length
      continue
    }

    console.log(`\n📖  Book ${book.bookNumber}, Chapter ${chapter.number}: ${chapter.titleEs}`)

    // Noun subcategories must be seeded in CEFR order so each level can exclude
    // words already claimed by lower levels. A1 gets first dibs on the easiest
    // words, then A2, B1, B2, and finally the general "nouns" deck.
    const NOUN_SUBCATEGORY_ORDER = ['nouns-a1', 'nouns-a2', 'nouns-b1', 'nouns-b2', 'nouns']
    const nounSubcategorySet = new Set(NOUN_SUBCATEGORY_ORDER)

    // Ordered list of all deck types to process: noun subcategories first (in
    // CEFR order), then everything else in the original DECK_TYPES order.
    const orderedDeckTypes = [
      ...NOUN_SUBCATEGORY_ORDER
        .map((sub) => DECK_TYPES.find((t) => t.subcategory === sub))
        .filter((t): t is NonNullable<typeof t> => t != null),
      ...DECK_TYPES.filter((t) => !nounSubcategorySet.has(t.subcategory)),
    ] as unknown as typeof DECK_TYPES

    const chapterUsedNounTerms = new Set<string>()

    for (const deckType of orderedDeckTypes) {
      if (SUBCATEGORY_FILTER !== null && deckType.subcategory !== SUBCATEGORY_FILTER) continue

      const isNounDeck = nounSubcategorySet.has(deckType.subcategory)
      const usedTerms = isNounDeck ? chapterUsedNounTerms : new Set<string>()

      const deckTerms = await seedChapterDeck(
        book.bookNumber,
        chapter.number,
        deckType.subcategory,
        chapterText,
        usedTerms,
      )

      // Accumulate found/generated terms so later noun decks know what to avoid.
      if (isNounDeck) {
        for (const term of deckTerms) chapterUsedNounTerms.add(term)
      }

      // Respect Gemini rate limits
      await new Promise((r) => setTimeout(r, 1200))
    }

    totalCreated += DECK_TYPES.length
  }
}

console.log(`\n✨  Done! Created ${totalCreated} chapter-deck combinations (${totalSkipped} skipped — no text).\n`)
console.log('    Run the migration in supabase/migrations/002_deck_extensions.sql first if you haven\'t already.\n')
