-- ============================================================
-- Migration 003: Add reviewed_cards to mastery stats RPC
-- Run after 002_deck_extensions.sql
-- Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Update RPC to also return reviewed_cards (any card_progress
-- record exists for that card/user, regardless of mastery level).
-- This lets the UI show partial progress within a session.

create or replace function public.get_deck_mastery_stats(
  deck_ids uuid[],
  p_user_id uuid
)
returns table(deck_id uuid, total_cards bigint, mastered_cards bigint, reviewed_cards bigint)
language sql
security definer
set search_path = public
as $$
  select
    c.deck_id,
    count(distinct c.id)                                                    as total_cards,
    count(distinct case when cp.mastered_at is not null then c.id end)      as mastered_cards,
    count(distinct case when cp.id is not null then c.id end)               as reviewed_cards
  from public.cards c
  left join public.card_progress cp
    on  cp.vocab_term_id = c.vocab_term_id
    and cp.user_id       = p_user_id
  where c.deck_id = any(deck_ids)
  group by c.deck_id;
$$;
