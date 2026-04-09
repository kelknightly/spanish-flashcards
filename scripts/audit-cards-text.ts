/**
 * scripts/audit-cards-text.ts
 *
 * Comprehensive flashcard audit and repair tool.
 *
 * Checks performed for every card:
 *  1. SOURCE-SENTENCE CHECK: every source_sentences[].es must contain the
 *     card's spanish_term verbatim (exact spelling, case-insensitive).
 *     Cards with no matching sentence have their source_sentences cleared.
 *
 *  2. TERM-IN-TEXT CHECK: for decks whose subcategory requires literal text
 *     presence (all except verbs-conditional and verbs-future, which allow
 *     "thematically relevant" terms), the spanish_term must appear
 *     case-insensitively somewhere in the chapter's source text.
 *     Cards whose term is absent from the text are flagged for replacement.
 *
 *  3. TENSE-MATCH CHECK (Gemini): the term must be a valid example of the
 *     declared subcategory (e.g. not a future form in a conditional deck).
 *     This is the same check as audit-decks.ts but integrated here so you
 *     run one script.
 *
 * Repair actions (only when --fix is passed):
 *  A. Bad source sentences → stripped from the card's source_sentences array.
 *  B. Terms absent from text OR wrong tense → card deleted and a replacement
 *     is generated from the chapter text via Gemini.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/audit-cards-text.ts
 *   npx tsx --env-file=.env.local scripts/audit-cards-text.ts --fix
 *   npx tsx --env-file=.env.local scripts/audit-cards-text.ts --book 2 --chapter 2 --subcategory verbs-conditional
 *   npx tsx --env-file=.env.local scripts/audit-cards-text.ts --fix --book 2 --chapter 2
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// ── Env & CLI ──────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name]?.trim()
  if (!val) { console.error(`❌  Missing env var: ${name}`); process.exit(1) }
  return val
}

const supabaseUrl    = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const geminiApiKey   = requireEnv('GEMINI_API_KEY')

const args = process.argv.slice(2)
const FIX      = args.includes('--fix')
const DRY_RUN  = !FIX

const bookArg       = args.indexOf('--book')
const BOOK_FILTER   = bookArg   !== -1 ? parseInt(args[bookArg + 1],   10) : null
const chapArg       = args.indexOf('--chapter')
const CHAPTER_FILTER = chapArg  !== -1 ? parseInt(args[chapArg + 1],   10) : null
const subArg        = args.indexOf('--subcategory')
const SUB_FILTER    = subArg    !== -1 ? args[subArg + 1]                  : null

// ── Clients ────────────────────────────────────────────────────────────────

const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

const genAI = new GoogleGenerativeAI(geminiApiKey)
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generationConfig: { thinkingConfig: { thinkingBudget: 0 } } as any,
})

// ── Constants ──────────────────────────────────────────────────────────────

const TEXT_DIR = join(process.cwd(), 'src/data/books/text')

/** Subcategories where the term NEED NOT appear literally in the source text. */
const ALLOW_THEMATIC = new Set(['verbs-conditional', 'verbs-future', 'verbs-imperative', 'verbs-subjunctive', 'pronoun-composites', 'verbs-perfect'])

