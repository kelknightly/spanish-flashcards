/**
 * scripts/fill-decks.ts
 *
 * Fills up decks that have fewer than TARGET_COUNT cards.
 * Generates new cards using Gemini, excluding already-used terms.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/fill-decks.ts
 *   npx tsx --env-file=.env scripts/fill-decks.ts --book 2 --chapter 1
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

function requireEnv(name: string): string {
  const val = process.env[name]?.trim()
  if (!val) { console.error(`❌  Missing env var: ${name}`); process.exit(1) }
  return val
}

const supabaseUrl    = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const geminiApiKey   = requireEnv('GEMINI_API_KEY')

const args = process.argv.slice(2)
const bookArg  = args.indexOf('--book')
const BOOK_FILTER    = bookArg !== -1 ? parseInt(args[bookArg + 1], 10) : null
const chapArg  = args.indexOf('--chapter')
const CHAPTER_FILTER = chapArg !== -1 ? parseInt(args[chapArg + 1], 10) : null
const subArg   = args.indexOf('--subcategory')
const SUB_FILTER     = subArg   !== -1 ? args[subArg + 1]                : null
const TARGET_COUNT   = 10

const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
const genAI = new GoogleGenerativeAI(geminiApiKey)
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generationConfig: { thinkingConfig: { thinkingBudget: 0 } } as any,
})

const TEXT_DIR = join(process.cwd(), 'src/data/books/text')

function getChapterText(bookNumber: number, chapterNumber: number): string {
  const file = join(TEXT_DIR, `book${bookNumber}-ch${chapterNumber}.txt`)
  if (!existsSync(file)) return ''
  try { return readFileSync(file, 'utf8') } catch { return '' }
}

function sentenceContainsTerm(sentence: string, term: string): boolean {
  const bare = term.replace(/^(el|la|los|las|un|una)\s+/i, '').trim()
  return sentence.toLowerCase().includes(bare.toLowerCase())
}

function hasObviousTenseMismatch(term: string, subcategory: string): boolean {
  const t = term.trim()
  if (subcategory === 'verbs-conditional') {
    const ok = t.split(/\s+/).some(w => /ría$|rías$|ríamos$|rían$/i.test(w))
    return !ok
  }
  if (subcategory === 'verbs-perfect') {
    const tokens = t.split(/\s+/).map(w => w.toLowerCase())
    const FINITE_HABER = new Set(['he', 'has', 'ha', 'hemos', 'han'])
    return !tokens.some(tok => FINITE_HABER.has(tok))
  }
  if (subcategory === 'verbs-future') {
    const ok = t.split(/\s+/).some(w => /ré$|rás$|rá$|remos$|rán$/i.test(w))
    return !ok
  }
  if (subcategory === 'verbs-present') {
    const firstWord = t.split(/\s+/)[0].toLowerCase()
    if (/ó$/.test(firstWord)) return true
    if (/aron$|ieron$|eron$/.test(firstWord)) return true
    if (/ando$|iendo$/.test(firstWord)) return true
  }
  if (subcategory === 'verbs-imperfect') {
    const firstWord = t.split(/\s+/)[0].toLowerCase()
    if (/ó$/.test(firstWord)) return true
    if (/aron$|ieron$|eron$/.test(firstWord)) return true
    if (/ando$|iendo$/.test(firstWord)) return true
  }
  return false
}

interface CardJson { spanish: string; english: string; sourceSentences?: Array<{ es: string; en: string }> }

const TYPE_INSTRUCTIONS: Record<string, string> = {
  'verbs-conditional': `Extract verbs conjugated in the CONDITIONAL tense (condicional simple) ONLY.
Valid forms end in: -ría, -rías, -ría, -ríamos, -rían.
Examples: hablaría, comeríamos, sería, tendría, podría, diría, haría, querría, vendría, sabría.
INVALID: infinitives, imperfect subjunctive (quisiera, hubiera), future (hablará), preterite, present, any non-conditional.
Every "spanish" field MUST end in -ría, -rías, -ríamos, or -rían.
If the text has few conditional forms, add thematically relevant conditional forms for verbs from the chapter.`,
  'verbs-imperfect': `Extract verbs conjugated in the IMPERFECT INDICATIVE tense (pretérito imperfecto de indicativo) ONLY.
Valid examples: hablaba, comían, era, tenía, vivía, estaba, sabía, quería, podía, había (there was).
INVALID: preterite forms (habló, fue, tuvo), present-perfect (ha hablado), conditional (-ría forms except those ambiguous with imperfect of -er verbs), gerunds.
All terms MUST appear verbatim in the text.`,
  'verbs-present': 'Extract verbs conjugated in the PRESENT INDICATIVE tense. Valid: habla, comen, soy, voy, tiene, estoy, hay, puede. All MUST appear verbatim in the text.',
  'verbs-perfect': `Extract PRESENT-PERFECT forms ONLY. Every "spanish" MUST start with he/has/ha/hemos/han followed by a past participle. E.g. "ha llegado", "han visto", "he dicho". NOT pluperfect (había+participle).`,
  'verbs-preterite': 'Extract PRETERITE past tense verbs that appear verbatim in the text.',
  'verbs-future': 'Extract FUTURE tense verbs (forms ending in -ré/-rás/-rá/-remos/-rán) from the text or thematically relevant.',
  'verbs-subjunctive': 'Extract SUBJUNCTIVE verbs (present or imperfect subjunctive) from the text or thematically relevant.',
  'verbs-imperative': 'Extract IMPERATIVE mood verbs from the text or thematically relevant.',
  'nouns': 'Extract nouns with article (el/la) that appear verbatim in the text.',
  'nouns-a1': 'Extract A1-level nouns with article that appear verbatim in the text.',
  'nouns-a2': 'Extract A2-level nouns with article that appear verbatim in the text.',
  'nouns-b1': 'Extract B1-level nouns with article that appear verbatim in the text.',
  'nouns-b2': 'Extract B2-level nouns with article that appear verbatim in the text.',
  'adjectives': 'Extract adjectives (masculine singular) that appear verbatim in the text.',
  'pronoun-composites': 'Extract verb+clitic pronoun composites from the text (e.g. dímelo, pásamelo).',
  'general': 'Extract general vocabulary items that appear verbatim in the text.',
}

async function generateCards(
  subcategory: string,
  chapterText: string,
  excludeTerms: string[],
  count: number,
): Promise<CardJson[]> {
  const instruction = TYPE_INSTRUCTIONS[subcategory] ?? `Extract ${count} vocabulary items from the text.`
  const exclusion = excludeTerms.length > 0
    ? `\nDo NOT include any of these already-used terms: ${excludeTerms.slice(0, 100).join(', ')}.\n`
    : ''

  const prompt = `You are a Spanish language teacher creating flashcards.

${instruction}${exclusion}

Generate exactly ${count} flashcard(s).

For each item:
- "spanish": the exact Spanish term (exact spelling and accents)
- "english": the English translation
- "sourceSentences": array of 1–2 sentences from the TEXT that contain the exact "spanish" term.
  RULES: each "es" MUST contain the exact term verbatim. Copy sentences word-for-word. If no sentence contains the term, use [].

Return ONLY valid JSON array of ${count} objects. No markdown.

TEXT:
${chapterText}`

  try {
    const result = await model.generateContent(prompt)
    const raw = result.response.text().trim()
    const jsonText = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(jsonText)
    if (!Array.isArray(parsed)) return []
    return (parsed as CardJson[])
      .map(c => ({
        ...c,
        sourceSentences: (c.sourceSentences ?? []).filter(s =>
          sentenceContainsTerm(s.es, c.spanish)
        ),
      }))
      .filter(c => !hasObviousTenseMismatch(c.spanish, subcategory))
  } catch {
    return []
  }
}

async function main() {
  console.log('\n🔧  Fill Under-10 Decks\n')

  let deckQuery = sb.from('decks')
    .select('id, name, book_number, chapter_number, subcategory, user_id')
    .not('subcategory', 'is', null)
    .not('book_number', 'is', null)
    .not('chapter_number', 'is', null)
    .order('name')

  if (BOOK_FILTER) deckQuery = deckQuery.eq('book_number', BOOK_FILTER)
  if (CHAPTER_FILTER) deckQuery = deckQuery.eq('chapter_number', CHAPTER_FILTER)
  if (SUB_FILTER) deckQuery = deckQuery.eq('subcategory', SUB_FILTER)

  const { data: decks } = await deckQuery
  const deckIds = (decks ?? []).map(d => d.id)
  if (!deckIds.length) { console.log('No decks found.'); return }

  const { data: allCards } = await sb.from('cards')
    .select('id, deck_id, spanish_term, position, vocab_term_id')
    .in('deck_id', deckIds)

  const cardsByDeck = new Map<string, typeof allCards>()
  for (const card of allCards ?? []) {
    const list = cardsByDeck.get(card.deck_id) ?? []
    list.push(card)
    cardsByDeck.set(card.deck_id, list)
  }

  for (const deck of decks ?? []) {
    const deckCards = cardsByDeck.get(deck.id) ?? []
    const deficit = TARGET_COUNT - deckCards.length
    if (deficit <= 0) {
      console.log(`  ✅  ${deck.name} (${deckCards.length} cards)`)
      continue
    }

    console.log(`  ⚠️  ${deck.name} has ${deckCards.length} cards — need ${deficit} more`)
    const chapterText = getChapterText(deck.book_number, deck.chapter_number)
    if (!chapterText) {
      console.log(`      ❌  No chapter text available`)
      continue
    }

    const existingTerms = deckCards.map(c => c.spanish_term.toLowerCase())
    const maxPosition = deckCards.reduce((m, c) => Math.max(m, c.position ?? 0), -1)

    const newCards = await generateCards(deck.subcategory, chapterText, existingTerms, deficit)
    if (!newCards.length) {
      console.log(`      ❌  Could not generate ${deficit} cards for ${deck.subcategory}`)
      continue
    }

    // Upsert vocab terms
    const termUpserts = newCards.map(c => ({
      user_id: deck.user_id,
      spanish_term: c.spanish.trim().toLowerCase(),
    }))
    await sb.from('vocabulary_terms')
      .upsert(termUpserts, { onConflict: 'user_id,spanish_term', ignoreDuplicates: true })

    const { data: termRows } = await sb.from('vocabulary_terms')
      .select('id, spanish_term')
      .eq('user_id', deck.user_id)
      .in('spanish_term', termUpserts.map(t => t.spanish_term))

    const termMap = new Map((termRows ?? []).map(r => [r.spanish_term, r.id]))

    const cardRows = newCards
      .map((c, i) => {
        const termId = termMap.get(c.spanish.trim().toLowerCase())
        if (!termId) return null
        return {
          deck_id: deck.id,
          vocab_term_id: termId,
          spanish_term: c.spanish.trim(),
          english_answer: c.english.trim(),
          source_sentences: c.sourceSentences ?? [],
          position: maxPosition + 1 + i,
        }
      })
      .filter(Boolean)

    const { error } = await sb.from('cards').insert(cardRows)
    if (error) {
      console.error(`      ❌  Insert failed: ${error.message}`)
    } else {
      console.log(`      ✅  Added ${cardRows.length} card(s):`)
      newCards.forEach(c => console.log(`         + "${c.spanish}" (${c.english})`))
    }
  }

  console.log('\n✅  Done\n')
}

main().catch(err => { console.error(err); process.exit(1) })
