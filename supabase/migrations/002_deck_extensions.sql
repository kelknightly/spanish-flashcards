-- ============================================================
-- Migration 002: Deck versioning and system-generated decks
-- Run after 001_initial_schema.sql
-- Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ─── Add versioning columns to decks ─────────────────────────

alter table public.decks
  add column if not exists version integer not null default 1,
  add column if not exists is_system_generated boolean not null default false,
  add column if not exists parent_deck_id uuid references public.decks(id) on delete set null;

-- Index for "Add More" lineage lookups
create index if not exists decks_parent_deck_id_idx
  on public.decks(parent_deck_id);

-- Index for fast chapter-level deck queries
create index if not exists decks_book_chapter_sub_version_idx
  on public.decks(user_id, book_number, chapter_number, subcategory, version);


-- ─── RPC: mastery stats per deck ────────────────────────────
-- Returns total_cards and mastered_cards for each deck_id.
-- Joins through cards → card_progress on vocab_term_id.
-- Called from GET /api/decks to enrich deck list responses.

create or replace function public.get_deck_mastery_stats(
  deck_ids uuid[],
  p_user_id uuid
)
returns table(deck_id uuid, total_cards bigint, mastered_cards bigint)
language sql
security definer
set search_path = public
as $$
  select
    c.deck_id,
    count(distinct c.id)                                                    as total_cards,
    count(distinct case when cp.mastered_at is not null then c.id end)      as mastered_cards
  from public.cards c
  left join public.card_progress cp
    on  cp.vocab_term_id = c.vocab_term_id
    and cp.user_id       = p_user_id
  where c.deck_id = any(deck_ids)
  group by c.deck_id;
$$;