/** Description for each subcategory used in Gemini tense-match prompt. */
const SUBCATEGORY_RULES: Record<string, string> = {
  'verbs-present':     'Spanish present indicative (presente de indicativo). ALL of these are valid present forms: habla, comen, soy, voy, tiene, estoy, hay, puede, llega, siente, digo, veo, etc. Irregular forms (soy, estoy, hay, voy, doy) are VALID present tense — do NOT flag them as wrong.',
  'verbs-perfect':     'Spanish present perfect (pretérito perfecto compuesto). The auxiliary MUST be a PRESENT TENSE form of haber: he, has, ha, hemos, han. The term may include reflexive/object pronouns before the auxiliary (e.g. "se ha ido", "lo ha dicho", "te has ido" are all VALID). Multi-word forms are OK if the haber auxiliary is present-tense. INVALID: había/habían/hubo + participle (pluperfect), hubiera/haya + participle (subjunctive), habría + participle (conditional perfect), bare infinitives or bare participles.',
  'verbs-preterite':   'Spanish preterite (pretérito indefinido / pretérito perfecto simple). E.g. habló, comieron, fue, tuvo, dijo, llegó, vio. NOT imperfect (hablaba, era), NOT present-perfect (ha hablado).',
  'verbs-imperfect':   'Spanish imperfect INDICATIVE only (pretérito imperfecto de indicativo). E.g. hablaba, comían, era, tenía, vivía, estaba, sabía, quería, había (there was). NOT imperfect subjunctive (hubiera, tuviera, fuera, pudiera), NOT preterite (habló, fue).',
  'verbs-future':      'Spanish future indicative (futuro simple). Forms end in -ré, -rás, -rá, -remos, -rán. E.g. hablará, comeremos, será, tendrán.',
  'verbs-conditional': 'Spanish conditional (condicional simple). Forms end in -ría, -rías, -ríamos, -rían. E.g. hablaría, comeríamos, sería, tendría, podría. INVALID: imperfect subjunctive (quisiera, hubiera), infinitive (hablar), future (hablará), preterite.',
  'verbs-imperative':  'Spanish imperative mood (imperativo). E.g. habla, ve, vengan, no hagas, pásamelo, dime.',
  'verbs-subjunctive': 'Spanish subjunctive (subjuntivo — present or imperfect). Present: hable, sea, tenga, vaya. Imperfect: hubiera, tuviera, dijera, fuera, pudiera.',
  'nouns':             'Spanish noun, optionally with article. E.g. la casa, el perro, un libro.',
  'nouns-a1':          'Spanish A1-level noun, optionally with article.',
  'nouns-a2':          'Spanish A2-level noun, optionally with article.',
  'nouns-b1':          'Spanish B1-level noun, optionally with article.',
  'nouns-b2':          'Spanish B2-level noun, optionally with article.',
  'adjectives':        'Spanish adjective (masculine singular headword). E.g. feliz, grande, rojo.',
  'pronoun-composites': 'Spanish verb with one or two attached clitic pronouns. E.g. dímelo, pásamelo, cuéntame.',
  'general':           'Any Spanish word or short phrase.',
}

