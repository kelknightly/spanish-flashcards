/**
 * scripts/audit-decks.ts
 *
 * Audits every seeded deck and removes cards that don't match the deck's
 * declared subcategory (e.g. imperfect verbs in a verbs-present deck).
 *
 * Uses Gemini to classify each term so the judgment is linguistically accurate.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/audit-decks.ts [--dry-run]
 *
 *   --dry-run   Report problems without deleting anything.
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

function requireEnv(name: string): string {
  const val = process.env[name]?.trim()
  if (!val) { console.error(`❌  Missing env var: ${name}`); process.exit(1) }
  return val
}

const supabaseUrl    = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const geminiApiKey   = requireEnv('GEMINI_API_KEY')

const DRY_RUN = process.argv.includes('--dry-run')

const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
const genAI = new GoogleGenerativeAI(geminiApiKey)
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generationConfig: { thinkingConfig: { thinkingBudget: 0 } } as any,
})

// What each subcategory expects, in Gemini-friendly description
const SUBCATEGORY_RULES: Record<string, string> = {
  'verbs-present':     'Spanish present indicative (presente de indicativo). E.g. habla, comen, soy, voy, tiene.',
  'verbs-preterite':   'Spanish preterite (pretérito indefinido / pretérito perfecto simple). E.g. habló, comieron, fue, tuvo.',
  'verbs-imperfect':   'Spanish imperfect (pretérito imperfecto). E.g. hablaba, comían, era, tenía, vivía.',
  'verbs-future':      'Spanish future indicative (futuro simple). E.g. hablará, comeremos, será, tendrán.',
  'verbs-conditional': 'Spanish conditional (condicional simple). E.g. hablaría, comeríamos, sería, tendría.',
  'verbs-imperative':  'Spanish imperative mood (imperativo). E.g. habla, comed, ve, vengan, no hagas.',
  'verbs-subjunctive': 'Spanish subjunctive mood (subjuntivo). E.g. hable, coman, sea, tenga, vaya.',
  'nouns':             'Spanish noun (sustantivo), optionally with article. E.g. la casa, el perro, un libro.',
}

interface Card {
  id: string
  deck_id: string
  spanish_term: string
  english_answer: string
}

interface Deck {
  id: string
  name: string
  subcategory: string
  cards: Card[]
}

// Ask Gemini which terms in this batch do NOT match the expected subcategory.
async function auditBatch(
  subcategory: string,
  terms: { id: string; term: string }[],
): Promise<string[]> {
  const rule = SUBCATEGORY_RULES[subcategory]
  if (!rule) return [] // unknown subcategory — skip

  const listJson = JSON.stringify(terms.map(t => ({ id: t.id, term: t.term })))

  const prompt = `You are a strict Spanish grammar classifier.

The deck type is: "${subcategory}"
Required form: ${rule}

Below is a JSON array of flashcard terms from this deck. For each term, determine whether it is a valid instance of the required form.

Return ONLY a JSON array of IDs that are INVALID (wrong tense, wrong mood, infinitive, gerund, participle, noun, adjective, or any other mismatch). If all terms are valid, return an empty array [].

Terms:
${listJson}`

  const result = await model.generateContent(prompt)
  const raw = result.response.text().trim()
  const jsonText = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  try {
    const parsed = JSON.parse(jsonText)
    if (!Array.isArray(parsed)) return []
    return parsed.map(String)
  } catch {
    console.warn('    ⚠️  Failed to parse Gemini response:', raw.slice(0, 200))
    return []
  }
}

async function main() {
  console.log(`\n🔍  Fetching all decks and cards…`)

  const { data: decks, error: deckErr } = await sb
    .from('decks')
    .select('id, name, subcategory')
    .not('subcategory', 'is', null)
    .order('name')

  if (deckErr) { console.error('❌  Deck fetch failed:', deckErr.message); process.exit(1) }

  const { data: cards, error: cardErr } = await sb
    .from('cards')
    .select('id, deck_id, spanish_term, english_answer')

  if (cardErr) { console.error('❌  Card fetch failed:', cardErr.message); process.exit(1) }

  // Group cards by deck
  const cardsByDeck = new Map<string, Card[]>()
  for (const card of cards ?? []) {
    const list = cardsByDeck.get(card.deck_id) ?? []
    list.push(card)
    cardsByDeck.set(card.deck_id, list)
  }

  const deckList: Deck[] = (decks ?? []).map(d => ({
    ...d,
    cards: cardsByDeck.get(d.id) ?? [],
  })).filter(d => d.cards.length > 0 && SUBCATEGORY_RULES[d.subcategory])

  console.log(`📚  Auditing ${deckList.length} decks (${cards?.length} cards total)…`)
  if (DRY_RUN) console.log('🌵  DRY RUN — no deletions will be made\n')

  const toDelete: { id: string; term: string; deck: string }[] = []

  for (const deck of deckList) {
    process.stdout.write(`  ${deck.name} (${deck.cards.length} cards)… `)

    const terms = deck.cards.map(c => ({ id: c.id, term: c.spanish_term }))
    let badIds: string[] = []
    try {
      badIds = await auditBatch(deck.subcategory, terms)
    } catch (err) {
      console.log(`❌ Gemini error: ${err}`)
      continue
    }

    if (badIds.length === 0) {
      console.log('✅')
      continue
    }

    const badCards = deck.cards.filter(c => badIds.includes(c.id))
    console.log(`⚠️  ${badIds.length} bad: ${badCards.map(c => `"${c.spanish_term}"`).join(', ')}`)
    for (const c of badCards) toDelete.push({ id: c.id, term: c.spanish_term, deck: deck.name })
  }

  console.log(`\n━━━ Summary ━━━`)
  console.log(`Total bad cards found: ${toDelete.length}`)

  if (toDelete.length === 0) {
    console.log('🎉  No inconsistencies found!')
    return
  }

  for (const c of toDelete) {
    console.log(`  🗑  "${c.term}" in ${c.deck}`)
  }

  if (DRY_RUN) {
    console.log('\n(Dry run — nothing deleted)')
    return
  }

  // Delete in one batch
  const ids = toDelete.map(c => c.id)
  const { error: delErr } = await sb.from('cards').delete().in('id', ids)
  if (delErr) {
    console.error('\n❌  Deletion failed:', delErr.message)
    process.exit(1)
  }

  console.log(`\n✅  Deleted ${ids.length} invalid cards.`)
}

main()
