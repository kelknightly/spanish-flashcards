# Data Model
## Spanish Flashcards — Narnia Edition

**Database:** Supabase (PostgreSQL)  
**Last updated:** April 2026

---

## Tables

### `users`

Managed by Supabase Auth — no custom table needed. The `auth.users` table is used directly. The user's UUID from `auth.users.id` serves as the foreign key in all other tables.

Access control is enforced via:
- Supabase email/password auth
- `ALLOWED_ACCESS_EMAILS` environment variable checked in API routes (same pattern as Hubspot Growth Dashboard)

---

### `decks`

A flashcard deck created from one chapter's screenshots.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key, default `gen_random_uuid()` |
| `user_id` | `uuid` | FK → `auth.users.id`, not null |
| `name` | `text` | Auto-named then user-editable. Convention: `Bk [N] - Ch [N] - [category] - [subcategory]`. Example: `Bk 1 - Ch 15 - verbs - present tense - first person` |
| `book_number` | `integer` | e.g. `1` for *The Lion, the Witch and the Wardrobe* |
| `chapter_number` | `integer` | Source chapter number |
| `category` | `text` | e.g. `verbs`, `nouns`, `adjectives` |
| `subcategory` | `text` | e.g. `present tense`, `first person` (nullable) |
| `source_text` | `text` | Full extracted text from all uploaded screenshots for this deck (used for sentence lookup) |
| `created_at` | `timestamptz` | Default `now()` |
| `last_studied_at` | `timestamptz` | Nullable; updated on each study session |
| `version` | `integer` | Deck version within its lineage. Starts at `1`; incremented each time `/api/decks/[deckId]/expand` creates a successor. |
| `is_system_generated` | `boolean` | `true` for decks seeded by the `chapter:seed` script; `false` for user-created decks. Default `false`. |
| `parent_deck_id` | `uuid` | FK → `decks.id` (nullable, `ON DELETE SET NULL`). Set on expanded versioned decks to point back to the root deck of their lineage. |

**Indexes:** `user_id`, `(book_number, chapter_number)`, `parent_deck_id`, `(user_id, book_number, chapter_number, subcategory, version)`

---

### `vocabulary_terms`

A normalised registry of unique Spanish terms encountered by the user across all decks and chapters. This is the anchor for cross-deck SM-2 progress sharing — if the same conjugated form appears in multiple chapters, it has one `vocabulary_terms` row and one `card_progress` row whose interval/ease span all its appearances.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key, default `gen_random_uuid()` |
| `user_id` | `uuid` | FK → `auth.users.id` |
| `spanish_term` | `text` | Fully conjugated form as it appears in the text. e.g. `éramos` |
| `created_at` | `timestamptz` | Default `now()` |

**Unique constraint:** `(user_id, spanish_term)`  
**Indexes:** `(user_id, spanish_term)`

---

### `cards`

Individual flashcards within a deck. Each card references a `vocabulary_terms` row so that SM-2 progress is shared across all decks where the same term appears.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key, default `gen_random_uuid()` |
| `deck_id` | `uuid` | FK → `decks.id`, cascade delete |
| `vocab_term_id` | `uuid` | FK → `vocabulary_terms.id`. Resolved at deck creation by upsert on `(user_id, spanish_term)`. |
| `spanish_term` | `text` | Denormalised copy for fast display without a join |
| `english_answer` | `text` | The canonical English translation. Used on the flipped card face. |
| `source_sentences` | `jsonb` | Array of objects: every sentence in **this deck's chapter** where `spanish_term` appears. Schema: `[{ "es": "...", "en": "..." }]`. `es` = Spanish source sentence. `en` = English translation (AI-generated). |
| `position` | `integer` | Display order within the deck |
| `created_at` | `timestamptz` | Default `now()` |

**Indexes:** `deck_id`, `vocab_term_id`

**Notes:**
- `source_sentences` is per-deck (sentences from that chapter only). The full cross-chapter history is assembled via `vocab_term_id` if needed.
- `english_answer` is the AI's canonical answer for this deck's usage. The AI's evaluation of the user's free-text input is separate and not stored here.

---

### `card_progress`

SM-2 spaced repetition state per vocabulary term per user. **Keyed on `vocab_term_id`**, not `card_id` — this is what makes progress shared across decks when the same conjugated Spanish form appears in multiple chapters. One row per unique term (upserted on first study, updated on every subsequent review).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `vocab_term_id` | `uuid` | FK → `vocabulary_terms.id`, cascade delete |
| `user_id` | `uuid` | FK → `auth.users.id` |
| `ease_factor` | `float4` | SM-2 ease factor. Default `2.5`. Range: 1.3–∞. Decreases when quality < 3. |
| `interval_days` | `integer` | Days until next review. Starts at 1, then 6, then grows by ease_factor each rep. |
| `repetitions` | `integer` | Count of consecutive reviews with quality ≥ 3. Resets to 0 on failure. |
| `next_review_at` | `date` | Scheduled next review date. Cards with `next_review_at <= today` are "due". |
| `last_quality_score` | `integer` | 0–5 quality score from last AI evaluation. |
| `last_reviewed_at` | `timestamptz` | Timestamp of last review. |
| `total_reviews` | `integer` | All-time review count across all decks for this term. |
| `total_correct` | `integer` | All-time count of reviews with quality ≥ 3. |
| `mastered_at` | `timestamptz` | Nullable. Set the first time `interval_days` reaches ≥ 21. Triggers the "Word learned" toast. |
| `introduced_at` | `timestamptz` | Set on first study of this term. Used to enforce the daily new-card cap without counting re-reviews. |

