# How This Works

## Where your data lives

Everything is stored in **Supabase** (a hosted Postgres database):

- **`decks`** — one row per deck (which book/chapter/category, version number)
- **`cards`** — 10 rows per deck (Spanish term, English answer, example sentences)
- **`vocabulary_terms`** — a master list of every Spanish term you've seen, used to track your progress across all decks

---

## Adding a new chapter

1. Take screenshots of the Kindle chapter and drop the PNGs into `docs/chapter-screenshots/`
   — name them `Bk2Ch3p1.png`, `Bk2Ch3p2.png`, etc.
2. Ask Copilot to transcribe — it reads the PNGs and writes `src/data/books/text/bookN-chN.txt`
3. Mark the chapter as available and update `hasText` in the JSON:
   ```bash
   npm run chapter:mark -- 2 3 --mark-only
   ```
4. Seed the decks for that chapter:
   ```bash
   npm run chapter:seed -- --user-id <UUID> --book 2 --chapters 3
   ```

---

## What gets generated per chapter

The seed script calls Gemini once per deck type and creates up to **15 decks of 10 cards each**:

| Deck | What it contains |
|---|---|
| Nouns (general) | Most frequent nouns from the chapter |
| Nouns – A1 | A1-level nouns |
| Nouns – A2 | A2-level nouns |
| Nouns – B1 | B1-level nouns |
| Nouns – B2 | B2-level nouns |
| Verbs – Present | Present-tense verb forms |
| Verbs – Preterite | Preterite (simple past) forms |
| Verbs – Imperfect | Imperfect past forms |
| Verbs – Future | Future-tense forms |
| Verbs – Conditional | Conditional forms |
| Verbs – Imperative | Imperative forms |
| Verbs – Subjunctive | Subjunctive forms |
| Adjectives | Adjectives from the chapter |
| Pronoun Composites | Composite pronoun usages (e.g. *se lo dio*) |
| General | High-frequency vocabulary that doesn't fit other categories |

---

## "Add more" — deck augmentation vs expansion

There are two ways to get more vocabulary from a chapter after you've mastered a deck:

**Augment** (adds cards to the existing deck):
- Tap "Add More" on a deck tile
- The app fetches fresh terms from the same chapter text, excluding all terms already in the deck
- New cards are added directly to the original deck
- Use this when you want to top up a deck without starting a new session

**Expand** (creates a new versioned deck):
- Tap "Expand" on a deck tile
- All terms seen across the entire deck lineage are excluded
- A new deck is created — e.g. *Bk 2 – Ch 1 – Present Tense Verbs v2* — linked back to the original via `parent_deck_id`
- Use this once a deck is fully mastered and you want a clean new session with only fresh words

Both continue until the chapter runs out of new vocabulary for that category.

---

## Reading the annotated chapter text

Once a chapter is seeded, you can read its annotated text at `/reader`:

1. Select the book and chapter from the sidebar
2. The full Spanish text is displayed with vocabulary terms from your decks highlighted inline
3. Colours indicate word type: blue = present tense, orange = imperfect, amber = preterite, etc.
4. Use the filter buttons at the top to show/hide specific word categories
5. This bridges passive reading comprehension with your active flashcard study

---

## Running the seed script

```bash
# Seed specific chapters (recommended)
npm run chapter:seed -- --user-id <UUID> --book 2 --chapters 1-2

# Seed a single chapter
npm run chapter:seed -- --user-id <UUID> --book 2 --chapters 3
```

The script is **idempotent** — it skips any deck that already exists, so it's safe to re-run.

---

## Notes on accented characters

The `chapter:mark` script uses `JSON.parse`/`JSON.stringify` internally, so Spanish accents (é, ó, í, ú, ñ, ü, etc.) in chapter titles are always handled correctly. Never edit `book*.json` files with string-replacement tools directly — use `npm run chapter:mark` instead.
