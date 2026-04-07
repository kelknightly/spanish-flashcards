-- Add is_custom flag to distinguish Reader word-click decks from system and chat decks
ALTER TABLE decks
  ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT false;
