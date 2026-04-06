# Product Requirements Document
## Spanish Flashcards — Narnia Edition

**Owner:** Kelly  
**Last updated:** April 2026  
**Status:** Active

---

## 1. Purpose & Context

A personal web app designed to support adult second-language acquisition (SLA) of Spanish through structured, scientifically-backed flashcard study sessions. Source material is *The Chronicles of Narnia* series, read chapter-by-chapter in English first, then Spanish (with companion audiobook), then Spanish unsupported.

After each chapter study cycle, the user uploads screenshots of the Spanish text and uses an AI agent to extract vocabulary into targeted flashcard decks. Study sessions use free-text recall + AI grading fed into the SM-2 spaced repetition algorithm.

---

## 2. Learning Methodology

This app is explicitly grounded in evidence-based SLA principles:

- **Comprehensible input first**: Reading in English before Spanish, then Spanish with audio support, then Spanish unaided — follows Krashen's Input Hypothesis (i+1 challenge level).
- **Spaced repetition (SM-2)**: Cards are scheduled for review at increasing intervals based on recall quality. Struggling cards surface soon; mastered cards recede. This is the same algorithm used by Anki, backed by decades of memory research.
- **Contextualised recall**: Every card can reveal the sentence it appears in rather than studying words in isolation, consistent with contextual learning research.
- **Free-text production**: No multiple-choice. The user must produce the answer, which activates active recall rather than passive recognition — the stronger learning mode.
- **AI-mediated feedback**: The AI evaluates the free-text response on a 0–5 quality scale (not binary right/wrong), which feeds SM-2 and provides nuanced explanatory feedback. This exceeds what static answer-checking can do.

---

## 3. User

Single user (Kelly). Light email/password login layer to:
- Persist progress across devices (laptop by day, phone at night)
- Protect data on a live domain from other users
- Allow continued chat sessions across devices

No team or multi-user features required.

---

## 4. Platform

- **Mobile-friendly progressive web app** (Next.js deployed on Vercel)
- Responsive layout: split-panel on tablet/desktop, tab-based on mobile portrait
- No native iOS/Android app required
- No offline support required

---

## 5. Feature List

### 5.1 Chapter Seeding (Primary Workflow)

The primary deck-creation path is a scripted pipeline:

1. Screenshot the Kindle chapter and save PNGs to `docs/chapter-screenshots/`
2. Ask Copilot to transcribe the screenshots to `src/data/books/text/bookN-chN.txt`
3. Mark the chapter as available: `npm run chapter:mark -- N N --mark-only`
4. Seed all decks: `npm run chapter:seed -- --user-id <UUID> --book N --chapters N`

The seed script calls Gemini once per deck type and creates up to **15 decks of 10 cards each**, covering:

| Subcategory key | What it contains |
|---|---|
| `nouns` | Most frequent nouns from the chapter |
| `nouns-a1` | A1-level nouns |
| `nouns-a2` | A2-level nouns |
| `nouns-b1` | B1-level nouns |
| `nouns-b2` | B2-level nouns |
| `verbs-present` | Present-tense verb forms |
| `verbs-preterite` | Preterite (simple past) forms |
| `verbs-imperfect` | Imperfect past forms |
| `verbs-future` | Future-tense forms |
| `verbs-conditional` | Conditional forms |
| `verbs-imperative` | Imperative forms |
| `verbs-subjunctive` | Subjunctive forms |
| `adjectives` | Adjectives |
| `pronoun-composites` | Composite pronoun usages (e.g. *se lo dio*) |
| `general` | General high-frequency vocabulary |

Decks are auto-named: e.g. `Bk 2 – Ch 3 – Present Tense Verbs`. The script is **idempotent** — it skips any deck that already exists.

### 5.1a AI Chat Extraction (Secondary Workflow)

- User uploads 5–10 screenshots per chapter into the chat panel
- Gemini Vision reads the text off the images automatically
- User types a natural-language request to define a custom deck
- AI returns a structured flashcard deck ready to study
- Useful for ad-hoc or non-standard deck types not covered by the seed script

### 5.2 AI Chat Panel

- Persistent split-panel (left side on desktop; Chat tab on mobile)
- Conversation history is preserved within and across sessions
- User can view and continue past conversations
- AI maintains full context of the current deck and any cards already answered in the session
- Used for: deck extraction, answer evaluation, follow-up questions, vocabulary explanations

### 5.3 Flashcard Study Interface

**Card front (prompt side):**
- Displays the Spanish word/phrase as it appears in the text (fully conjugated, no lemma)
- No hints, no translation, no sentence shown by default
- "Reveal sentence" button: shows every sentence in the chapter where the word appears (pulled from the extracted source text)
- Free-text input field for the user's English response — no static answer matching
- "Submit" button sends the response + card context to the AI for evaluation

**Card flip (result side):**
- Card flips to reveal the result
- Visual result indicator: green checkmark (correct) or red X (incorrect) — AI-determined on a 0–5 scale; scores ≥ 3 count as correct
- Correct English answer displayed
- English translation of the source sentence(s) displayed
- AI feedback displayed (what was right, what was wrong, any nuance missed)
- Glitter confetti fires from all four card borders on flip in result-matched colours (see §6.3)
- Card shake animation fires on incorrect result before glitter (see §6.5)