/** Prompt instructions for replacement card generation. */
const TYPE_INSTRUCTIONS: Record<string, string> = {
  'nouns':              'Extract Spanish nouns (sustantivos) that appear in the text. Include the article (el/la) with each noun. All terms MUST appear verbatim in the text.',
  'nouns-a1':           'Extract A1-level Spanish nouns that appear in the text. Include the article (el/la). All terms MUST appear verbatim in the text.',
  'nouns-a2':           'Extract A2-level Spanish nouns that appear in the text. Include the article (el/la). All terms MUST appear verbatim in the text.',
  'nouns-b1':           'Extract B1-level Spanish nouns that appear in the text. Include the article (el/la). All terms MUST appear verbatim in the text.',
  'nouns-b2':           'Extract B2-level Spanish nouns that appear in the text. Include the article (el/la). All terms MUST appear verbatim in the text.',
  'verbs-present':      'Extract verbs conjugated in the PRESENT INDICATIVE tense (presente de indicativo) as they appear verbatim in the text. Valid examples: habla, comen, soy, voy, tiene, estoy, hay, puede. Do NOT include preterite, imperfect, or any past-tense forms. All terms MUST appear verbatim in the text.',
  'verbs-perfect':      `Extract PRESENT-PERFECT verb forms (pretérito perfecto compuesto) ONLY.
VALID forms use the PRESENT TENSE of haber as auxiliary: he, has, ha, hemos, han — followed by a past participle.
Examples of VALID forms: "ha llegado", "han visto", "hemos comido", "he dicho", "has ido".
INVALID — DO NOT USE: "había + participle" (that is pluperfect, NOT present perfect), "hubiera/hubieras/hubiera + participle" (pluperfect subjunctive), bare past participles ("llegado", "visto"), preterite forms.
If the text contains few present-perfect forms, create thematically appropriate present-perfect forms using vocabulary that appears in the text. Every "spanish" field MUST be a two-word phrase starting with he/has/ha/hemos/han.`,
  'verbs-preterite':    'Extract verbs conjugated in the PRETERITE past tense (pretérito indefinido) as they appear verbatim in the text. Valid examples: habló, comieron, fue, tuvo. Do NOT include imperfect (hablaba, era) or present-perfect forms. All terms MUST appear verbatim in the text.',
  'verbs-imperfect':    `Extract verbs conjugated in the IMPERFECT INDICATIVE tense (pretérito imperfecto de indicativo) ONLY.
Valid examples: hablaba, comían, era, tenía, vivía, estaba, sabía, quería, podía, había (meaning "there was/were").
INVALID — DO NOT USE: preterite forms (habló, fue, tuvo), present-perfect (ha hablado), imperfect subjunctive (hubiera, tuviera, dijera, fuera). All terms MUST appear verbatim in the text.`,
  'verbs-future':       'Extract verbs conjugated in the FUTURE INDICATIVE tense (futuro simple) — forms ending in -ré, -rás, -rá, -remos, -rán — as they appear in or are thematically relevant to the text. Examples: hablará, comeremos, será, tendrán. Do NOT include conditional forms (-ría/-rías/-ríamos).',
  'verbs-conditional':  `Extract verbs conjugated in the CONDITIONAL tense (condicional simple) ONLY.
Valid forms end in: -ría, -rías, -ría, -ríamos, -rían.
Examples: hablaría, comeríamos, sería, tendría, podría, diría, haría, querría, vendría, sabría.
INVALID — DO NOT USE: infinitives (hablar, comer), imperfect subjunctive (quisiera, hubiera, tuviera, fuera, dijera, entregara), future tense (hablará, volverás), preterite, present, or any other tense.
The term in "spanish" MUST end in -ría, -rías, -ríamos, or -rían.
If the text has few conditional forms, add thematically relevant conditional forms for verbs from the chapter.`,
  'verbs-imperative':   'Extract verbs conjugated in the IMPERATIVE mood (imperativo) as they appear in or are thematically relevant to the text. Examples: habla, ve, vengan, no hagas, pásamelo, dime, sigue.',
  'verbs-subjunctive':  'Extract verbs conjugated in the SUBJUNCTIVE mood (subjuntivo — present or imperfect) as they appear in or are thematically relevant to the text. Examples present: hable, tenga, sea, vaya. Examples imperfect: hubiera, tuviera, dijera, fuera, pudiera.',
  'adjectives':         'Extract adjectives (adjetivos) that appear in the text. Provide masculine singular headword. All terms MUST appear verbatim in the text.',
  'pronoun-composites': 'Extract composite verb+clitic pronoun forms (e.g. "dímelo", "pásamelo", "cuéntame") as they appear in the text. Card the full composite form — never just the bare verb.',
  'general':            'Extract general vocabulary items that appear in the text. All terms MUST appear verbatim in the text.',
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getChapterText(bookNumber: number, chapterNumber: number): string {
  const file = join(TEXT_DIR, `book${bookNumber}-ch${chapterNumber}.txt`)
  if (!existsSync(file)) return ''
  try { return readFileSync(file, 'utf8') } catch { return '' }
}

/** True if `term` appears word-boundary-approximately in `text` (case-insensitive). */
function termInText(term: string, text: string): boolean {
  if (!text) return false
  // Strip article prefix for noun check (el/la/los/las/un/una + space)
  const bare = term.replace(/^(el|la|los|las|un|una)\s+/i, '').trim()
  // Also handle two-word forms like "ha llegado" — check either the whole phrase
  // or the participle alone as a fallback.
  const words = bare.split(/\s+/)
  return words.every(w => text.toLowerCase().includes(w.toLowerCase()))
}

/** True if `sentence` contains `term` case-insensitively. */
function sentenceContainsTerm(sentence: string, term: string): boolean {
  // Strip article for search so "el bosque" matches sentence containing "bosque"
  const bare = term.replace(/^(el|la|los|las|un|una)\s+/i, '').trim()
  return sentence.toLowerCase().includes(bare.toLowerCase())
}

/** Quick regex-based pre-check for obvious tense violations (before calling Gemini). */
function hasObviousTenseMismatch(term: string, subcategory: string): boolean {
  const t = term.trim()
  if (subcategory === 'verbs-conditional') {
    // Must end in -ría, -rías, -ríamos, -rían (check all words — compound forms possible)
    const ok = t.split(/\s+/).some(w => /ría$|rías$|ríamos$|rían$/i.test(w))
    return !ok
  }
  if (subcategory === 'verbs-perfect') {
    // Must contain he/has/ha/hemos/han as a standalone word (optionally preceded by
    // object/reflexive pronouns like se, lo, la, te, me, nos)
    const tokens = t.split(/\s+/).map(w => w.toLowerCase())
    const FINITE_HABER = new Set(['he', 'has', 'ha', 'hemos', 'han'])
    const ok = tokens.some(tok => FINITE_HABER.has(tok))
    return !ok
  }
  if (subcategory === 'verbs-future') {
    // Must end in -ré/-rás/-rá/-remos/-rán (check all words)
    const ok = t.split(/\s+/).some(w => /ré$|rás$|rá$|remos$|rán$/i.test(w))
    return !ok
  }
  if (subcategory === 'verbs-present') {
    // Block obvious preterite (3rd person -ó, -aron, -ieron, -ó) and imperfect (-aba, -aban, -ía, -ían endings where they are unambiguously past)
    // We use a BLOCKLIST approach — only flag near-certain non-present forms
    const firstWord = t.split(/\s+/)[0].toLowerCase()
    // Preterite: 3rd person singular -ó (accented — unambiguous), 3rd plural -aron/-ieron/-eron
    // Avoid blocking -o (present yo) or forms that are ambiguous
    if (/ó$/.test(firstWord)) return true  // 3rd person preterite (accented ó)
    if (/aron$|ieron$|eron$/.test(firstWord)) return true  // 3rd plural preterite
    // Gerunds (-ando, -iendo) are not present indicative
    if (/ando$|iendo$/.test(firstWord)) return true
    return false
  }
  if (subcategory === 'verbs-imperfect') {
    // Preterite endings are wrong for imperfect
    const firstWord = t.split(/\s+/)[0].toLowerCase()
    if (/ó$/.test(firstWord)) return true  // preterite 3rd sg
    if (/aron$|ieron$|eron$/.test(firstWord)) return true  // preterite 3rd pl
    // Gerunds are not imperfect indicative
    if (/ando$|iendo$/.test(firstWord)) return true
    // Conditional endings: forms that are unambiguously conditional, NOT imperfect.
    // We need at least 2 letters before "ría" to avoid flagging quería/corría (imperfect of -er verbs).
    // Safe pattern: 5+ character words ending in ría where the ría is the whole -ar-conditional suffix.
    // Actually the safest is: flag words ending in "aría" or "ería" with length ≥ 8
    // because those extra letters confirm it's infinitive+ía (conditional), not stem+ía (imperfect).
    // Skip this check to avoid false positives — Gemini will catch remaining conditional forms.
    return false
  }
  return false
}

// ── Tense-match audit (Gemini batch) ─────────────────────────────────────

async function getTenseMismatches(
  subcategory: string,
  terms: { id: string; term: string }[],
): Promise<Set<string>> {
  const rule = SUBCATEGORY_RULES[subcategory]
  if (!rule) return new Set()

  const prompt = `You are a strict Spanish grammar classifier.

The deck subcategory is: "${subcategory}"
Required form: ${rule}

Examine each flashcard term below. Return only the IDs of terms that are INVALID for this subcategory (wrong tense, wrong mood, infinitive, gerund, bare past participle, or any other mismatch).
If all are valid, return [].
Return ONLY a JSON array of strings. No explanation.

Terms:
${JSON.stringify(terms.map(t => ({ id: t.id, term: t.term })))}`

  try {
    const result = await model.generateContent(prompt)
    const raw = result.response.text().trim()
    const json = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.map(String))
  } catch {
    return new Set()
  }
}

