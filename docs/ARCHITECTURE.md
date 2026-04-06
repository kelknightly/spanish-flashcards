# Architecture
## Spanish Flashcards — Narnia Edition

**Framework:** Next.js 15 (App Router)  
**Last updated:** April 2026

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 15.x |
| Language | TypeScript | ~5.6 |
| Styling | Tailwind CSS | 3.x |
| Components | shadcn/ui | latest |
| AI | Google Gemini API (`gemini-2.0-flash`) | via `@google/generative-ai` |
| Database & Auth | Supabase | `@supabase/supabase-js` 2.x |
| SRS Algorithm | SM-2 (custom TypeScript implementation) | — |
| Glitter effects | `canvas-confetti` | latest |
| Cursor trail | Custom Canvas (no library) | — |
| Deployment | Vercel | — |

---

## Repository Structure

```
spanish-flashcards/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout — applies SparkleCanvas, fonts, Providers
│   ├── globals.css               # Tailwind base + custom CSS variables
│   ├── login/
│   │   └── page.tsx              # Login page (wraps LoginView)
│   ├── (protected)/              # Route group — all routes require auth
│   │   ├── layout.tsx            # Wraps ProtectedLayout
│   │   ├── page.tsx              # Redirect → /decks
│   │   ├── decks/
│   │   │   ├── page.tsx          # Deck library (by-chapter + by-type browsing)
│   │   │   └── [deckId]/
│   │   │       └── page.tsx      # Study session (split-panel / tab layout)
│   │   ├── chat/
│   │   │   └── page.tsx          # Standalone chat (wraps ChatView)
│   │   ├── review/
│   │   │   └── page.tsx          # Due-for-review queue (SM-2 scheduled cards)
│   │   └── reader/
│   │       └── page.tsx          # Annotated chapter reader (wraps ReaderView)
│   └── api/
│       ├── chat/route.ts         # POST — streaming Gemini chat
│       ├── evaluate/route.ts     # POST — AI grading + SM-2 update
│       ├── reader/route.ts       # GET  — chapter text + deck term annotations
│       ├── review/route.ts       # GET  — SM-2 due cards
│       └── decks/
│           ├── route.ts          # GET list / POST create deck
│           └── [deckId]/
│               ├── route.ts      # GET single deck with cards
│               ├── augment/
│               │   └── route.ts  # POST — add more cards to existing deck (same chapter)
│               └── expand/
│                   └── route.ts  # POST — create next versioned deck (v2, v3 …)
│
├── src/
│   ├── components/
│   │   ├── ui/                   # shadcn/ui primitives
│   │   ├── library/              # Deck-library sub-panels
│   │   │   ├── BookListPanel.tsx       # Book selection sidebar
│   │   │   ├── ChapterListPanel.tsx    # Chapter selection sidebar
│   │   │   ├── ChapterDecksPanel.tsx   # Deck grid for a selected chapter
│   │   │   └── TypeBrowseView.tsx      # Cross-chapter browse by deck type
│   │   ├── SparkleCanvas.tsx     # Cursor glitter trail (desktop only)
│   │   ├── ChatPanel.tsx         # AI chat interface (persistent history)
│   │   ├── ProtectedLayout.tsx   # Auth guard + Shell
│   │   ├── Providers.tsx         # React context providers (Auth, Sparkle)
│   │   └── Shell.tsx             # Nav, tab bar, top-level layout
│   ├── contexts/
│   │   ├── AuthContext.tsx       # Supabase auth state
│   │   └── SparkleContext.tsx    # Global sparkle/confetti trigger
│   ├── data/
│   │   └── books/
│   │       ├── index.ts          # Book/chapter metadata + DECK_TYPES registry
│   │       ├── text-loader.ts    # Server-only: reads chapter .txt files from disk
│   │       ├── book1.json        # Book 1 chapter metadata
│   │       ├── book2.json        # Book 2 chapter metadata
│   │       ├── book3.json        # Book 3 chapter metadata
│   │       └── text/             # Chapter plain-text files (bookN-chN.txt)
│   ├── hooks/
│   │   ├── useSound.ts           # Audio feedback hook
│   │   └── useStreak.ts          # Day-streak fetch + display
│   ├── lib/
│   │   ├── supabase.ts           # Supabase client
│   │   ├── auth-api.ts           # Server-side JWT validation + email allowlist
│   │   ├── gemini.ts             # Gemini client initialisation + helper types
│   │   ├── sm2.ts                # SM-2 algorithm (pure TypeScript)
│   │   └── utils.ts              # cn(), format helpers
│   └── views/
│       ├── LoginView.tsx         # Login form UI
│       ├── DeckLibraryView.tsx   # Browseable deck list (by chapter or type)
│       ├── StudyView.tsx         # Split-panel study session (chat + flashcards)
│       ├── ReviewView.tsx        # Due-cards SM-2 review session
│       ├── ChatView.tsx          # Standalone chat page wrapper
│       └── ReaderView.tsx        # Annotated chapter text reader
│
├── scripts/
│   ├── seed-decks.ts             # Seed all deck types for a chapter (idempotent)
│   ├── patch-chapter-text.mjs    # Mark chapters as hasText + update book JSON
│   ├── patch-card-sentences.ts   # Backfill source_sentences on existing cards
│   ├── patch-pronoun-composites.ts # One-off: seed pronoun-composite deck type
│   ├── patch-remove-card.ts      # One-off: delete a specific card by ID
│   └── audit-decks.ts            # Report deck/card counts and missing data
│
├── docs/                         # Project documentation
│   ├── PRD.md
│   ├── DATA_MODEL.md
│   ├── ARCHITECTURE.md
│   └── How This Works.md
│
├── public/
│   └── sounds/                   # Audio feedback files
├── supabase/
│   └── migrations/               # SQL migration files (run in Supabase Dashboard)
├── .env                          # Local secrets (never committed)
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## App Router — Page Descriptions

### `/login`
- Public route
- Renders `LoginView` — email/password form
- On success, redirects to `?from=` param or `/decks`

### `/(protected)/decks`
- Lists all saved decks for the user
- Two browse modes (toggled via tab bar): **By Chapter** (Book → Chapter → Decks panel) and **By Type** (cross-chapter view grouped by subcategory)
- Each deck tile shows: name, card count, mastered count, reviewed count, version badge, Expand / Augment buttons

### `/(protected)/decks/[deckId]`
- Primary study screen
- **Desktop:** two-column split — `ChatPanel` (left), `FlashCard` study interface (right)
- **Mobile:** two-tab layout — "Chat" tab and "Study" tab
- URL includes `deckId` so sessions are resumable and shareable via link

### `/(protected)/chat`
- Standalone chat for starting a new deck from screenshots
- `ChatPanel` fills the screen; once a deck is confirmed and saved, redirects to `/decks/[deckId]`

### `/(protected)/review`
- Shows all cards due today (SM-2 scheduled) across all decks
- Same study interface as the main study session

### `/(protected)/reader`
- Annotated chapter text reader (`ReaderView`)
- Select a book + chapter from the sidebar; the chapter text is displayed with vocabulary terms highlighted by deck type (verb tense, noun CEFR level, etc.)
- Colour-coded spans match the subcategory palette; toggleable filter buttons let you show/hide each word type
- Powered by `GET /api/reader` which joins chapter text with the user's existing deck cards

---

## API Routes

All API routes validate the Supabase JWT from the `Authorization: Bearer <token>` header using `getAuthUserFromRequest()` from `lib/auth-api.ts`.

### `POST /api/chat`
Streams a Gemini response to the chat panel.

**Request body:**
```json
{
  "messages": [{ "role": "user|model", "content": "...", "attachments": ["base64..."] }],
  "chatSessionId": "uuid | null",
  "deckId": "uuid | null"
}
```
- Images are passed as inline base64 to Gemini Vision
- Response is streamed using Next.js streaming (`ReadableStream`)
- Saves updated message history to `chat_sessions` table

### `POST /api/evaluate`
AI evaluates a flashcard answer and returns a quality score + feedback.

**Request body:**
```json
{
  "cardId": "uuid",
  "spanishTerm": "éramos",
  "englishAnswer": "we were",
  "sourceSentences": [{ "es": "...", "en": "..." }],
  "userResponse": "we are? or we were? i'm not sure about the tense"
}
```

**Response:**
```json
{
  "qualityScore": 3,
  "isCorrect": true,
  "feedback": "You got the meaning right but your uncertainty about the tense is worth noting. 'éramos' is imperfect ...",
  "nextReviewAt": "2026-04-11"
}
```
- Calls Gemini with a structured prompt; expects JSON back
- Runs SM-2 update in `lib/sm2.ts`
- Upserts `card_progress` row in Supabase
- Updates `study_sessions` running totals

### `POST /api/decks`
Creates a new deck and its cards. Called by `ChatPanel` once the AI has extracted a card set.

**Request body:**
```json
{
  "name": "Bk 1 - Ch 15 - verbs - present tense",
  "bookNumber": 1,
  "chapterNumber": 15,
  "category": "verbs",
  "subcategory": "present tense",
  "sourceText": "...",
  "cards": [
    {
      "spanishTerm": "éramos",
      "englishAnswer": "we were",
      "sourceSentences": [{ "es": "...", "en": "..." }],
      "position": 0
    }
  ]
}
```

### `GET /api/decks`
Returns all decks for the authenticated user, with card counts and next-review counts.

### `GET /api/decks/[deckId]`
Returns a single deck with all its cards and `card_progress` rows.

### `GET /api/review`
Returns all cards due for SM-2 review today, joined with their deck names.

### `GET /api/reader`
Returns the plain-text content of a chapter plus a map of vocabulary term → subcategory, built from all decks the user has for that book/chapter. Used by `ReaderView` to annotate the text.

**Query params:** `?book=1&chapter=3`

**Response:**
```json
{
  "text": "Era una noche oscura …",
  "termMap": { "era": "verbs-imperfect", "noche": "nouns-a1" }
}
```

### `POST /api/decks/[deckId]/augment`
Adds more cards to an **existing** deck from the same chapter's text. Fetches the chapter text server-side, collects all terms already in the deck, and asks Gemini for additional terms of the same subcategory. Cards are inserted directly into the original deck.

### `POST /api/decks/[deckId]/expand`
Creates a **new versioned deck** (v2, v3 …) from the same chapter + subcategory as the source deck. All previously seen terms across the deck lineage are excluded from the new batch. The new deck's `parent_deck_id` points back to the original.

---

## AI Integration — Gemini

**Model:** `gemini-2.0-flash`  
**Library:** `@google/generative-ai`  
**API key:** `GEMINI_API_KEY` server-side env var (never exposed to client)

### Gemini is used for three distinct tasks:

**1. Screenshot OCR + deck extraction (chat)**
- Images uploaded as base64 inline parts to the Gemini multimodal API
- System prompt instructs the model to: extract text faithfully, then follow the user's extraction request, then return a structured JSON deck
- The chat panel streams the conversational part; the structured deck JSON is parsed separately

**2. Answer evaluation (`/api/evaluate`)**
- Single non-streaming call with a structured prompt
- Prompt includes: the Spanish term, the canonical English answer, the source sentences, and the user's free-text response
- Instructed to return JSON `{ qualityScore: 0–5, feedback: string }`
- Temperature set low (0.2) for consistent quality scoring

**3. English sentence translation**
- When source sentences are extracted, Gemini translates `es` → `en` for each sentence before saving to `source_sentences` JSONB

---

## Auth Flow

```
User visits any (protected) route
        │
        ▼
