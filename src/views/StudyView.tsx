'use client'

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { SparkleContext } from '@/contexts/SparkleContext'
import { useSound } from '@/hooks/useSound'
import { CEFR_NOUN_NEXT, CEFR_NOUN_NEXT_LABEL } from '@/data/books'
import { useCardDirection } from '@/contexts/CardDirectionContext'
import { ConfettiCannon } from '@/components/ConfettiCannon'

interface SourceSentence {
  es: string
  en: string
}

interface Card {
  id: string
  spanish_term: string
  english_answer: string
  source_sentences: SourceSentence[]
  position: number
  vocab_term_id: string
  isNew: boolean
  direction: 'es-to-en' | 'en-to-es'
}

interface Deck {
  id: string
  name: string
  book_number: number | null
  chapter_number: number | null
  category: string | null
  subcategory: string | null
}

interface EvalResult {
  qualityScore: number
  isCorrect: boolean
  feedback: string
  nextReviewAt: string
  intervalDays: number
  newlyMastered: boolean
  wasNewCard: boolean
}

interface Props {
  deckId: string
  bookNumber?: number
  chapterNumber?: number
}

function highlightTerm(sentence: string, term: string): (string | React.ReactElement)[] {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const renderParts = (parts: string[]) =>
    parts.map((part, i) =>
      i % 2 === 1 ? (
        <span key={i} className="underline decoration-neon-pink decoration-2">
          {part}
        </span>
      ) : (
        part
      )
    )

  const ARTICLE_RE = /^(?:el|la|los|las|un|una|unos|unas|the|a|an)\s+/i

  // Build all candidate strings to try, in order of specificity:
  // 1. The full term as-is
  // 2. Each slash-separated variant (e.g. "the bow/curtsy" → ["the bow", "curtsy"])
  // 3. All of the above with leading articles stripped
  const variants: string[] = [term]
  const slashParts = term.split('/')
  if (slashParts.length > 1) variants.push(...slashParts.map((p) => p.trim()))

  const coreVariants = variants.map((v) => v.replace(ARTICLE_RE, '').trim()).filter(Boolean)
  const candidates = [...new Set([...variants, ...coreVariants])]

  for (const candidate of candidates) {
    if (!candidate) continue
    const parts = sentence.split(new RegExp(`(${escape(candidate)})`, 'gi'))
    if (parts.length > 1) return renderParts(parts)
  }

  // Individual content-word fallback — handles phrases where article/pronoun
  // changes break phrase matching ("we call" → "they call"). Try each word
  // ≥ 4 chars from the core candidates, longest first.
  // NOTE: intentionally NOT using a stem/prefix fallback here. Stripping
  // conjugation endings (e.g. "respondía" → "respond") would highlight a
  // *different* conjugated form in the sentence (e.g. "respondió"), creating
  // a misleading mismatch between the flash word and the highlighted word.
  const SKIP_WORDS = new Set(['that', 'this', 'with', 'have', 'been', 'were', 'they', 'them', 'their', 'when', 'what', 'which', 'from', 'some', 'also'])
  const contentWords = coreVariants
    .flatMap((v) => v.split(/\s+/))
    .filter((w) => w.length >= 4 && !SKIP_WORDS.has(w.toLowerCase()))
    .sort((a, b) => b.length - a.length)
  for (const word of contentWords) {
    const parts = sentence.split(new RegExp(`(${escape(word)})`, 'gi'))
    if (parts.length > 1) return renderParts(parts)
  }

  return [sentence]
}