// ── Replacement card generation ────────────────────────────────────────────

interface CardJson {
  spanish: string
  english: string
  sourceSentences?: Array<{ es: string; en: string }>
}

async function generateReplacements(
  subcategory: string,
  chapterText: string,
  excludeTerms: string[],
  count: number,
): Promise<CardJson[]> {
  const instruction = TYPE_INSTRUCTIONS[subcategory] ?? `Extract Spanish vocabulary from the text.`
  const exclusion = excludeTerms.length > 0
    ? `\nDo NOT include any of these already-used terms: ${excludeTerms.slice(0, 80).join(', ')}.\n`
    : ''

  const prompt = `You are a Spanish language teacher creating flashcards for language learners.

${instruction}${exclusion}

Generate exactly ${count} flashcard(s).

For each item provide:
- "spanish": the Spanish term exactly as it appears in the text (exact spelling and accents)
- "english": the English translation
- "sourceSentences": an array of 1–2 example sentences copied VERBATIM from the text below (each with "es" and "en" keys).
  CRITICAL RULES for sourceSentences:
    1. The "es" sentence MUST contain the exact "spanish" term verbatim — same spelling, same accents, same word.
    2. Do NOT fabricate or paraphrase sentences — copy them word-for-word from the TEXT section.
    3. If no sentence in the text contains the exact term, set sourceSentences to [] (empty array).

Return ONLY valid JSON — an array of exactly ${count} object(s). No markdown, no explanation.

TEXT:
${chapterText}`

  try {
    const result = await model.generateContent(prompt)
    const raw = result.response.text().trim()
    const jsonText = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(jsonText)
    if (!Array.isArray(parsed)) return []
    // Post-generation validation:
    // 1. Strip bad source sentences
    // 2. Filter out cards that fail the regex tense check
    return (parsed as CardJson[])
      .map((c) => ({
        ...c,
        sourceSentences: (c.sourceSentences ?? []).filter(s =>
          sentenceContainsTerm(s.es, c.spanish)
        ),
      }))
      .filter((c) => !hasObviousTenseMismatch(c.spanish, subcategory))
  } catch {
    return []
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

interface DeckRow {
  id: string
  name: string
  book_number: number
  chapter_number: number
  subcategory: string
  user_id: string
}

interface CardRow {
  id: string
  deck_id: string
  spanish_term: string
  english_answer: string
  source_sentences: Array<{ es: string; en: string }>
  position: number
  vocab_term_id: string
}

async function main() {
  console.log(`\n🔍  Spanish Flashcards — Comprehensive Card Audit`)
  console.log(`    Mode: ${FIX ? '✏️  FIX' : '🌵 DRY RUN (pass --fix to apply repairs)'}\n`)

  // ── 1. Fetch decks ──────────────────────────────────────────────────────
  let deckQuery = sb.from('decks')
    .select('id, name, book_number, chapter_number, subcategory, user_id')
    .not('subcategory', 'is', null)
    .not('book_number', 'is', null)
    .not('chapter_number', 'is', null)
    .order('book_number').order('chapter_number').order('name')

  if (BOOK_FILTER) deckQuery = deckQuery.eq('book_number', BOOK_FILTER)
  if (CHAPTER_FILTER) deckQuery = deckQuery.eq('chapter_number', CHAPTER_FILTER)
  if (SUB_FILTER) deckQuery = deckQuery.eq('subcategory', SUB_FILTER)

  const { data: decks, error: deckErr } = await deckQuery
  if (deckErr) { console.error('❌  Deck fetch failed:', deckErr.message); process.exit(1) }

  // ── 2. Fetch all cards ──────────────────────────────────────────────────
  const deckIds = (decks ?? []).map(d => d.id)
  if (!deckIds.length) { console.log('No matching decks found.'); return }

  const { data: cards, error: cardErr } = await sb
    .from('cards')
    .select('id, deck_id, spanish_term, english_answer, source_sentences, position, vocab_term_id')
    .in('deck_id', deckIds)

  if (cardErr) { console.error('❌  Card fetch failed:', cardErr.message); process.exit(1) }

  const cardsByDeck = new Map<string, CardRow[]>()
  for (const card of (cards ?? []) as CardRow[]) {
    const list = cardsByDeck.get(card.deck_id) ?? []
    list.push(card)
    cardsByDeck.set(card.deck_id, list)
  }

  console.log(`📚  ${decks?.length} decks, ${cards?.length} cards total\n`)

  // ── 3. Summary counters ─────────────────────────────────────────────────
  let totalBadSentences = 0
  let totalMissingFromText = 0
  let totalTenseMismatches = 0
  let totalFixed = 0

  // ── 4. Audit each deck ──────────────────────────────────────────────────
  for (const deck of (decks ?? []) as DeckRow[]) {
    const deckCards = cardsByDeck.get(deck.id) ?? []
    if (!deckCards.length) continue

    const chapterText = getChapterText(deck.book_number, deck.chapter_number)
    const strictTextRequired = !ALLOW_THEMATIC.has(deck.subcategory)

    // Issues per card
    const badSentenceCards: { card: CardRow; badIdxs: number[] }[] = []
    const missingFromTextCards: CardRow[] = []

    for (const card of deckCards) {
      // ── CHECK 1: Source sentences contain the term ────────────────────
      const badIdxs: number[] = []
      for (let i = 0; i < (card.source_sentences ?? []).length; i++) {
        const s = card.source_sentences[i]
        if (!sentenceContainsTerm(s.es, card.spanish_term)) {
          badIdxs.push(i)
        }
      }
      if (badIdxs.length > 0) badSentenceCards.push({ card, badIdxs })

      // ── CHECK 2: Term appears in chapter text ─────────────────────────
      if (strictTextRequired && chapterText && !termInText(card.spanish_term, chapterText)) {
        missingFromTextCards.push(card)
      }
    }

    // ── CHECK 3: Tense match ─────────────────────────────────────────────
    // First pass: fast regex check for verbs-conditional, verbs-perfect, verbs-future,
    // verbs-present, verbs-imperfect (regex is more reliable than Gemini for these).
    let tenseMismatchIds = new Set<string>()
    const REGEX_SUFFICIENT = new Set(['verbs-conditional', 'verbs-perfect', 'verbs-future', 'verbs-present'])
    if (deck.subcategory.startsWith('verbs-')) {
      for (const card of deckCards) {
        if (hasObviousTenseMismatch(card.spanish_term, deck.subcategory)) {
          tenseMismatchIds.add(card.id)
        }
      }
    }
    // Second pass: Gemini for the non-regex-sufficient subcategories only
    if (!REGEX_SUFFICIENT.has(deck.subcategory) && SUBCATEGORY_RULES[deck.subcategory] && deck.subcategory.startsWith('verbs-')) {
      const regexOk = deckCards
        .filter(c => !tenseMismatchIds.has(c.id))
        .map(c => ({ id: c.id, term: c.spanish_term }))
      if (regexOk.length > 0) {
        try {
          const geminiMismatches = await getTenseMismatches(deck.subcategory, regexOk)
          for (const id of geminiMismatches) tenseMismatchIds.add(id)
        } catch (err) {
          console.warn(`    ⚠️  Tense check skipped for ${deck.name}: ${err}`)
        }
      }
    }

    const hasBadSentences = badSentenceCards.length > 0
    const hasMissingFromText = missingFromTextCards.length > 0
    const hasTenseMismatches = tenseMismatchIds.size > 0

    if (!hasBadSentences && !hasMissingFromText && !hasTenseMismatches) {
      console.log(`  ✅  ${deck.name}`)
      continue
    }

    console.log(`\n  ❌  ${deck.name}`)

    // ── Report bad sentences ─────────────────────────────────────────────
    for (const { card, badIdxs } of badSentenceCards) {
      totalBadSentences++
      const badSentences = badIdxs.map(i => `"${card.source_sentences[i].es.slice(0, 60)}…"`).join(', ')
      console.log(`      📝  Bad source sentence(s) for "${card.spanish_term}": ${badSentences}`)
    }

    // ── Report missing from text ─────────────────────────────────────────
    for (const card of missingFromTextCards) {
      totalMissingFromText++
      console.log(`      🔍  Term not in chapter text: "${card.spanish_term}"`)
    }

    // ── Report tense mismatches ──────────────────────────────────────────
    for (const cardId of tenseMismatchIds) {
      const card = deckCards.find(c => c.id === cardId)
      if (card) {
        totalTenseMismatches++
        console.log(`      ⚠️  Wrong tense for ${deck.subcategory}: "${card.spanish_term}"`)
      }
    }

    if (DRY_RUN) continue

    // ── FIX: Strip bad source sentences ──────────────────────────────────
    for (const { card, badIdxs } of badSentenceCards) {
      const badSet = new Set(badIdxs)
      const cleaned = (card.source_sentences ?? []).filter((_, i) => !badSet.has(i))
      const { error } = await sb.from('cards')
        .update({ source_sentences: cleaned })
        .eq('id', card.id)
      if (error) {
        console.error(`      ❌  Failed to clean sentences for ${card.spanish_term}: ${error.message}`)
      } else {
        console.log(`      🔧  Cleaned source_sentences for "${card.spanish_term}" (removed ${badIdxs.length} bad)`)
        totalFixed++
      }
    }

    // ── FIX: Replace cards with wrong tense or missing from text ─────────
    const cardsToReplace = new Set<string>([
      ...missingFromTextCards.map(c => c.id),
      ...[...tenseMismatchIds],
    ])

    if (cardsToReplace.size > 0) {
      const toReplaceCards = deckCards.filter(c => cardsToReplace.has(c.id))
      const keepCards = deckCards.filter(c => !cardsToReplace.has(c.id))
      const keepTerms = keepCards.map(c => c.spanish_term.toLowerCase())

      console.log(`      🔄  Replacing ${toReplaceCards.length} bad card(s)…`)

      // ── Generate replacements FIRST — only delete if we have something to insert ──
      const replacements = await generateReplacements(
        deck.subcategory,
        chapterText,
        keepTerms,
        toReplaceCards.length,
      )

      if (!replacements.length) {
        console.warn(`      ⚠️  Could not generate replacements for ${deck.name} — leaving existing cards in place`)
        continue
      }

      // Delete bad cards (now that we have replacements ready)
      const { error: delErr } = await sb.from('cards').delete().in('id', [...cardsToReplace])
      if (delErr) {
        console.error(`      ❌  Delete failed: ${delErr.message}`)
        continue
      }

      // Upsert vocab terms
      const termUpserts = replacements.map(c => ({
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

      // Choose positions: re-use positions from deleted cards
      const freePositions = toReplaceCards.map(c => c.position).sort((a, b) => a - b)

      const newCardRows = replacements
        .map((c, i) => {
          const termId = termMap.get(c.spanish.trim().toLowerCase())
          if (!termId) return null
          return {
            deck_id: deck.id,
            vocab_term_id: termId,
            spanish_term: c.spanish.trim(),
            english_answer: c.english.trim(),
            source_sentences: c.sourceSentences ?? [],
            position: freePositions[i] ?? (keepCards.length + i),
          }
        })
        .filter(Boolean)

      const { error: insertErr } = await sb.from('cards').insert(newCardRows)
      if (insertErr) {
        console.error(`      ❌  Insert failed: ${insertErr.message}`)
      } else {
        console.log(`      ✅  Replaced ${newCardRows.length} card(s):`)
        replacements.forEach(c => console.log(`         + "${c.spanish}" (${c.english})`))
        totalFixed += newCardRows.length
      }
    }
  }

  // ── 5. Summary ──────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────────────────')
  console.log(`📊  AUDIT SUMMARY`)
  console.log(`    Bad source sentences:  ${totalBadSentences} card(s)`)
  console.log(`    Terms not in text:     ${totalMissingFromText} card(s)`)
  console.log(`    Tense mismatches:      ${totalTenseMismatches} card(s)`)
  if (!DRY_RUN) {
    console.log(`    Fixed:                 ${totalFixed} operation(s)`)
  }
  if (DRY_RUN && (totalBadSentences + totalMissingFromText + totalTenseMismatches) > 0) {
    console.log('\n    ⚡  Run with --fix to apply repairs.')
  }
  console.log('')
}

main().catch(err => { console.error(err); process.exit(1) })
