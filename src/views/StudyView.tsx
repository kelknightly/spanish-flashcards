'use client'

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { SparkleContext } from '@/contexts/SparkleContext'
import { CEFR_NOUN_NEXT, CEFR_NOUN_NEXT_LABEL } from '@/data/books'

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
}

interface Props {
  deckId: string
}

export function StudyView({ deckId }: Props) {
  const { session } = useAuth()
  const router = useRouter()

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
  const [incorrectCards, setIncorrectCards] = useState<Card[]>([])

  // Next CEFR level navigation
  const [nextLevelDeckId, setNextLevelDeckId] = useState<string | null>(null)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const { triggerBurst } = useContext(SparkleContext)

  // Load deck
  useEffect(() => {
    if (!session) return
    fetch(`/api/decks/${deckId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setErrorMsg(data.error)
          setViewState('error')
        } else {
          setDeck(data.deck)
          setCards(data.cards)
          setViewState('studying')
          setTimeout(() => inputRef.current?.focus(), 200)
        }
      })
      .catch(() => {
        setErrorMsg('Failed to load deck.')
        setViewState('error')
      })
  }, [deckId, session])

  // When the session completes, look up the next CEFR level deck (if applicable)
  useEffect(() => {
    if (viewState !== 'complete' || !session || !deck) return
    const nextSub = deck.subcategory ? CEFR_NOUN_NEXT[deck.subcategory] : null
    if (!nextSub || !deck.book_number || !deck.chapter_number) return
    fetch(`/api/decks?book=${deck.book_number}&chapter=${deck.chapter_number}`, {
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
        }),
      })
      const result: EvalResult = await res.json()
      setEvalResult(result)
      setCardState('result')

      if (result.isCorrect) {
        setCorrect((c) => c + 1)
        setFlipped(true)
        if (cardRef.current) triggerBurst(cardRef.current.getBoundingClientRect())
      } else {
        setIncorrect((i) => i + 1)
        setIncorrectCards((prev) => [...prev, currentCard])
        setShaking(true)
        setTimeout(() => {
          setShaking(false)
          setFlipped(true)
        }, 450)
      }
    } catch {
      setCardState('input')
    }
  }, [currentCard, session, answer, cardState, triggerBurst])

  const nextCard = useCallback(() => {
    if (currentIdx + 1 >= cards.length) {
      setViewState('complete')
    } else {
      setCurrentIdx((i) => i + 1)
      setCardState('input')
      setAnswer('')
      setShowSentence(false)
      setFlipped(false)
      setEvalResult(null)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [currentIdx, cards.length])

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
        <div className="glass card-shimmer rounded-2xl p-10 text-center max-w-md w-full">
          <div className="text-5xl mb-4">{passed ? '🎉' : '💪'}</div>
          <h1 className="text-3xl font-bold text-neon-purple text-glow-purple mb-1">
            Session Complete
          </h1>
          <p className="text-white/50 text-sm mb-6">{deck?.name}</p>

          <div className="flex justify-center gap-8 mb-8">
            <div className="text-center">
              <div className="text-4xl font-bold text-neon-green">{correct}</div>
              <div className="text-xs text-white/50 mt-1">Correct</div>
            </div>
            <div className="text-center">
              <button
                onClick={() => {
                  if (incorrectCards.length === 0) return
                  setCards(incorrectCards)
                  setIncorrectCards([])
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
                disabled={incorrect === 0}
                className="text-4xl font-bold text-neon-pink disabled:cursor-default enabled:cursor-pointer enabled:hover:opacity-70 enabled:underline enabled:decoration-dotted transition-opacity"
                title={incorrect > 0 ? 'Review wrong answers' : undefined}
              >
                {incorrect}
              </button>
              <div className="text-xs text-white/50 mt-1">Incorrect</div>
            </div>
            <div className="text-center">
              <div className={`text-4xl font-bold ${passed ? 'text-neon-gold' : 'text-white/70'}`}>
                {pct}%
              </div>
              <div className="text-xs text-white/50 mt-1">Score</div>
            </div>
          </div>

          <p className="text-white/60 text-sm mb-8">
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
              All Decks
            </button>
            <button
              onClick={() => {
                setCards(cards)
                setIncorrectCards([])
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

  return (
    <div className="flex flex-col min-h-screen p-4 md:p-8 gap-6">
      {/* Deck title */}
      <div className="text-center">
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
            {/* Front — Spanish prompt */}
            <div className="flip-card-front glass rounded-2xl flex flex-col items-center justify-between p-8">
              <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full">
                <p className="text-4xl md:text-5xl font-bold text-white text-center leading-tight">
                  {currentCard?.spanish_term}
                </p>

                {/* Source sentence reveal */}
                {currentCard?.source_sentences?.length > 0 && (
                  <div className="text-center">
                    {showSentence ? (
                      <div className="text-sm text-white/60 italic max-w-sm">
                        <p className="text-neon-blue/80">{currentCard.source_sentences[0].es}</p>
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
                  placeholder="Type the English translation…"
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
                      </p>
                    </div>
                  </div>

                  {/* Correct answer */}
                  <div className="mb-4">
                    <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Answer</p>
                    <p className="text-xl font-semibold text-white">
                      {currentCard?.english_answer}
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
                          <p className="text-sm text-neon-blue/80 italic">{s.es}</p>
                          <p className="text-xs text-white/40">{s.en}</p>
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
