/**
 * scripts/patch-sentence-mismatch.ts
 *
 * Finds cards where `spanish_term` does not appear verbatim in any of the
 * card's `source_sentences[].es` strings and repairs them.
 *
 * For each mismatched card the script:
 *   1. Looks up the original chapter text (from src/data/books/text/).
 *   2. Finds all sentences in that text that contain the exact spanish_term.
 *   3. Uses Gemini to translate up to 2 of those sentences into English.
 *   4. Writes the repaired source_sentences back to the database.
 *
 * If the term cannot be found in the chapter text at all, source_sentences is
 * set to [] (empty) so the card safely shows no example sentence rather than
 * a misleading one.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/patch-sentence-mismatch.ts \
 *     --user-id <USER_UUID> [--dry-run] [--book <N>] [--chapters <N-M|N>]
 *
 * Flags:
 *   --dry-run    Report problems without writing anything.
 *   --book <N>   Restrict to a specific book number.
 *   --chapters <N-M|N>  Restrict to a chapter range (inclusive).
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// ── Env vars ───────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name]?.trim()
  if (!val) {
    console.error(`\n❌  Missing required environment variable: ${name}`)
    process.exit(1)
  }
  return val
}

const supabaseUrl    = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const geminiApiKey   = requireEnv('GEMINI_API_KEY')

// ── CLI args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function flag(name: string): string | null {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : null
}

const USER_ID = flag('--user-id')
if (!USER_ID) {
  console.error('\nUsage: npx tsx --env-file=.env.local scripts/patch-sentence-mismatch.ts --user-id <UUID> [--dry-run] [--book <N>] [--chapters <N-M>]\n')
  process.exit(1)
}

const DRY_RUN = args.includes('--dry-run')
const BOOK_FILTER = flag('--book') ? parseInt(flag('--book')!, 10) : null
const chaptersArg = flag('--chapters')
let CHAPTER_MIN: number | null = null
let CHAPTER_MAX: number | null = null
if (chaptersArg) {
  const parts = chaptersArg.split('-').map(Number)
  CHAPTER_MIN = parts[0]
  CHAPTER_MAX = parts.length > 1 ? parts[1] : parts[0]
}

// ── Clients ────────────────────────────────────────────────────────────────

const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
const genAI = new GoogleGenerativeAI(geminiApiKey)
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generationConfig: { thinkingConfig: { thinkingBudget: 0 } } as any,
})

// ── Helpers ────────────────────────────────────────────────────────────────

const TEXT_DIR = join(process.cwd(), 'src/data/books/text')

function getChapterText(bookNumber: number, chapterNumber: number): string {
  const file = join(TEXT_DIR, `book${bookNumber}-ch${chapterNumber}.txt`)
  if (!existsSync(file)) return ''
  try { return readFileSync(file, 'utf8') } catch { return '' }
}

const ARTICLE_RE = /^(?:el|la|los|las|un|una|unos|unas)\s+/i

/**
 * Return true if `term` (or its article-stripped core) appears verbatim
 * (case-insensitive) in `sentence`. This mirrors the logic used by
 * `highlightTerm` in StudyView.tsx so we only flag cards that would genuinely
 * fail to highlight — not noun cards where the article variant differs.
 */
function termInSentence(sentence: string, term: string): boolean {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // 1. Try the full term as-is
  if (new RegExp(escape(term), 'i').test(sentence)) return true

  // 2. Try slash-separated variants (e.g. "the bow/curtsy")
  const slashParts = term.split('/')
  for (const part of slashParts) {
    const p = part.trim()
    if (p && new RegExp(escape(p), 'i').test(sentence)) return true
  }

  // 3. Try each variant with leading article stripped
  const candidates = [term, ...slashParts.map((p) => p.trim())].filter(Boolean)
  for (const candidate of candidates) {
    const core = candidate.replace(ARTICLE_RE, '').trim()
    if (core && new RegExp(escape(core), 'i').test(sentence)) return true
  }

  return false
}

/**
 * Return a verb stem for matching conjugated Spanish verbs in chapter text.
 * Strips common future, conditional, preterite, and other endings to
 * approximate the root used by `highlightTerm` (first word minus last 2 chars,
 * minimum 3 chars).
 */
function verbStem(term: string): string | null {
  const firstWord = term.split(/\s+/)[0]
  if (firstWord.length < 4) return null
  const stemLen = Math.max(3, firstWord.length - 2)
  return firstWord.slice(0, stemLen).toLowerCase()
}

/** Like termInSentence but also tries the verb stem prefix. */
function termOrStemInSentence(sentence: string, term: string): boolean {
  if (termInSentence(sentence, term)) return true
  const stem = verbStem(term)
  if (!stem) return false
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escape(stem) + '\\S*', 'i').test(sentence)
}

/**
 * Split chapter text into individual sentences using Spanish sentence
 * boundary heuristics (handles ¿, ¡, abbreviations, ellipsis, guillemets).
 */
