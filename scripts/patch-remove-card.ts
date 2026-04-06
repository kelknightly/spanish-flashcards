/**
 * scripts/patch-remove-card.ts
 *
 * One-off script to remove a specific card from a deck.
 * Use when a seeded card is incorrect (e.g. wrong tense in a tense-specific deck).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/patch-remove-card.ts \
 *     --user-id <USER_UUID> \
 *     --book 2 --chapter 1 --subcategory verbs-present \
 *     --term vivía
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
    '\nUsage: npx tsx --env-file=.env.local scripts/patch-remove-card.ts' +
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
  .select('id, spanish_term, english_answer')
  .eq('deck_id', deck.id)
  .eq('spanish_term', term)
  .maybeSingle()

if (cardErr) { console.error('❌  Card lookup failed:', cardErr.message); process.exit(1) }
if (!card)   { console.error(`❌  No card found with spanish_term = "${term}" in that deck`); process.exit(1) }

console.log(`🃏  Found card: "${card.spanish_term}" → "${card.english_answer}" (${card.id})`)

// Delete it
const { error: delErr } = await sb.from('cards').delete().eq('id', card.id)

if (delErr) { console.error('❌  Delete failed:', delErr.message); process.exit(1) }

console.log(`🗑️   Removed card for "${term}" from "${deck.name}"`)
