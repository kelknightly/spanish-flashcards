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
  console.error('\nUsage: npx tsx scripts/seed-decks.ts --user-id <USER_UUID>\n')
  process.exit(1)
}
const USER_ID = args[userIdIdx + 1]

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
  'verbs-present':
    'Extract exactly 10 verbs conjugated in the present tense (presente de indicativo) as they appear in the text.',
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
}

function buildPrompt(subcategory: string, chapterText: string): string {
  const instruction =
    TYPE_INSTRUCTIONS[subcategory] ??
    `Extract exactly 10 items of category "${subcategory}" from the text.`

  return `You are a Spanish language teacher creating flashcards for language learners.

${instruction}

For each item provide:
- "spanish": the Spanish term exactly as it appears in (or is derived from) the text
- "english": the English translation
- "sourceSentences": an array of 1–2 example sentences from the text (each with "es" and "en" keys)

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

async function extractCards(subcategory: string, text: string): Promise<CardJson[]> {
  const prompt = buildPrompt(subcategory, text)
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

async function seedChapterDeck(
  bookNumber: number,
  chapterNumber: number,
  subcategory: string,
  chapterText: string,
): Promise<void> {
  const deckName = buildDeckName(bookNumber, chapterNumber, subcategory, 1)
  const category = subcategory === 'nouns' ? 'nouns' : 'verbs'

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
    return
  }

  // Extract cards via Gemini
  let cards: CardJson[]
  try {
    cards = await extractCards(subcategory, chapterText)
  } catch (err) {
    console.error(`  ❌  Gemini error for ${deckName}: ${err}`)
    return
  }

  if (!cards.length) {
    console.warn(`  ⚠️   No cards returned for ${deckName}, skipping.`)
    return
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
    return
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
    return
  }

  console.log(`  ✅  Created: ${deckName} (${cardRows.length} cards)`)
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log(`\n🌟  Seeding Narnia flashcard decks for user ${USER_ID}\n`)

let totalCreated = 0
let totalSkipped = 0

for (const book of books) {
  for (const chapter of book.chapters) {
    const chapterText = getChapterText(book.bookNumber, chapter.number)
    if (!chapterText?.trim()) {
      console.log(`📖  Bk ${book.bookNumber} Ch ${chapter.number} — no text yet, skipping all 8 decks`)
      totalSkipped += DECK_TYPES.length
      continue
    }

    console.log(`\n📖  Book ${book.bookNumber}, Chapter ${chapter.number}: ${chapter.titleEs}`)

    for (const deckType of DECK_TYPES) {
      await seedChapterDeck(
        book.bookNumber,
        chapter.number,
        deckType.subcategory,
        chapterText,
      )
      // Respect Gemini rate limits
      await new Promise((r) => setTimeout(r, 1200))
    }

    totalCreated += DECK_TYPES.length
  }
}

console.log(`\n✨  Done! Created ${totalCreated} chapter-deck combinations (${totalSkipped} skipped — no text).\n`)
console.log('    Run the migration in supabase/migrations/002_deck_extensions.sql first if you haven\'t already.\n')
