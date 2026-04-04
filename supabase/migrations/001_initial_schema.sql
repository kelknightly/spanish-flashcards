-- ============================================================
-- Spanish Flashcards — Narnia Edition
-- Initial schema migration
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────
create extension if not exists "pgcrypto";


-- ─── user_profiles ───────────────────────────────────────────
-- Streak tracking and user app state (outside Supabase Auth)
create table public.user_profiles (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  current_streak  integer not null default 0,
  longest_streak  integer not null default 0,
  last_active_date date
);

alter table public.user_profiles enable row level security;

create policy "Users can manage their own profile"
  on public.user_profiles for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ─── decks ───────────────────────────────────────────────────
create table public.decks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  book_number     integer,
  chapter_number  integer,
  category        text,
  subcategory     text,
  source_text     text,                        -- full OCR text from screenshots
  created_at      timestamptz not null default now(),
  last_studied_at timestamptz
);

create index decks_user_id_idx on public.decks(user_id);
create index decks_book_chapter_idx on public.decks(book_number, chapter_number);

alter table public.decks enable row level security;

create policy "Users can manage their own decks"
  on public.decks for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ─── vocabulary_terms ────────────────────────────────────────
-- Normalised registry of unique Spanish terms per user.
-- SM-2 progress is tracked at this level, not per-card,
-- so the same conjugated form shares progress across all chapters.
create table public.vocabulary_terms (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  spanish_term  text not null,
  created_at    timestamptz not null default now(),
  unique(user_id, spanish_term)
);

create index vocab_terms_user_term_idx on public.vocabulary_terms(user_id, spanish_term);

alter table public.vocabulary_terms enable row level security;

create policy "Users can manage their own vocabulary terms"
  on public.vocabulary_terms for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ─── cards ───────────────────────────────────────────────────
create table public.cards (
  id               uuid primary key default gen_random_uuid(),
  deck_id          uuid not null references public.decks(id) on delete cascade,
  vocab_term_id    uuid not null references public.vocabulary_terms(id) on delete cascade,
  spanish_term     text not null,              -- denormalised for fast display
  english_answer   text not null,
  source_sentences jsonb not null default '[]', -- [{ "es": "...", "en": "..." }]
  position         integer not null default 0,
  created_at       timestamptz not null default now()
);

create index cards_deck_id_idx on public.cards(deck_id);
create index cards_vocab_term_id_idx on public.cards(vocab_term_id);

alter table public.cards enable row level security;

-- Cards are owned via their deck
create policy "Users can manage cards in their own decks"
  on public.cards for all
  using (
    exists (
      select 1 from public.decks
      where decks.id = cards.deck_id
        and decks.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.decks
      where decks.id = cards.deck_id
        and decks.user_id = auth.uid()
    )
  );


-- ─── card_progress ───────────────────────────────────────────
-- SM-2 state per vocabulary term per user.
-- Keyed on vocab_term_id so progress is shared cross-deck.
create table public.card_progress (
  id                 uuid primary key default gen_random_uuid(),
  vocab_term_id      uuid not null references public.vocabulary_terms(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  ease_factor        real not null default 2.5,
  interval_days      integer not null default 0,
  repetitions        integer not null default 0,
  next_review_at     date,
  last_quality_score integer,
  last_reviewed_at   timestamptz,
  total_reviews      integer not null default 0,
  total_correct      integer not null default 0,
  mastered_at        timestamptz,              -- set when interval_days first >= 21
  unique(vocab_term_id, user_id)
);

create index card_progress_user_review_idx on public.card_progress(user_id, next_review_at);
create index card_progress_mastered_idx on public.card_progress(user_id, mastered_at);

alter table public.card_progress enable row level security;

create policy "Users can manage their own card progress"
  on public.card_progress for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ─── study_sessions ──────────────────────────────────────────
create table public.study_sessions (
  id              uuid primary key default gen_random_uuid(),
  deck_id         uuid not null references public.decks(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  cards_total     integer not null default 0,
  cards_correct   integer not null default 0,
  cards_incorrect integer not null default 0,
  score_pct       real
);

create index study_sessions_user_idx on public.study_sessions(user_id);
create index study_sessions_deck_idx on public.study_sessions(deck_id);

alter table public.study_sessions enable row level security;

create policy "Users can manage their own study sessions"
  on public.study_sessions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ─── chat_sessions ───────────────────────────────────────────
create table public.chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  deck_id    uuid references public.decks(id) on delete set null,
  title      text not null default 'New conversation',
  messages   jsonb not null default '[]',      -- [{ "role", "content", "timestamp", "attachments"? }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chat_sessions_user_idx on public.chat_sessions(user_id);
create index chat_sessions_updated_idx on public.chat_sessions(user_id, updated_at desc);

alter table public.chat_sessions enable row level security;

create policy "Users can manage their own chat sessions"
  on public.chat_sessions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ─── Auto-update updated_at on chat_sessions ─────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger chat_sessions_updated_at
  before update on public.chat_sessions
  for each row execute function public.set_updated_at();


-- ─── Auto-create user_profile on signup ──────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.user_profiles(user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