export function StudyView({ deckId, bookNumber, chapterNumber }: Props) {
  const { session } = useAuth()
  const router = useRouter()
  const { direction } = useCardDirection()
  // Snapshot direction at session start — mid-session toggles don't disrupt the deck
  const sessionDirection = useRef(direction)

  // Deck data
  const [viewState, setViewState] = useState<'loading' | 'error' | 'studying' | 'complete'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [deck, setDeck] = useState<Deck | null>(null)
  const [cards, setCards] = useState<Card[]>([])

  // Per-card state
  const [currentIdx, setCurrentIdx] = useState(0)
  const [cardState, setCardState] = useState<'input' | 'evaluating' | 'result'>('input')
  const [answer, setAnswer] = useState('')
  const [showSentence, setShowSentence] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [shaking, setShaking] = useState(false)
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null)

  // Scoreboard
  const [correct, setCorrect] = useState(0)
  const [incorrect, setIncorrect] = useState(0)

  // Personal best toast
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  // Learning steps: tracks how many in-session attempts a card has had (by card id)
  const learningProgress = useRef<Map<string, number>>(new Map())
  // Requeue throttle: tracks how many times a card has been re-inserted this session
  const requeueCount = useRef<Map<string, number>>(new Map())

  // Next CEFR level navigation
  const [nextLevelDeckId, setNextLevelDeckId] = useState<string | null>(null)

  // Augment deck
  const [augmenting, setAugmenting] = useState(false)
  const [augmentMsg, setAugmentMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const { triggerBurst } = useContext(SparkleContext)
  const { play } = useSound()

  // Progress persistence key (not used for 'mixed' deck)
  const progressKey = deckId !== 'mixed' ? `deck-progress-${deckId}` : null

  // Load deck
  useEffect(() => {
    if (!session) return
    const isMixed = deckId === 'mixed'
    const fetchUrl = isMixed
      ? `/api/decks/mixed?book=${bookNumber}&chapter=${chapterNumber}`
      : `/api/decks/${deckId}`
    fetch(fetchUrl, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setErrorMsg(data.error)
          setViewState('error')
        } else {
          setDeck(data.deck)
          const fetched = (data.cards as Omit<Card, 'direction'>[]).map((c) => ({
            ...c,
            direction: sessionDirection.current,
          }))

          // Try to restore saved progress for this deck
          const saved = progressKey ? localStorage.getItem(progressKey) : null
          if (saved) {
            try {
              const { orderedIds, idx } = JSON.parse(saved) as { orderedIds: string[]; idx: number }
              const byId = Object.fromEntries(fetched.map((c) => [c.id, c]))
              const restored = orderedIds.map((id) => byId[id]).filter(Boolean) as Card[]
              if (restored.length > 0 && idx < restored.length) {
                setCards(restored)
                setCurrentIdx(idx)
                setViewState('studying')
                setTimeout(() => inputRef.current?.focus(), 200)
                return
              }
            } catch {
              // corrupted — fall through to fresh shuffle
            }
          }

          // Fresh session — shuffle cards
          const shuffled = [...fetched]
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
          }
          if (progressKey) {
            localStorage.setItem(progressKey, JSON.stringify({ orderedIds: shuffled.map((c) => c.id), idx: 0 }))
          }
          setCards(shuffled)
          setViewState('studying')
          setTimeout(() => inputRef.current?.focus(), 200)
        }
      })
      .catch(() => {
        setErrorMsg('Failed to load deck.')
        setViewState('error')
      })
  }, [deckId, session, bookNumber, chapterNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  // When the session completes, look up the next CEFR level deck (if applicable)
  useEffect(() => {
    if (viewState !== 'complete' || !session || !deck) return
    const nextSub = deck.subcategory ? CEFR_NOUN_NEXT[deck.subcategory] : null
    if (!nextSub) return
    const fetchUrl = deck.book_number && deck.chapter_number
      ? `/api/decks?book=${deck.book_number}&chapter=${deck.chapter_number}`
      : `/api/decks`
    fetch(fetchUrl, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        const next = (data.decks ?? []).find(
          (d: { subcategory: string | null; id: string }) => d.subcategory === nextSub
        )
        if (next) setNextLevelDeckId(next.id)
      })
      .catch(() => { /* silently ignore */ })
  }, [viewState, deck, session])

  const currentCard = cards[currentIdx]

  const submitAnswer = useCallback(async () => {
    if (!currentCard || !session || !answer.trim() || cardState !== 'input') return
    setCardState('evaluating')

    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          vocabTermId: currentCard.vocab_term_id,
          userAnswer: answer.trim(),
          spanishTerm: currentCard.spanish_term,
          englishAnswer: currentCard.english_answer,
          sourceSentences: currentCard.source_sentences,
          direction: currentCard.direction,
        }),
      })
      const result: EvalResult = await res.json()
      setEvalResult(result)
      setCardState('result')

      if (result.isCorrect) {
        setCorrect((c) => c + 1)
        setFlipped(true)
        // Defer the sound + burst by one frame so the flip animation gets first paint
        const rect = cardRef.current?.getBoundingClientRect()
        requestAnimationFrame(() => {
          play('correct')
          if (rect) triggerBurst(rect)
        })

        // Learning steps: re-queue new cards for a second in-session exposure
        const step = learningProgress.current.get(currentCard.id) ?? -1
        if (step === -1) {
          // True first encounter — re-insert after ~5 cards for step 1
          learningProgress.current.set(currentCard.id, 0)
          setCards((prev) => {
            const next = [...prev]
            const insertAt = Math.min(currentIdx + 5, next.length)
            next.splice(insertAt, 0, currentCard)
            return next
          })
        } else if (step === 0) {
          // Passed step 1 — card is graduated, mark it done
          learningProgress.current.set(currentCard.id, 1)
        }
      } else {
        setIncorrect((i) => i + 1)
        play('wrong')
        setShaking(true)
        setTimeout(() => {
          setShaking(false)
          setFlipped(true)
        }, 450)

        // Auto re-queue: re-insert failed card mid-session (max 2 times)
        const requeues = requeueCount.current.get(currentCard.id) ?? 0
        if (requeues < 2) {
          requeueCount.current.set(currentCard.id, requeues + 1)
          // Reset learning step on failure
          const step = learningProgress.current.get(currentCard.id) ?? -1
          if (step >= 0) learningProgress.current.set(currentCard.id, 0)
          setCards((prev) => {
            const next = [...prev]
            // Insert sooner on failure (3 cards) than on correct learning step (5 cards)
            const insertAt = Math.min(currentIdx + 3, next.length)
            next.splice(insertAt, 0, currentCard)
            return next
          })
        }
      }
    } catch {
      setCardState('input')
    }
  }, [currentCard, session, answer, cardState, currentIdx, triggerBurst, play])

  const nextCard = useCallback(() => {
    const advance = () => {
      const next = currentIdx + 1
      if (next >= cards.length) {
        // Session complete — clear saved progress
        if (progressKey) localStorage.removeItem(progressKey)
        play('complete')
        setViewState('complete')
        // Check personal best (fire-and-forget)
        if (session?.access_token) {
          fetch('/api/personal-best', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ count: cards.length }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (data.isNewRecord) {
                setToastMsg(`🏆 New record! You studied ${data.newRecord} cards today!`)
                setTimeout(() => setToastMsg(null), 5000)
              }
            })
            .catch(() => {})
        }
      } else {
        // Persist progress so the user can resume later
        if (progressKey) {
          localStorage.setItem(progressKey, JSON.stringify({ orderedIds: cards.map((c) => c.id), idx: next }))
        }
        setCurrentIdx(next)
        setCardState('input')
        setAnswer('')
        setShowSentence(false)
        setFlipped(false)
        setEvalResult(null)
        setTimeout(() => inputRef.current?.focus(), 100)
      }
    }
    advance()
  }, [currentIdx, cards, play, progressKey])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (cardState === 'input') submitAnswer()
      else if (cardState === 'result') nextCard()
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (viewState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="glass rounded-xl p-10 text-center">
          <div className="mb-4 text-3xl animate-pulse">✨</div>
          <p className="text-white/60">Loading deck…</p>
        </div>
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (viewState === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="glass rounded-xl p-10 text-center max-w-sm">
          <p className="text-red-400 mb-4">{errorMsg}</p>
          <button
            onClick={() => router.push('/decks')}
            className="rounded-lg bg-neon-purple px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Back to Decks
          </button>
        </div>
      </div>
    )
  }

  // ── Complete ─────────────────────────────────────────────────────────────
  if (viewState === 'complete') {
    const total = cards.length
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0
    const passed = pct >= 80

    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <ConfettiCannon />
        {/* Personal best toast */}
        {toastMsg && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 glass rounded-xl px-5 py-3 text-sm font-semibold text-neon-gold border border-neon-gold/30 shadow-xl animate-pulse pointer-events-none">
            {toastMsg}
          </div>
        )}
        <div className="glass card-shimmer rounded-2xl p-10 text-center max-w-md w-full">
          <div className="text-5xl mb-4">{passed ? '🎉' : '💪'}</div>
          <h1 className="text-3xl font-bold text-neon-purple text-glow-purple mb-1">
            Session Complete
          </h1>
          <p className="text-white/80 text-sm mb-6 font-medium">{deck?.name}</p>

          <div className="flex justify-center gap-8 mb-8">
            <div className="text-center">
              <div className="text-4xl font-bold text-neon-green">{correct}</div>
              <div className="text-xs text-white/80 mt-1 font-semibold uppercase tracking-wide">Correct</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-neon-pink">{incorrect}</div>
              <div className="text-xs text-white/80 mt-1 font-semibold uppercase tracking-wide">Incorrect</div>
            </div>
            <div className="text-center">
              <div className={`text-4xl font-bold ${passed ? 'text-neon-gold' : 'text-white/70'}`}>
                {pct}%
              </div>
              <div className="text-xs text-white/80 mt-1 font-semibold uppercase tracking-wide">Score</div>
            </div>
          </div>

          <p className="text-white/90 text-sm mb-8">
            {passed
              ? 'Excellent work! Keep it up — you\'re building lasting vocabulary.'
              : 'Good effort! Reviewing the tricky ones will strengthen your recall.'}
          </p>

          <div className="flex gap-3 justify-center">
            <button
              onClick={() => {
                const b = deck?.book_number
                const c = deck?.chapter_number
                if (b && c) router.push(`/decks?view=chapter&book=${b}&chapter=${c}`)
                else router.push('/decks')
              }}
              className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/70 hover:text-white hover:border-white/40 transition-colors"
            >
              {deck?.book_number && deck?.chapter_number
                ? `Bk ${deck.book_number} · Ch ${deck.chapter_number} Decks`
                : 'All Decks'}
            </button>
            <button
              onClick={() => {
                learningProgress.current.clear()
                requeueCount.current.clear()
                // Re-shuffle for the new session
                const reshuffled = [...cards]
                for (let i = reshuffled.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [reshuffled[i], reshuffled[j]] = [reshuffled[j], reshuffled[i]]
                }
                if (progressKey) {
                  localStorage.setItem(progressKey, JSON.stringify({ orderedIds: reshuffled.map((c) => c.id), idx: 0 }))
                }
                setCards(reshuffled)
                setCurrentIdx(0)
                setCorrect(0)
                setIncorrect(0)
                setCardState('input')
                setAnswer('')
                setShowSentence(false)
                setFlipped(false)
                setEvalResult(null)
                setViewState('studying')
                setTimeout(() => inputRef.current?.focus(), 200)
              }}
              className="rounded-lg bg-neon-purple px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              Study Again
            </button>
          </div>

          {/* Add 10 more cards */}
          {deck?.book_number && deck?.chapter_number && deck?.subcategory && (
            <div className="mt-5 pt-5 border-t border-white/10">
              <button
                onClick={async () => {
                  if (!session || augmenting) return
                  setAugmenting(true)
                  setAugmentMsg(null)
                  try {
                    const res = await fetch(`/api/decks/${deckId}/augment`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${session.access_token}` },
                    })
                    const data = await res.json()
                    if (data.addedCount) {
                      setAugmentMsg({ type: 'success', text: `Added ${data.addedCount} new cards to this deck.` })
                    } else {
                      setAugmentMsg({ type: 'error', text: data.error ?? 'Could not add more cards.' })
                    }
                  } catch {
                    setAugmentMsg({ type: 'error', text: 'Failed to add more cards.' })
                  } finally {
                    setAugmenting(false)
                  }
                }}
                disabled={augmenting}
                className="w-full rounded-lg border border-neon-blue/50 text-neon-blue py-2 text-sm font-semibold hover:bg-neon-blue/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {augmenting ? 'Adding cards…' : '+ Add 10 More Cards'}
              </button>
              {augmentMsg && (
                <p className={`mt-2 text-xs text-center ${augmentMsg.type === 'success' ? 'text-neon-green' : 'text-red-400'}`}>
                  {augmentMsg.text}
                </p>
              )}
            </div>
          )}

          {/* Continue to next CEFR noun level */}
          {nextLevelDeckId && deck?.subcategory && CEFR_NOUN_NEXT_LABEL[deck.subcategory] && (
            <div className="mt-6 pt-5 border-t border-white/10">
              <p className="text-xs text-white/40 mb-2">Ready for the next level?</p>
              <button
                onClick={() => router.push(`/decks/${nextLevelDeckId}`)}
                className="w-full rounded-lg border border-neon-gold/50 text-neon-gold py-2 text-sm font-semibold hover:bg-neon-gold/10 transition-colors"
              >
                Continue to {CEFR_NOUN_NEXT_LABEL[deck.subcategory]} →
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Studying ─────────────────────────────────────────────────────────────
  const total = cards.length
  const remaining = total - currentIdx - (cardState === 'result' ? 1 : 0)
  const scorePct =
    currentIdx > 0 ? Math.round((correct / currentIdx) * 100) : null

  const handleBackToChapter = () => {
    const b = deck?.book_number
    const c = deck?.chapter_number
    if (b && c) router.push(`/decks?view=chapter&book=${b}&chapter=${c}`)
    else router.push('/decks')
  }

  return (
    <div className="flex flex-col min-h-screen p-4 md:p-8 gap-6">
      {/* Deck title */}
      <div className="text-center relative">
        <button
          onClick={handleBackToChapter}
          className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-xs text-white/35 hover:text-white/70 transition-colors"
        >
          <span>←</span>
          <span>{deck?.book_number && deck?.chapter_number ? `Bk ${deck.book_number} · Ch ${deck.chapter_number}` : 'Decks'}</span>
        </button>
        <h1 className="text-lg font-semibold text-white/70">{deck?.name}</h1>
        <p className="text-xs text-white/30 mt-0.5">
          Card {currentIdx + 1} of {total}
        </p>
      </div>

      {/* Scoreboard */}
      <div className="flex justify-center gap-6 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-neon-green" />
          <span className="text-neon-green font-semibold">{correct}</span>
          <span className="text-white/30">correct</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-neon-pink" />
          <span className="text-neon-pink font-semibold">{incorrect}</span>
          <span className="text-white/30">incorrect</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-white/30">{remaining} left</span>
        </div>
        {scorePct !== null && (
          <div className="flex items-center gap-1.5">
            <span className="text-neon-gold font-semibold">{scorePct}%</span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-xl mx-auto h-1 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full bg-neon-purple transition-all duration-500"
          style={{ width: `${((currentIdx) / total) * 100}%` }}
        />
      </div>

      {/* Flip card */}
      <div className="flex-1 flex items-center justify-center">
        <div
          ref={cardRef}
          className={`flip-card w-full max-w-xl ${shaking ? 'animate-shake' : ''}`}
          style={{ height: 'clamp(320px, 50vh, 480px)' }}
        >
          <div className={`flip-card-inner ${flipped ? 'flipped' : ''}`}>
            {/* Front — prompt (direction-aware) */}
            <div className="flip-card-front glass rounded-2xl flex flex-col items-center justify-between p-8">
              <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full">
                {/* Badges */}
                <div className="flex flex-col items-center gap-1.5">
                  {learningProgress.current.get(currentCard?.id) === 0 && (
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-neon-blue/20 text-neon-blue border border-neon-blue/30">
                      Learning — 2nd pass
                    </span>
                  )}
                  {currentCard?.direction === 'en-to-es' && (
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-neon-gold/20 text-neon-gold border border-neon-gold/30">
                      Produce Spanish
                    </span>
                  )}
                </div>

                <p className="text-4xl md:text-5xl font-bold text-white text-center leading-tight">
                  {currentCard?.direction === 'en-to-es'
                    ? currentCard?.english_answer
                    : currentCard?.spanish_term}
                </p>

                {/* Source sentence reveal */}
                {currentCard?.source_sentences?.length > 0 && (
                  <div className="text-center">
                    {showSentence ? (
                      <div className="text-sm text-white/60 italic max-w-sm">
                        {currentCard.direction === 'en-to-es' ? (
                          <p className="text-white/50">{currentCard.source_sentences[0].en}</p>
                        ) : (
                          <p className="text-neon-blue/80">{highlightTerm(currentCard.source_sentences[0].es, currentCard.spanish_term)}</p>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowSentence(true)}
                        className="text-xs text-white/30 hover:text-neon-blue transition-colors border border-white/10 hover:border-neon-blue/40 rounded-full px-3 py-1"
                      >
                        Reveal sentence
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className="w-full space-y-3">
                <textarea
                  ref={inputRef}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={cardState !== 'input'}
                  placeholder={currentCard?.direction === 'en-to-es' ? 'Type the Spanish…' : 'Type the English translation…'}
                  rows={2}
                  className="w-full resize-none rounded-xl bg-white/5 border border-white/15 px-4 py-3 text-white placeholder:text-white/25 focus:outline-none focus:border-neon-purple/60 disabled:opacity-50 transition-colors"
                />
                <button
                  onClick={submitAnswer}
                  disabled={!answer.trim() || cardState !== 'input'}
                  className="w-full rounded-xl bg-neon-purple py-3 text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  {cardState === 'evaluating' ? 'Evaluating…' : 'Submit'}
                </button>
              </div>
            </div>

            {/* Back — Result */}
            <div className="flip-card-back glass rounded-2xl flex flex-col p-8 overflow-y-auto">
              {evalResult && (
                <>
                  {/* Result indicator */}
                  <div className="flex items-center gap-3 mb-5">
                    <div
                      className={`text-3xl ${evalResult.isCorrect ? 'text-neon-green' : 'text-neon-pink'}`}
                    >
                      {evalResult.isCorrect ? '✓' : '✗'}
                    </div>
                    <div>
                      <p
                        className={`font-bold ${evalResult.isCorrect ? 'text-neon-green' : 'text-neon-pink'}`}
                      >
                        {evalResult.isCorrect ? 'Correct!' : 'Not quite'}
                      </p>
                      <p className="text-xs text-white/40">
                        Quality score: {evalResult.qualityScore}/5 · Next review in{' '}
                        {evalResult.intervalDays}d
                        {evalResult.newlyMastered && (
                          <span className="ml-2 text-neon-gold">🏆 Mastered!</span>
                        )}
                        {!evalResult.newlyMastered && learningProgress.current.get(currentCard?.id) === 1 && (
                          <span className="ml-2 text-neon-blue">✓ Graduated</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Correct answer */}
                  <div className="mb-4">
                    <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Answer</p>
                    <p className="text-xl font-semibold text-white">
                      {currentCard?.direction === 'en-to-es'
                        ? currentCard?.spanish_term
                        : currentCard?.english_answer}
                    </p>
                  </div>

                  {/* Source sentences */}
                  {currentCard?.source_sentences?.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs text-white/40 uppercase tracking-wider mb-1">
                        In context
                      </p>
                      {currentCard.source_sentences.map((s, i) => (
                        <div key={i} className="mb-2">
                          <p className="text-sm text-neon-blue/80 italic">{highlightTerm(s.es, currentCard.spanish_term)}</p>
                          <p className="text-xs text-white/40">{highlightTerm(s.en, currentCard.english_answer)}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* AI feedback */}
                  <div className="mb-6">
                    <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Feedback</p>
                    <p className="text-sm text-white/70">{evalResult.feedback}</p>
                  </div>

                  {/* Next button */}
                  <button
                    onClick={nextCard}
                    className="mt-auto w-full rounded-xl bg-neon-purple py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                  >
                    {currentIdx + 1 >= cards.length ? 'See Results' : 'Next Card →'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
