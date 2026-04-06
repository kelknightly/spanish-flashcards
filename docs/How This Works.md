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

The seed script calls Gemini once per deck type and creates **8 decks of 10 cards each**:

| Deck | What it contains |
|---|---|
| Nouns | 10 common nouns from the chapter (with articles) |
| Verbs – Present | 10 present-tense verb forms from the chapter |
| Verbs – Preterite | 10 preterite (simple past) forms |
| Verbs – Imperfect | 10 imperfect past forms |
| Verbs – Future | 10 future-tense forms |
| Verbs – Conditional | 10 conditional forms |
| Verbs – Imperative | 10 imperative forms |
| Verbs – Subjunctive | 10 subjunctive forms |

---

## "Add 10 more" (deck expansion)

Once you've mastered every card in a deck, you can request 10 more words in the same category from the same chapter:

1. The app checks that all cards are mastered
2. It collects every term you've already seen in this deck's history (so nothing repeats)
3. It calls Gemini again with the same chapter text, asking for fresh terms only
4. A new versioned deck is created — e.g. *Bk 2 – Ch 1 – nouns v2* — linked back to the original

This continues until the chapter runs out of new vocabulary.

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