**Session scoreboard (persistent, visible during study):**
- Cards correct so far (e.g. 5/10)
- Cards incorrect so far (e.g. 3/10)
- Cards remaining
- Score percentage (running)

### 5.4 Deck Management

- Save decks to the database with their structured names
- Browse all saved decks
- Decks display: name, date created, book/chapter, card count, last studied date, best score, SM-2 mastery ring (% of cards with interval ≥ 21 days), difficulty badge per card
- Resume any saved deck
- "Review wrong cards" mode: re-studies only cards marked incorrect in the last session (or across all sessions)
- **Deck expansion**: once all cards in a deck are mastered, an "Expand" button creates a successor deck (v2, v3 …) with fresh terms from the same chapter + subcategory. All previously seen terms are excluded.
- **Deck augmentation**: an "Add more" button adds additional cards directly to an existing deck from the same chapter text.

### 5.4b Annotated Chapter Reader

- A dedicated `/reader` page displays the full Spanish text of any chapter that has been transcribed
- Vocabulary terms from the user's existing decks are **highlighted inline**, colour-coded by deck type (verb tense, noun CEFR level, etc.)
- Toggleable filter buttons let the user show/hide each word category
- Tapping/clicking a highlighted word shows its deck origin and English translation
- Provides reading-in-context support — a bridge between passive comprehension and active flashcard recall

### 5.4a Deck Completion Screen

- When the last card in a deck is answered, a full-screen results card replaces the study view
- Displays: final score, personal best for that deck, breakdown of correct/incorrect, "Study wrong cards" button, "Return to library" button
- One-sentence personalised message generated by Gemini (e.g. *"Great work — you're getting close to mastering this chapter's verbs!"*)
- If score ≥ 80%: full-screen palette confetti cannon fires once (`spread: 360`, `origin: { y: 0.4 }`)
- If score < 80%: a warm encouragement message + gentle shimmer animation (no cannon)

### 5.5 Progress Tracking

- Per-card SM-2 state stored persistently: `ease_factor`, `interval_days`, `repetitions`, `next_review_date`, `last_quality_score`
- "Due for review" queue: cards whose `next_review_date` is today or overdue surface automatically
- Per-deck history: session scores over time
- **Day streak counter**: displayed in the app header. Increments each calendar day that at least one card is studied. Resets to 0 if a day is missed. Stored as `current_streak` + `last_active_date` on the user profile. Shown with a flame icon (e.g. 🔥 12).
- **"Word learned" milestone toast**: when a card's `interval_days` reaches ≥ 21 for the first time, a toast notification appears — *"You've learned 'éramos'! 🎉"*. Marks long-term memory graduation.
- **Difficulty badge per card**: each card displays a pill — New / Hard / Moderate / Easy — derived from `ease_factor` and `repetitions`. Visible when browsing a deck before studying.
- **SM-2 mastery ring**: each deck tile shows a circular progress ring indicating the % of cards with `interval_days ≥ 21` (mastered). Gives a visceral sense of accumulating fluency.
- No public leaderboard or sharing features

### 5.6 Authentication

- Supabase email/password auth (same pattern as Hubspot Growth Dashboard project)
- `ALLOWED_ACCESS_EMAILS` env var gates access to Kelly's email only
- Session persists across devices via Supabase JWT
- `(protected)` route group with `ProtectedLayout` + `AuthContext` pattern
- Redirects to `/login?from=` and back on auth

---

## 6. Visual Design

### 6.1 Colour Palette

Dark background theme. Neon-on-dark for maximum vibrancy.

| Role | Colour | Hex |
|---|---|---|
| Primary | Hot pink | `#FF2D9B` |
| Secondary | Electric purple | `#9B2DFF` |
| Accent A | Neon blue | `#2DAAFF` |
| Accent B | Lime green | `#2DFF9B` |
| Special | Gold | `#FFD700` |
| Special | Silver | `#C0C0C0` |
| Background | Deep purple-black | `#0D0A1A` |
| Surface | Dark purple | `#1A1530` |
| Text | White | `#FFFFFF` |

Defined as a custom Tailwind CSS theme in `tailwind.config.ts`.

### 6.2 Cursor Sparkle Trail (desktop only)

- Global `<canvas>` overlay: `position: fixed`, `pointer-events: none`, full viewport, top z-index
- Particle system triggered on `mousemove`
- Particles: 2–4px, short-lived (~25 frames), fade from 0.8 → 0 opacity
- Colours cycle through palette + gold/silver
- Max pool: 60 active particles (recycled, not reallocated)
- Disabled automatically on touch devices (detected via `pointer: coarse` / `ontouchstart`)
- Implemented as a `useEffect` hook with `requestAnimationFrame` in the root layout

### 6.3 Card Flip Glitter Rain (desktop + mobile)