ProtectedLayout checks AuthContext
        │
   ┌────┴────┐
   │ loading │ → spinner
   └────┬────┘
        │
   user null?
   ┌────┴────┐
   │  yes    │ → redirect /login?from=[current path]
   └────┬────┘
        │
   user present?
   ┌────┴────┐
   │  yes    │ → render Shell + page
   └─────────┘

API routes: every request validated via getAuthUserFromRequest()
            + isAllowedEmail() — only Kelly's email passes
```

---

## Responsive Layout

### Desktop / Tablet (≥768px) — Study screen
```
┌─────────────────────────┬─────────────────────────┐
│   AI Chat Panel         │   Flashcard Interface   │
│                         │                         │
│  [Screenshot upload]    │  ┌─────────────────┐   │
│                         │  │   éramos        │   │
│  [Chat history]         │  │                 │   │
│                         │  │  [Reveal]       │   │
│  [Input]                │  │  [Answer field] │   │
│                         │  └─────────────────┘   │
│                         │                         │
│                         │  Score: 5/10 ✓ 3/10 ✗  │
└─────────────────────────┴─────────────────────────┘
```

### Mobile Portrait (<768px) — Study screen
```
┌──────────────────────┐
│  [Chat] [Study]      │  ← Tab bar
├──────────────────────┤
│                      │
│    (Active tab)      │
│                      │
└──────────────────────┘
```

---

## Environment Variables

```bash
# Supabase (same pattern as Hubspot Growth Dashboard)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Gemini (server-side only — never NEXT_PUBLIC_)
GEMINI_API_KEY=

# Access control — only these emails can sign in
ALLOWED_ACCESS_EMAILS=kelly@youremail.com
```

---

## Key Implementation Notes

- **SM-2 is pure TypeScript** — no library dependency. Computed server-side in `/api/evaluate` so the algorithm is not exposed to the client and scores cannot be tampered with.
- **Streaming chat** — `ChatPanel` uses `fetch` with a `ReadableStream` reader to incrementally display Gemini tokens as they arrive, for a natural feel.
- **Card state is never held only in React state** — after each flip, `card_progress` is written to Supabase immediately, so a phone lock or tab switch never loses progress.
- **`SparkleCanvas` is conditionally mounted** — `typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches` prevents it from mounting on touch devices at all.
- **`canvas-confetti` is dynamically imported** — `import('canvas-confetti')` inside the flip handler keeps it out of the initial JS bundle.
- **Supabase RLS** — all tables have Row Level Security enabled. Data is protected at the database layer, not just the API layer.