**Unique constraint:** `(vocab_term_id, user_id)`  
**Indexes:** `(user_id, next_review_at)` — for efficient "due cards" queries; `(user_id, mastered_at)` — for mastery ring calculations

---

### `user_profiles`

Stores per-user app state that lives outside Supabase Auth. One row per user, upserted on first login.

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` | PK + FK → `auth.users.id` |
| `current_streak` | `integer` | Current consecutive study day streak. Default `0`. |
| `last_active_date` | `date` | The calendar date of the last study activity. Used to determine if streak should increment or reset. |
| `longest_streak` | `integer` | All-time highest streak. Default `0`. |

---

### `study_sessions`

A single sitting of studying a deck. Used for session scoreboard and history.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `deck_id` | `uuid` | FK → `decks.id` |
| `user_id` | `uuid` | FK → `auth.users.id` |
| `started_at` | `timestamptz` | Default `now()` |
| `completed_at` | `timestamptz` | Nullable; set when user finishes deck |
| `cards_total` | `integer` | Card count at session start |
| `cards_correct` | `integer` | Running count of quality ≥ 3 |
| `cards_incorrect` | `integer` | Running count of quality < 3 |
| `score_pct` | `float4` | Final score percentage (set on completion) |

---

### `chat_sessions`

Persisted AI chat conversations. One per deck creation or study session.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `user_id` | `uuid` | FK → `auth.users.id` |
| `deck_id` | `uuid` | FK → `decks.id`, nullable (may exist before deck is saved) |
| `title` | `text` | Auto-generated from first user message; editable |
| `messages` | `jsonb` | Ordered array of message objects (see schema below) |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Updated on each new message |

**`messages` JSONB schema:**
```json
[
  {
    "role": "user" | "model",
    "content": "string",
    "timestamp": "ISO 8601 string",
    "attachments": ["image_url"] // optional, for screenshot uploads
  }
]
```

**Indexes:** `user_id`, `updated_at DESC` (for listing recent chats)

---

## SM-2 Algorithm Reference

The SM-2 update is computed in TypeScript on the server (API route) after each AI evaluation:

```typescript
function updateSM2(
  current: { easeFactor: number; intervalDays: number; repetitions: number },
  quality: number // 0–5, AI-assigned
): { easeFactor: number; intervalDays: number; repetitions: number; nextReviewAt: Date } {
  let { easeFactor, intervalDays, repetitions } = current

  if (quality < 3) {
    // Failed recall — reset streak, review again soon
    repetitions = 0
    intervalDays = 1
  } else {
    // Successful recall — advance interval
    if (repetitions === 0) intervalDays = 1
    else if (repetitions === 1) intervalDays = 6
    else intervalDays = Math.round(intervalDays * easeFactor)
    repetitions += 1
  }

  // Adjust ease factor (never below 1.3)
  easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))

  const nextReviewAt = new Date()
  nextReviewAt.setDate(nextReviewAt.getDate() + intervalDays)

  return { easeFactor, intervalDays, repetitions, nextReviewAt }
}
```

**Quality scale (AI-assigned):**
| Score | Meaning |
|---|---|
| 5 | Perfect, immediate recall |
| 4 | Correct with slight hesitation |
| 3 | Correct with significant difficulty |
| 2 | Incorrect but close — recalled correctly when shown answer |
| 1 | Incorrect — answer was familiar when shown |
| 0 | Complete blank — no recognition |

Scores ≥ 3 = correct (green); scores < 3 = incorrect (red) in the UI.

---

## Supabase RPCs

### `get_deck_mastery_stats(deck_ids uuid[], p_user_id uuid)`

Returns per-deck card counts called from `GET /api/decks` to avoid N+1 queries.

**Returns:** `table(deck_id uuid, total_cards bigint, mastered_cards bigint, reviewed_cards bigint)`

- `total_cards` — all cards in the deck
- `mastered_cards` — cards whose `card_progress.mastered_at` is not null (interval ≥ 21 days)
- `reviewed_cards` — cards that have any `card_progress` row (studied at least once), regardless of mastery

---

## Relationships Diagram

```
auth.users
    │
    ├── user_profiles (user_id)               ← streak, last_active_date
    │
    ├── vocabulary_terms (user_id)            ← one row per unique Spanish term
    │       │
    │       └── card_progress (vocab_term_id, user_id)  ← SM-2 state, shared cross-deck
    │
    ├── decks (user_id)
    │       │
    │       ├── cards (deck_id) ──────────────── vocab_term_id → vocabulary_terms
    │       │
    │       ├── study_sessions (deck_id, user_id)
    │       │
    │       └── chat_sessions (deck_id, user_id)
    │
    └── (card_progress, study_sessions, chat_sessions all also indexed on user_id)
```

**Key design point:** `card_progress` sits under `vocabulary_terms`, not under `cards`. When `éramos` appears in both Ch 5 and Ch 12, there are two `cards` rows (one per deck), one `vocabulary_terms` row, and one `card_progress` row whose SM-2 state reflects all reviews of that term regardless of which deck triggered them.

---

## Row-Level Security (Supabase RLS)

All tables should have RLS enabled with a policy of the form:

```sql
-- Example for decks table
CREATE POLICY "Users can only access their own decks"
ON decks
FOR ALL
USING (user_id = auth.uid());
```

Same pattern applies to `cards` (via deck ownership), `card_progress`, `study_sessions`, and `chat_sessions`.
