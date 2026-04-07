-- Add daily record column for personal best tracking
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS daily_record_cards integer NOT NULL DEFAULT 0;
