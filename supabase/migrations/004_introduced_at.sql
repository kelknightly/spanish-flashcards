-- ============================================================
-- Add introduced_at to card_progress
-- Tracks when a vocab term was first studied so we can enforce
-- a daily new-card cap without counting re-reviews.
-- ============================================================

alter table public.card_progress
  add column if not exists introduced_at timestamptz;

-- Backfill: treat the earliest known review date as the introduction date.
update public.card_progress
  set introduced_at = last_reviewed_at
  where introduced_at is null
    and last_reviewed_at is not null;

-- For any rows that had no last_reviewed_at (shouldn't exist in practice), use now().
update public.card_progress
  set introduced_at = now()
  where introduced_at is null;

create index if not exists card_progress_introduced_idx
  on public.card_progress (user_id, introduced_at);