- Triggered on card flip (after the flip animation completes, ~300ms delay)
- Library: `canvas-confetti` (7kb, rAF-based, self-cleaning)
- Four confetti bursts fired, one per card edge, using `getBoundingClientRect()` to place `origin` coordinates
- **Colour is result-dependent:**
  - Correct (quality ≥ 3): bright greens + lime + gold — `['#00FF6A', '#2DFF9B', '#39FF14', '#FFD700', '#ADFF2F']`
  - Incorrect (quality < 3): bright reds + orange + hot pink — `['#FF2D2D', '#FF6B00', '#FF4500', '#FF0000', '#FF2D9B']`
- `particleCount: 80`, `spread: 100`, `gravity: 1.2`
- Canvas auto-cleared once particles settle — no ongoing cost between flips

### 6.4 Animated Background

- The deep purple-black background slowly shifts through subtle hue rotations: purple → deep navy → near-black → repeat
- Cycle duration ~30s, implemented as a CSS `@keyframes` animation on `background-position` with a radial gradient
- Zero JavaScript — GPU-composited, no performance cost

### 6.5 Card Shake on Wrong Answer

- When the AI result is incorrect (quality < 3), the card plays a short horizontal shake animation before the flip
- Implemented as a CSS `@keyframes shake` — ~6 frames, ~400ms total
- Provides immediate tactile-adjacent feedback; reinforces the result before glitter fires

### 6.6 Card Shimmer Border

- The flashcard has a thin animated rainbow gradient border that slowly rotates
- Implemented with `conic-gradient` + CSS `@keyframes` rotating the angle
- Subtle intensity — accent, not distraction

### 6.7 Glassmorphism Panels

- The chat panel and card surfaces use `backdrop-filter: blur(16px)` with semi-transparent backgrounds
- Surfaces appear to float above the animated gradient background
- Applied to: `ChatPanel`, `FlashCard`, `DeckCard`, scoreboard

### 6.8 Score Milestone Animations

- At 50% correct in a session: a brief sparkle burst fires from the scoreboard
- At 100% correct (perfect deck): full-screen palette confetti cannon — same as deck completion screen
- Client-side only, triggers once per threshold per session

### 6.9 "On a Roll" Toast

- After 3 consecutive correct answers: a toast notification slides in — *"On a roll! 3 in a row 🔥"*
- Resets on any wrong answer; re-triggers on the next streak of 3
- Pure client-side state — no database touch
- Toast uses the same neon palette and auto-dismisses after 3 seconds

### 6.10 Typewriter Effect on AI Responses

- Gemini responses in the chat panel are rendered token-by-token as they stream in
- Creates a natural, conversational feel — the AI appears to be typing in real time
- Uses the streaming `ReadableStream` reader already in the architecture; no additional mechanism needed

### 6.11 Sound Effects (toggle-able)

- Three short audio cues, playable via the Web Audio API (no library):
  - **Card flip**: soft whoosh (~150ms)
  - **Correct answer**: bright ascending chime (~300ms)
  - **Wrong answer**: low soft thud (~300ms)
- Sound is **off by default**; a toggle in the app header (🔇 / 🔊) persists the preference to `localStorage`
- Audio files are tiny `.wav` assets in `/public/sounds/`

### 6.12 Visual Design Constraints

- All particle effects use `pointer-events: none` canvas layers — they never intercept taps or clicks
- Glitter never overlaps the card face text: confetti fires outward and falls below the card before the flipped face becomes readable
- CSS card flip animation uses `will-change: transform` for GPU compositing — no competition with canvas repaints
- `requestAnimationFrame` used exclusively — no `setInterval`, no blocking
- All CSS animations (background, shimmer border, shake) use `@keyframes` and run on the GPU compositor thread
- Sound effects are off by default; preference stored in `localStorage` — never in the database
- Toasts ("On a roll", "Word learned") are non-blocking and auto-dismiss; they never obscure the card

---

## 7. Out of Scope

- Native iOS/Android app
- Offline mode
- Multiple users / team features
- Audio pronunciation playback (of the Spanish word itself)
- Verb conjugation tables or grammar reference
- Integration with Duolingo, Anki, or other external SRS tools
- Export to PDF / CSV
- Public sharing of decks

---

## 8. Decisions

- **AI deck extraction behaviour**: When the user's prompt is unambiguous and specific (e.g. *"Extract the top 5 most common verbs conjugated in first person present tense from this chapter"*), the AI creates the deck automatically without clarifying questions. When the prompt is vague or there are many plausible interpretations or a large number of candidates, the AI asks targeted clarifying questions before generating the deck.

- **SM-2 progress across decks**: Progress is tracked at the word level, not the deck level. If the exact same Spanish term (same conjugated form) appears in multiple decks across chapters, its `card_progress` record is shared — SM-2 interval, ease factor, and streak are unified across all its appearances. This correctly reflects real-world vocabulary acquisition (knowing a word is knowing it, regardless of where it appeared).

- **"Review wrong cards" scope**: The user can choose between:
  - Wrong cards from a specific deck (selected from a list)
  - Wrong cards from all decks (all-time)