function splitIntoSentences(text: string): string[] {
  // Normalise newlines, then split on . ? ! followed by a capital or quote.
  // This is a best-effort split; edge cases are acceptable.
  return text
    .replace(/\r\n?/g, '\n')
    .split(/(?<=[.!?»"'"])\s+(?=[¿¡«"'"A-ZÁÉÍÓÚÑÜ])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Ask Gemini to translate up to 2 Spanish sentences into English. */
async function translateSentences(
  term: string,
  sentences: string[],
): Promise<Array<{ es: string; en: string }>> {
  const toTranslate = sentences.slice(0, 2)
  const prompt = `Translate the following Spanish sentences into natural English. Return ONLY a JSON array of objects with "es" and "en" keys. No markdown, no explanation.

Spanish sentences (each contains the Spanish word "${term}"):
${JSON.stringify(toTranslate)}`

  try {
    const result = await model.generateContent(prompt)
    const raw = result.response.text().trim()
    const jsonText = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(jsonText)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // Fall back: return without translation
    return toTranslate.map((s) => ({ es: s, en: '' }))
  }
  return toTranslate.map((s) => ({ es: s, en: '' }))
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log(`\n🔍  Scanning cards for sentence mismatches (user: ${USER_ID})${DRY_RUN ? ' [DRY RUN]' : ''}\n`)

// Fetch all decks for this user (optionally filtered by book/chapter)
let deckQuery = sb
  .from('decks')
  .select('id, name, book_number, chapter_number')
  .eq('user_id', USER_ID)
  .not('book_number', 'is', null)
  .not('chapter_number', 'is', null)

if (BOOK_FILTER !== null) {
  deckQuery = deckQuery.eq('book_number', BOOK_FILTER)
}

const { data: decks, error: decksErr } = await deckQuery
if (decksErr) { console.error('❌  Deck fetch failed:', decksErr.message); process.exit(1) }
if (!decks?.length) { console.log('ℹ️   No decks found.'); process.exit(0) }

let totalScanned = 0
let totalMismatched = 0
let totalRepaired = 0
let totalCleared = 0

for (const deck of decks) {
  if (!deck.book_number || !deck.chapter_number) continue
  if (CHAPTER_MIN !== null && CHAPTER_MAX !== null &&
      (deck.chapter_number < CHAPTER_MIN || deck.chapter_number > CHAPTER_MAX)) continue

  // Fetch cards for this deck
  const { data: cards, error: cardsErr } = await sb
    .from('cards')
    .select('id, spanish_term, source_sentences')
    .eq('deck_id', deck.id)

  if (cardsErr) {
    console.error(`  ❌  Card fetch failed for deck ${deck.id}: ${cardsErr.message}`)
    continue
  }
  if (!cards?.length) continue

  // Load chapter text once per deck (lazy, cached within loop iteration)
  let chapterText: string | null = null
  let sentenceList: string[] | null = null

  for (const card of cards) {
    totalScanned++

    const sentences: Array<{ es: string; en: string }> = card.source_sentences ?? []

    // Check whether every existing sentence contains the exact term
    const hasMismatch = sentences.length === 0 ||
      !sentences.some((s) => termInSentence(s.es, card.spanish_term))

    if (!hasMismatch) continue

    totalMismatched++
    if (sentences.length === 0) {
      console.log(`  ⚠️   Missing — deck: "${deck.name}" | term: "${card.spanish_term}"`)
    } else {
      console.log(`  ⚠️   Mismatch — deck: "${deck.name}" | term: "${card.spanish_term}"`)
      for (const s of sentences) {
        console.log(`         sentence: "${s.es.slice(0, 80)}…"`)
      }
    }

    if (DRY_RUN) continue

    // Lazy-load chapter text
    if (chapterText === null) {
      chapterText = getChapterText(deck.book_number, deck.chapter_number)
      sentenceList = chapterText ? splitIntoSentences(chapterText) : []
    }

    // Find sentences in the chapter text that contain the exact term or verb stem
    const matching = (sentenceList ?? []).filter((s) =>
      termOrStemInSentence(s, card.spanish_term)
    )

    if (!matching.length) {
      // Term not found in chapter text at all — clear source_sentences
      console.log(`    ℹ️   Term not found in chapter text — clearing source_sentences`)
      const { error } = await sb
        .from('cards')
        .update({ source_sentences: [] })
        .eq('id', card.id)
      if (error) {
        console.error(`    ❌  Update failed: ${error.message}`)
      } else {
        totalCleared++
      }
      continue
    }

    // Translate the best matching sentences
    const translated = await translateSentences(card.spanish_term, matching)
    // Verify the translated pairs still contain the term or stem (sanity check)
    const clean = translated.filter((p) => termOrStemInSentence(p.es, card.spanish_term))

    if (!clean.length) {
      console.log(`    ⚠️   Translation result failed sanity check — clearing source_sentences`)
      await sb.from('cards').update({ source_sentences: [] }).eq('id', card.id)
      totalCleared++
      continue
    }

    const { error } = await sb
      .from('cards')
      .update({ source_sentences: clean })
      .eq('id', card.id)

    if (error) {
      console.error(`    ❌  Update failed: ${error.message}`)
    } else {
      console.log(`    ✅  Repaired with: "${clean[0].es.slice(0, 80)}…"`)
      totalRepaired++
    }
  }
}

console.log(`\n📊  Summary:`)
console.log(`    Scanned:      ${totalScanned} cards`)
console.log(`    Needs repair: ${totalMismatched} cards`)
if (!DRY_RUN) {
  console.log(`    Repaired:   ${totalRepaired} cards`)
  console.log(`    Cleared:    ${totalCleared} cards (term absent from chapter text)`)
}
console.log()
