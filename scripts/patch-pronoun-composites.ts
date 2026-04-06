/**
 * scripts/patch-pronoun-composites.ts
 *
 * Re-extracts all pronoun-composites decks for a user, replacing any bad cards
 * (full sentences as the spanish_term) with correctly extracted composite verb
 * forms (e.g. "dímelo", "pásamelo").
 *
 * The old cards are deleted and fresh ones are inserted. Vocabulary terms and
 * card_progress rows are NOT touched — SM-2 progress is retained for any terms
 * whose spelling happens to survive.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/patch-pronoun-composites.ts \
 *     --user-id <USER_UUID> [--dry-run]
 *
 *   --dry-run   Show what would be re-extracted without writing to the DB.
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getChapterText } from '../src/data/books/text-loader.js'

// ── Env + CLI ──────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name]?.trim()
  if (!val) { console.error(`❌  Missing env var: ${name}`); process.exit(1) }
  return val
}

const supabaseUrl    = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const geminiApiKey   = requireEnv('GEMINI_API_KEY')

const args = process.argv.slice(2)
function flag(name: string) {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : null
}
const USER_ID = flag('--user-id')
const DRY_RUN = args.includes('--dry-run')

if (!USER_ID) {
  console.error('\nUsage: npx tsx --env-file=.env.local scripts/patch-pronoun-composites.ts --user-id <UUID> [--dry-run]\n')
  process.exit(1)
}

// ── Clients ────────────────────────────────────────────────────────────────

const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
const genAI = new GoogleGenerativeAI(geminiApiKey)
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generationConfig: { thinkingConfig: { thinkingBudget: 0 } } as any,
})

// ── Prompt ─────────────────────────────────────────────────────────────────

function buildPrompt(chapterText: string, excludeTerms: string[]): string {
  const exclusionClause = excludeTerms.length
    ? `Do NOT include any of these already-studied terms: ${excludeTerms.slice(0, 60).join(', ')}.`
    : ''

  return `You are a Spanish language teacher creating flashcards for language learners.

Extract verb+clitic composite forms from the text. A valid composite is a conjugated verb OR infinitive OR gerund that has one or two clitic pronouns (me, te, se, le, lo, la, nos, os, los, las) spelled directly onto the end of the word (e.g. "dímelo", "pásamelo", "cuéntame", "escúchame", "sígueme", "llévatelo", "haciéndolo", "decírselo"). The pronoun must be fused to the verb — not a separate word before the verb.

VALIDATION RULE — before including any item, ask yourself: "Does this Spanish word end with me/te/se/le/lo/la/nos/os/los/las or a combination?" If no, do NOT include it.

Valid examples: dímelo ✓ | pásamelo ✓ | cuéntame ✓ | llévatelo ✓ | decírselo ✓ | escúchame ✓
Invalid examples: cubriré ✗ | entregó ✗ | miraron ✗ | dijo ✗ | oigan ✗ | llevaba ✗ (none end with a clitic pronoun)

The "spanish" field must be ONLY the composite verb form (e.g. "dímelo"), never a full sentence or phrase. The "english" field should translate both the verb and the pronouns.

Return however many genuine composite forms you find in the text — do NOT pad with forms that fail the validation rule. Return an empty array [] if none exist.
${exclusionClause}

For each item provide:
- "spanish": ONLY the composite verb form (e.g. "dímelo") — never a full sentence
- "english": English translation covering both verb and pronouns
- "sourceSentences": 1–2 sentences from the text where this or a similar form appears, each with "es" and "en" keys

Return ONLY valid JSON — an array of up to 10 objects (fewer is fine if the text has fewer genuine composite forms). No markdown, no explanation.

TEXT:
${chapterText}`
}

// ── Programmatic composite validator ──────────────────────────────────────
// Spanish verb+clitic composites always end with one of these patterns.
// This catches whatever Gemini misses and filters out bare verbs like
// "entregó", "cubriré", "miraron" that fail the suffix test.

const DOUBLE_CLITIC_SUFFIXES = [
  'melo', 'mela', 'melos', 'melas',
  'telo', 'tela', 'telos', 'telas',
  'selo', 'sela', 'selos', 'selas',
  'noslo', 'nosla', 'noslos', 'noslas',
]

const SINGLE_CLITIC_SUFFIXES = ['me', 'te', 'se', 'le', 'les', 'lo', 'la', 'nos', 'os', 'los', 'las']

const ACCENT = /[áéíóúÁÉÍÓÚ]/

function isCompositeForm(term: string): boolean {
  const t = term.toLowerCase().trim()

  // Reject adverbs ending in -mente (e.g. "fácilmente")
  if (t.endsWith('mente')) return false

  // Double clitics are almost always genuine composites
  for (const suffix of DOUBLE_CLITIC_SUFFIXES) {
    if (t.endsWith(suffix) && t.length > suffix.length + 1) return true
  }

  // Single clitics: require either an accent mark (stress was explicitly shifted
  // by the appended pronoun, e.g. cuéntame, dímelo, siéntate) OR the stem
  // looks like an infinitive (ends in -ar/-er/-ir before the clitic, e.g. decirlo).
  const hasAccent = ACCENT.test(t)
  for (const suffix of SINGLE_CLITIC_SUFFIXES) {
    if (!t.endsWith(suffix) || t.length <= suffix.length + 2) continue
    if (hasAccent) return true
    // No accent — accept infinitive+clitic forms (e.g. "decirlo", "verlos")
    const stem = t.slice(0, t.length - suffix.length)
    if (/[aei]r$/.test(stem)) return true
  }

  return false
}

// ── Card shape ─────────────────────────────────────────────────────────────

interface CardJson {
  spanish: string
  english: string
  sourceSentences?: Array<{ es: string; en: string }>
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log(`\n${DRY_RUN ? '🔍  DRY RUN — ' : ''}Patching pronoun-composites decks for user ${USER_ID}\n`)

// 1. Fetch all pronoun-composites decks for this user
const { data: decks, error: decksErr } = await sb
  .from('decks')
  .select('id, name, book_number, chapter_number')
  .eq('user_id', USER_ID)
  .eq('subcategory', 'pronoun-composites')
  .order('book_number')
  .order('chapter_number')

if (decksErr) { console.error('❌  Failed to fetch decks:', decksErr.message); process.exit(1) }
if (!decks?.length) { console.log('ℹ️   No pronoun-composites decks found.'); process.exit(0) }

console.log(`Found ${decks.length} pronoun-composites deck(s).\n`)

for (const deck of decks) {
  const { id: deckId, name, book_number, chapter_number } = deck

  if (!book_number || !chapter_number) {
    console.log(`⏭  ${name} — no book/chapter, skipping.`)
    continue
  }

  console.log(`📖  ${name} (${deckId})`)

  // 2. Load existing cards so we can show what's being replaced
  const { data: existingCards } = await sb
    .from('cards')
    .select('id, spanish_term')
    .eq('deck_id', deckId)
    .order('position')

  const existingTerms = (existingCards ?? []).map((c: { id: string; spanish_term: string }) => c.spanish_term)
  console.log(`    Current cards (${existingTerms.length}):`, existingTerms.join(' | '))

  // 3. Load chapter text
  const chapterText = getChapterText(book_number, chapter_number)
  if (!chapterText.trim()) {
    console.log(`    ⚠️   No chapter text loaded for Bk ${book_number} Ch ${chapter_number}, skipping.`)
    continue
  }

  // 4. Re-extract via Gemini
  let newCards: CardJson[]
  try {
    const result = await model.generateContent(buildPrompt(chapterText, []))
    const raw = result.response.text().trim()
    const jsonText = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    newCards = JSON.parse(jsonText)
    if (!Array.isArray(newCards)) throw new Error('Response is not a JSON array')
  } catch (err) {
    console.error(`    ❌  Gemini extraction failed: ${err}`)
    continue
  }

  // Post-filter: reject anything that doesn't actually end with a clitic suffix
  const allCards = newCards
  newCards = newCards.filter((c) => isCompositeForm(c.spanish))
  const rejected = allCards.filter((c) => !isCompositeForm(c.spanish)).map((c) => c.spanish)
  if (rejected.length) {
    console.log(`    ⚠️   Filtered out ${rejected.length} non-composite(s): ${rejected.join(' | ')}`)
  }

  console.log(`    New cards  (${newCards.length}):`, newCards.map((c) => c.spanish).join(' | '))

  if (DRY_RUN) {
    console.log(`    [dry-run] Skipping DB writes.\n`)
    continue
  }

  if (!newCards.length) {
    console.log(`    ⚠️   No valid composite forms found — leaving deck unchanged.\n`)
    continue
  }

  // 5. Delete existing cards
  const cardIds = (existingCards ?? []).map((c: { id: string; spanish_term: string }) => c.id)
  if (cardIds.length) {
    const { error: delErr } = await sb.from('cards').delete().in('id', cardIds)
    if (delErr) {
      console.error(`    ❌  Failed to delete old cards: ${delErr.message}`)
      continue
    }
  }

  // 6. Upsert vocabulary terms
  const termRows = newCards.map((c) => ({
    user_id: USER_ID,
    spanish_term: c.spanish.trim().toLowerCase(),
  }))

  await sb
    .from('vocabulary_terms')
    .upsert(termRows, { onConflict: 'user_id,spanish_term', ignoreDuplicates: true })

  const { data: termData, error: termErr } = await sb
    .from('vocabulary_terms')
    .select('id, spanish_term')
    .eq('user_id', USER_ID)
    .in('spanish_term', termRows.map((t) => t.spanish_term))

  if (termErr) {
    console.error(`    ❌  Failed to fetch vocab term IDs: ${termErr.message}`)
    continue
  }

  const termIdMap = new Map((termData ?? []).map((r: { id: string; spanish_term: string }) => [r.spanish_term, r.id]))

  // 7. Insert fresh cards
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
        position: i,
      }
    })
    .filter(Boolean)

  const { error: insertErr } = await sb.from('cards').insert(cardRows)
  if (insertErr) {
    console.error(`    ❌  Failed to insert new cards: ${insertErr.message}`)
    continue
  }

  console.log(`    ✅  Replaced ${cardIds.length} bad cards with ${cardRows.length} clean cards.\n`)
}

console.log('Done.\n')
