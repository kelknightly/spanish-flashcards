---
name: chapter-ingestion
description: "Convert Kindle chapter screenshots into text files and seed flashcard decks. Use when: adding new chapters, ingesting screenshots, seeding decks, transcribing Narnia chapter text, running chapter:mark or chapter:seed."
argument-hint: "e.g. Book 2 chapters 5-6"
---

# Chapter Ingestion

Converts Kindle screenshots → `.txt` files → marks chapters available → seeds flashcard decks.

## Known constants — do not rediscover these

| Fact | Value |
|---|---|
| Supabase user UUID | `c49bf071-9572-44c2-b8c8-c40a33984e79` |
| Screenshot folder | `docs/chapter-screenshots/` |
| Text output folder | `src/data/books/text/` |
| Screenshot naming | `Bk{N}Ch{N}p{N}.png` |
| Text file naming | `book{N}-ch{N}.txt` |
| Mark command | `npm run chapter:mark -- {bookN} {chN} --mark-only` |
| Seed command | `npm run chapter:seed -- --user-id c49bf071-9572-44c2-b8c8-c40a33984e79 --book {N} --chapters {N}` |
| Seed range syntax | `--chapters 3-5` (inclusive) |

## Step 1 — Identify new chapters

Run this once, do not read any other files:

```bash
ls src/data/books/text/
```

Compare against `docs/chapter-screenshots/`. Any `Bk{B}Ch{C}p1.png` whose corresponding `book{B}-ch{C}.txt` does **not** exist is a new chapter to process.

## Step 2 — Transcribe screenshots

For each new chapter, view **all** its pages (p1, p2, … pN) before writing anything.

### Transcription protocol

The Kindle layout is two columns of body text, preceded by a chapter heading illustration and title block. Read in this strict order:

1. **Left column, top to bottom** — complete it fully before moving right
2. **Right column, top to bottom**
3. Move to the next page and repeat

Do not paraphrase, translate, summarise, or infer. Copy every word exactly as printed, including:
- Em-dash dialogue markers (`—`)
- Spanish diacritics (`á é í ó ú ñ ü ¿ ¡ «»`)
- Italicised interior-monologue passages

### File format

Match this structure exactly (see existing files for reference):

```
CAPÍTULO {NUMBER-WORD}
{Chapter title in Spanish}

{Body text...}
```

No blank line between the two heading lines. One blank line before the first paragraph. Paragraphs separated by a blank line. Dialogue lines are **not** separated by blank lines from adjacent dialogue.

### Quality check before saving

After transcribing, verify:
- [ ] Chapter heading and title match the `book{N}.json` `titleEs` field
- [ ] No mid-paragraph breaks that should be merged
- [ ] No paragraph jumps (re-read the transition between left and right columns)
- [ ] Last sentence of each page reviewed to ensure it continues correctly on the next

## Step 3 — Mark chapters

Run one command per chapter:

```bash
npm run chapter:mark -- {bookNumber} {chapterNumber} --mark-only
```

Confirm output shows `hasText=true` and a non-zero character count.

## Step 4 — Seed decks

Seed all new chapters in a single command using range syntax:

```bash
npm run chapter:seed -- --user-id c49bf071-9572-44c2-b8c8-c40a33984e79 --book {N} --chapters {first}-{last}
```

Single chapter:

```bash
npm run chapter:seed -- --user-id c49bf071-9572-44c2-b8c8-c40a33984e79 --book {N} --chapters {N}
```

The seed script is idempotent — safe to re-run. Confirm output shows 8 decks created per chapter (nouns + 7 verb tenses), 10 cards each.

## What gets created per chapter

| Deck | Content |
|---|---|
| nouns | 10 common nouns (with articles) |
| verbs-present | 10 present-tense forms |
| verbs-preterite | 10 preterite forms |
| verbs-imperfect | 10 imperfect forms |
| verbs-future | 10 future forms |
| verbs-conditional | 10 conditional forms |
| verbs-imperative | 10 imperative forms |
| verbs-subjunctive | 10 subjunctive forms |

## Notes on image resolution

Low-resolution screenshots make the second column's small text ambiguous. If any word or sentence cannot be read with confidence, flag it in the response with `[unclear: …]` rather than guessing. Higher-resolution screenshots eliminate this problem entirely.
