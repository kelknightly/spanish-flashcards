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
│   └── (protected)/              # Route group — all routes require auth
│       ├── layout.tsx            # Wraps ProtectedLayout
│       ├── page.tsx              # Redirect → /decks
│       ├── decks/
│       │   ├── page.tsx          # Deck library
│       │   └── [deckId]/
│       │       └── page.tsx      # Study session (split-panel / tab layout)
│       ├── chat/
│       │   └── page.tsx          # Standalone chat (for new deck extraction)
│       ├── review/
│       │   └── page.tsx          # Due-for-review queue (SM-2 scheduled cards)
│       └── settings/
│           └── page.tsx          # Account / preferences
│
├── src/
│   ├── components/
│   │   ├── ui/                   # shadcn/ui primitives
│   │   ├── SparkleCanvas.tsx     # Cursor glitter trail (desktop only)
│   │   ├── FlashCard.tsx         # Card flip component + confetti trigger
│   │   ├── ChatPanel.tsx         # AI chat interface (persistent history)
│   │   ├── DeckCard.tsx          # Deck library tile
│   │   ├── ScoreBoard.tsx        # Running session score display
│   │   ├── ProtectedLayout.tsx   # Auth guard + Shell (same pattern as Hubspot dashboard)
│   │   └── Shell.tsx             # Nav, tab bar, top-level layout
│   ├── contexts/
│   │   └── AuthContext.tsx       # Supabase auth state (direct copy from Hubspot dashboard)
│   ├── lib/
│   │   ├── supabase.ts           # Supabase client (same pattern as Hubspot dashboard)
│   │   ├── auth-api.ts           # Server-side JWT validation + email allowlist
│   │   ├── gemini.ts             # Gemini client initialisation + helper types
│   │   ├── sm2.ts                # SM-2 algorithm (pure TypeScript function)
│   │   └── utils.ts              # cn(), format helpers
│   └── views/
│       ├── LoginView.tsx         # Login form UI
│       ├── DeckLibraryView.tsx   # Browseable deck list
│       ├── StudyView.tsx         # Split-panel study session (chat + flashcards)
│       ├── ReviewView.tsx        # Due-cards review session
│       └── SettingsView.tsx      # Settings page
│
├── docs/                         # Project documentation
│   ├── PRD.md
│   ├── DATA_MODEL.md
│   └── ARCHITECTURE.md
│
├── public/                       # Static assets
├── .env                          # Local secrets (never committed)
├── .env.example                  # Template (committed)
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
- Each deck tile shows: name, card count, last studied, best score, due-card count
- "New deck" button → `/chat` to start an extraction session

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
- Same `FlashCard` interface as study session

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
