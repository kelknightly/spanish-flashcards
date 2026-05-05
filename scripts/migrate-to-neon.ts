/**
 * Migrate data from Supabase to Neon Postgres.
 *
 * This script exports all app data (decks, cards, vocabulary_terms,
 * card_progress, study_sessions, chat_sessions) from a paused Supabase project
 * using the service-role key, then inserts it into Neon.
 *
 * NOTE: The `users` table is NOT migrated — Neon uses credentials auth (bcrypt).
 *       Create users separately with scripts/create-user.ts.
 *       user_profiles ARE migrated (streak/stats), but user_id will need to match
 *       the new Neon users.id. Run create-user.ts FIRST, then this script.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJh... \
 *   DATABASE_URL=postgresql://... \
 *   npx tsx scripts/migrate-to-neon.ts
 */
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const dbUrl = process.env.DATABASE_URL ?? ''

if (!supabaseUrl || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!dbUrl) {
  console.error('Set DATABASE_URL')
  process.exit(1)
}

const sb = createClient(supabaseUrl, serviceKey)
const sql = neon(dbUrl)

async function fetchAll<T>(table: string, columns = '*', retries = 5): Promise<T[]> {
  let all: T[] = []
  let from = 0
  const PAGE = 1000
  while (true) {
    let attempt = 0
    let data: T[] | null = null
    let error: { message: string } | null = null
    while (attempt < retries) {
      const res = await sb.from(table).select(columns).range(from, from + PAGE - 1)
      data = res.data as T[] | null
      error = res.error
      if (!error) break
      console.log(`  Retrying ${table} (attempt ${attempt + 1}): ${error.message}`)
      await new Promise(r => setTimeout(r, 3000))
      attempt++
    }
    if (error) throw new Error(`Error fetching ${table}: ${error.message}`)
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

async function main() {
  console.log('Fetching data from Supabase...')

  const profiles = await fetchAll('user_profiles')
  const decks = await fetchAll('decks')
  const vocabTerms = await fetchAll('vocabulary_terms')
  const cards = await fetchAll('cards')
  const progress = await fetchAll('card_progress')
  const sessions = await fetchAll('study_sessions')
  const chats = await fetchAll('chat_sessions')

  console.log(`Fetched: ${profiles.length} profiles, ${decks.length} decks, ${vocabTerms.length} vocab terms, ${cards.length} cards, ${progress.length} progress records, ${sessions.length} sessions, ${chats.length} chats`)

  // Insert user_profiles
  console.log('Inserting user_profiles...')
  for (const p of profiles as Record<string, unknown>[]) {
    await sql`
      INSERT INTO user_profiles (user_id, current_streak, longest_streak, last_active_date, total_cards_reviewed, created_at, updated_at)
      VALUES (
        ${p.user_id as string},
        ${(p.current_streak as number) ?? 0},
        ${(p.longest_streak as number) ?? 0},
        ${(p.last_active_date as string | null) ?? null},
        ${(p.total_cards_reviewed as number) ?? 0},
        ${(p.created_at as string) ?? new Date().toISOString()},
        ${(p.updated_at as string) ?? new Date().toISOString()}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        current_streak = EXCLUDED.current_streak,
        longest_streak = EXCLUDED.longest_streak,
        last_active_date = EXCLUDED.last_active_date,
        total_cards_reviewed = EXCLUDED.total_cards_reviewed
    `
  }

  // Insert decks
  console.log('Inserting decks...')
  for (const d of decks as Record<string, unknown>[]) {
    await sql`
      INSERT INTO decks (id, user_id, name, category, subcategory, book_number, chapter_number, version, parent_deck_id, is_system_generated, created_at)
      VALUES (
        ${d.id as string}, ${d.user_id as string}, ${d.name as string},
        ${(d.category as string | null) ?? null}, ${(d.subcategory as string | null) ?? null},
        ${(d.book_number as number | null) ?? null}, ${(d.chapter_number as number | null) ?? null},
        ${(d.version as number) ?? 1}, ${(d.parent_deck_id as string | null) ?? null},
        ${(d.is_system_generated as boolean) ?? false},
        ${(d.created_at as string) ?? new Date().toISOString()}
      )
      ON CONFLICT (id) DO NOTHING
    `
  }

  // Insert vocabulary_terms
  console.log('Inserting vocabulary_terms...')
  for (const v of vocabTerms as Record<string, unknown>[]) {
    await sql`
      INSERT INTO vocabulary_terms (id, user_id, spanish_term, created_at)
      VALUES (
        ${v.id as string}, ${v.user_id as string}, ${v.spanish_term as string},
        ${(v.created_at as string) ?? new Date().toISOString()}
      )
      ON CONFLICT (id) DO NOTHING
    `
  }

  // Insert cards
  console.log('Inserting cards...')
  for (const c of cards as Record<string, unknown>[]) {
    await sql`
      INSERT INTO cards (id, deck_id, vocab_term_id, spanish_term, english_answer, source_sentences, position, created_at)
      VALUES (
        ${c.id as string}, ${c.deck_id as string}, ${c.vocab_term_id as string},
        ${c.spanish_term as string}, ${c.english_answer as string},
        ${JSON.stringify((c.source_sentences as unknown[]) ?? [])},
        ${(c.position as number) ?? 0},
        ${(c.created_at as string) ?? new Date().toISOString()}
      )
      ON CONFLICT (id) DO NOTHING
    `
  }

  // Insert card_progress
  console.log('Inserting card_progress...')
  for (const p of progress as Record<string, unknown>[]) {
    await sql`
      INSERT INTO card_progress (id, user_id, vocab_term_id, ease_factor, interval_days, repetitions, next_review_at, last_reviewed_at, mastered_at, introduced_at)
      VALUES (
        ${p.id as string}, ${p.user_id as string}, ${p.vocab_term_id as string},
        ${(p.ease_factor as number) ?? 2.5}, ${(p.interval_days as number) ?? 1},
        ${(p.repetitions as number) ?? 0},
        ${((p.next_review_date ?? p.next_review_at) as string | null) ?? null},
        ${(p.last_reviewed_at as string | null) ?? null},
        ${(p.mastered_at as string | null) ?? null},
        ${(p.introduced_at as string | null) ?? null}
      )
      ON CONFLICT (id) DO NOTHING
    `
  }

  // Insert study_sessions
  console.log('Inserting study_sessions...')
  for (const s of sessions as Record<string, unknown>[]) {
    await sql`
      INSERT INTO study_sessions (id, user_id, deck_id, started_at, ended_at, cards_reviewed, cards_correct)
      VALUES (
        ${s.id as string}, ${s.user_id as string}, ${s.deck_id as string},
        ${(s.started_at as string) ?? new Date().toISOString()},
        ${(s.ended_at as string | null) ?? null},
        ${(s.cards_reviewed as number) ?? 0},
        ${(s.cards_correct as number) ?? 0}
      )
      ON CONFLICT (id) DO NOTHING
    `
  }

  // Insert chat_sessions
  console.log('Inserting chat_sessions...')
  for (const c of chats as Record<string, unknown>[]) {
    await sql`
      INSERT INTO chat_sessions (id, user_id, messages, created_at, updated_at)
      VALUES (
        ${c.id as string}, ${c.user_id as string},
        ${JSON.stringify((c.messages as unknown[]) ?? [])},
        ${(c.created_at as string) ?? new Date().toISOString()},
        ${(c.updated_at as string) ?? new Date().toISOString()}
      )
      ON CONFLICT (id) DO NOTHING
    `
  }

  console.log('\nMigration complete!')
  console.log('\nNext step: run scripts/create-user.ts to create login credentials for each user.')
}

main().catch((e) => { console.error(e); process.exit(1) })
