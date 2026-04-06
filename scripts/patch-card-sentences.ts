/**
 * scripts/patch-card-sentences.ts
 *
 * One-off script to fix the source_sentences of a specific card.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/patch-card-sentences.ts \
 *     --user-id <USER_UUID> \
 *     --book 2 --chapter 1 --subcategory nouns \
 *     --term "la nieve"
 */

import { createClient } from '@supabase/supabase-js'

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

const args = process.argv.slice(2)
function flag(name: string) {
  const idx = args.indexOf(name)
  return idx !== -1 ? args[idx + 1] : null
}

const USER_ID     = flag('--user-id')
const bookNumber  = flag('--book') ? parseInt(flag('--book')!, 10) : null
const chapterNum  = flag('--chapter') ? parseInt(flag('--chapter')!, 10) : null
const subcategory = flag('--subcategory')
const term        = flag('--term')

if (!USER_ID || !bookNumber || !chapterNum || !subcategory || !term) {
  console.error(
    '\nUsage: npx tsx --env-file=.env.local scripts/patch-card-sentences.ts' +
    ' --user-id <UUID> --book <N> --chapter <N> --subcategory <slug> --term <spanish_term>\n',
  )
  process.exit(1)
}

const sb = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

// Find the deck
const { data: deck, error: deckErr } = await sb
  .from('decks')
  .select('id, name')
  .eq('user_id', USER_ID)
  .eq('book_number', bookNumber)
  .eq('chapter_number', chapterNum)
  .eq('subcategory', subcategory)
  .maybeSingle()

if (deckErr) { console.error('❌  Deck lookup failed:', deckErr.message); process.exit(1) }
if (!deck)   { console.error(`❌  No deck found for Bk ${bookNumber} Ch ${chapterNum} ${subcategory}`); process.exit(1) }

console.log(`✅  Found deck: "${deck.name}" (${deck.id})`)

// Find the card
const { data: card, error: cardErr } = await sb
  .from('cards')
  .select('id, spanish_term, english_answer, source_sentences')
  .eq('deck_id', deck.id)
  .ilike('spanish_term', term)
  .maybeSingle()

if (cardErr) { console.error('❌  Card lookup failed:', cardErr.message); process.exit(1) }
if (!card)   { console.error(`❌  No card found with spanish_term matching "${term}" in that deck`); process.exit(1) }

console.log(`🃏  Found card: "${card.spanish_term}" → "${card.english_answer}" (${card.id})`)
console.log(`    Current source_sentences:`, JSON.stringify(card.source_sentences, null, 2))

// Patches: keyed by "term" (lowercase, trimmed)
const PATCHES: Record<string, Array<{ es: string; en: string }>> = {
  'la nieve': [
    {
      es: 'Un momento después se dio cuenta de que estaba de pie en medio de un bosque, de noche, y que había nieve bajo sus pies y copos que caían desde lo alto.',
      en: 'A moment later she realized that she was standing in the middle of a forest, at night, and that there was snow under her feet and flakes falling from above.',
    },
    {
      es: 'Comenzó a caminar por el bosque hacia la otra luz, sus pasos hacían crujir la nieve ¡crac!, ¡crac!',
      en: 'She began to walk through the forest towards the other light, her steps making the snow crunch, crunch!',
    },
  ],
}

const key = card.spanish_term.trim().toLowerCase()
const newSentences = PATCHES[key]

if (!newSentences) {
  console.error(`❌  No patch defined for term "${card.spanish_term}". Add it to the PATCHES map in this script.`)
  process.exit(1)
}

// Update
const { error: updateErr } = await sb
  .from('cards')
  .update({ source_sentences: newSentences })
  .eq('id', card.id)

if (updateErr) { console.error('❌  Update failed:', updateErr.message); process.exit(1) }

console.log(`✅  Updated source_sentences for "${card.spanish_term}":`)
console.log(JSON.stringify(newSentences, null, 2))
