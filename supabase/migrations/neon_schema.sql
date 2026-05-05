-- ============================================================
-- Spanish Flashcards — Narnia Edition
-- Neon PostgreSQL schema (replaces all Supabase migrations)
-- Run once against your Neon database.
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ─── users ───────────────────────────────────────────────────
-- Replaces Supabase auth.users. Stores login credentials.
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ─── user_profiles ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak     INTEGER NOT NULL DEFAULT 0,
  longest_streak     INTEGER NOT NULL DEFAULT 0,
  last_active_date   DATE,
  daily_record_cards INTEGER NOT NULL DEFAULT 0
);


-- ─── decks ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  book_number        INTEGER,
  chapter_number     INTEGER,
  category           TEXT,
  subcategory        TEXT,
  source_text        TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  is_system_generated BOOLEAN NOT NULL DEFAULT false,
  is_custom          BOOLEAN NOT NULL DEFAULT false,
  parent_deck_id     UUID REFERENCES decks(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_studied_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS decks_user_id_idx ON decks(user_id);
CREATE INDEX IF NOT EXISTS decks_book_chapter_idx ON decks(book_number, chapter_number);
CREATE INDEX IF NOT EXISTS decks_parent_deck_id_idx ON decks(parent_deck_id);
CREATE INDEX IF NOT EXISTS decks_book_chapter_sub_version_idx
  ON decks(user_id, book_number, chapter_number, subcategory, version);


-- ─── vocabulary_terms ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vocabulary_terms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spanish_term  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, spanish_term)
);

CREATE INDEX IF NOT EXISTS vocab_terms_user_term_idx ON vocabulary_terms(user_id, spanish_term);


-- ─── cards ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id          UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  vocab_term_id    UUID NOT NULL REFERENCES vocabulary_terms(id) ON DELETE CASCADE,
  spanish_term     TEXT NOT NULL,
  english_answer   TEXT NOT NULL,
  source_sentences JSONB NOT NULL DEFAULT '[]',
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cards_deck_id_idx ON cards(deck_id);
CREATE INDEX IF NOT EXISTS cards_vocab_term_id_idx ON cards(vocab_term_id);


-- ─── card_progress ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_progress (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocab_term_id      UUID NOT NULL REFERENCES vocabulary_terms(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ease_factor        REAL NOT NULL DEFAULT 2.5,
  interval_days      INTEGER NOT NULL DEFAULT 0,
  repetitions        INTEGER NOT NULL DEFAULT 0,
  next_review_at     DATE,
  last_quality_score INTEGER,
  last_reviewed_at   TIMESTAMPTZ,
  introduced_at      TIMESTAMPTZ,
  total_reviews      INTEGER NOT NULL DEFAULT 0,
  total_correct      INTEGER NOT NULL DEFAULT 0,
  mastered_at        TIMESTAMPTZ,
  UNIQUE(vocab_term_id, user_id)
);

CREATE INDEX IF NOT EXISTS card_progress_user_review_idx ON card_progress(user_id, next_review_at);
CREATE INDEX IF NOT EXISTS card_progress_mastered_idx ON card_progress(user_id, mastered_at);
CREATE INDEX IF NOT EXISTS card_progress_introduced_idx ON card_progress(user_id, introduced_at);


-- ─── study_sessions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS study_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id         UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  cards_total     INTEGER NOT NULL DEFAULT 0,
  cards_correct   INTEGER NOT NULL DEFAULT 0,
  cards_incorrect INTEGER NOT NULL DEFAULT 0,
  score_pct       REAL
);

CREATE INDEX IF NOT EXISTS study_sessions_user_idx ON study_sessions(user_id);
CREATE INDEX IF NOT EXISTS study_sessions_deck_idx ON study_sessions(deck_id);


-- ─── chat_sessions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deck_id    UUID REFERENCES decks(id) ON DELETE SET NULL,
  title      TEXT NOT NULL DEFAULT 'New conversation',
  messages   JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_sessions_user_idx ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS chat_sessions_updated_idx ON chat_sessions(user_id, updated_at DESC);


-- ─── Auto-update updated_at on chat_sessions ─────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER chat_sessions_updated_at
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
