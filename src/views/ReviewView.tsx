'use client'

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { SparkleContext } from '@/contexts/SparkleContext'
import { useSound } from '@/hooks/useSound'
import { useCardDirection } from '@/contexts/CardDirectionContext'
import { ConfettiCannon } from '@/components/ConfettiCannon'

interface SourceSentence {
  es: string
  en: string
}

interface ReviewCard {
  id: string
  vocab_term_id: string
  spanish_term: string
  english_answer: string
  source_sentences: SourceSentence[]
  deck_id: string
  deck_name: string
  direction: 'es-to-en' | 'en-to-es'
}

interface EvalResult {
  qualityScore: number
  isCorrect: boolean
  feedback: string
  nextReviewAt: string
  intervalDays: number
  newlyMastered: boolean
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

  // Exact phrase match (handles nouns, unchanged forms)
  const exactParts = sentence.split(new RegExp(`(${escape(term)})`, 'gi'))
  if (exactParts.length > 1) return renderParts(exactParts)

  // Stem prefix fallback — handles conjugated/inflected Spanish forms.
  // Strip the last 2 chars of the first word to approximate the verb stem
  // (hablar→habl, correr→corr, vivir→viv) then match any word starting with it.
  const firstWord = term.split(/\s+/)[0]
  const stemLen = Math.max(3, firstWord.length - 2)
  if (firstWord.length >= 4) {
    const stem = escape(firstWord.slice(0, stemLen))
    const stemParts = sentence.split(new RegExp(`(${stem}\\S*)`, 'gi'))
    if (stemParts.length > 1) return renderParts(stemParts)
  }

  return [sentence]
}

export function ReviewView() {
  const { session } = useAuth()
  const router = useRouter()
  const { direction } = useCardDirection()
  // Snapshot direction at session start — mid-session toggles don't disrupt the queue
  const sessionDirection = useRef(direction)

  const [viewState, setViewState] = useState<'loading' | 'empty' | 'error' | 'reviewing' | 'complete'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [cards, setCards] = useState<ReviewCard[]>([])

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

  // Requeue throttle: tracks how many times a card has been re-inserted this session
  const requeueCount = useRef<Map<string, number>>(new Map())

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const { triggerBurst } = useContext(SparkleContext)
  const { play } = useSound()

  useEffect(() => {
    if (!session) return
    fetch(`/api/review?mode=${sessionDirection.current}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setErrorMsg(data.error)
          setViewState('error')
        } else if (!data.cards?.length) {
          setViewState('empty')
        } else {
          setCards(data.cards)
          setViewState('reviewing')
          setTimeout(() => inputRef.current?.focus(), 200)
        }
      })
      .catch(() => {
        setErrorMsg('Failed to load review queue.')
        setViewState('error')
      })
  }, [session])

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
        play('correct')
        if (cardRef.current) triggerBurst(cardRef.current.getBoundingClientRect())
      } else {
        setIncorrect((i) => i + 1)
        play('wrong')
        setShaking(true)
        setTimeout(() => {
          setShaking(false)
          setFlipped(true)
        }, 450)

        // Auto re-queue failed card mid-session (max 2 times)
        const requeues = requeueCount.current.get(currentCard.vocab_term_id) ?? 0
        if (requeues < 2) {
          requeueCount.current.set(currentCard.vocab_term_id, requeues + 1)
          setCards((prev) => {
            const next = [...prev]
            const insertAt = Math.min(currentIdx + 5, next.length)
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
    if (currentIdx + 1 >= cards.length) {
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
              setToastMsg(`🏆 New record! You reviewed ${data.newRecord} cards today!`)
              setTimeout(() => setToastMsg(null), 5000)
            }
          })
          .catch(() => {})
      }
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

  // When the card is showing results, Enter should advance to the next card
  // from anywhere on the page — no need to click Next Card with the mouse.
  useEffect(() => {
    if (cardState !== 'result') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        nextCard()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [cardState, nextCard])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (cardState === 'input') submitAnswer()
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (viewState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="glass rounded-xl p-10 text-center">
          <div className="mb-4 text-3xl animate-pulse">✨</div>
          <p className="text-white/60">Loading review queue…</p>
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
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

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (viewState === 'empty') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="glass rounded-xl p-10 text-center max-w-sm">
          <div className="text-4xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold text-neon-green mb-2">All caught up!</h1>
          <p className="text-white/50 text-sm mb-6">
            No cards are due for review today. Come back tomorrow to keep your streak alive.
          </p>
          <button
            onClick={() => router.push('/decks')}
            className="rounded-lg bg-neon-purple px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Browse Decks
          </button>
        </div>
      </div>
    )
  }

  // ── Complete ──────────────────────────────────────────────────────────────
  if (viewState === 'complete') {
    const total = cards.length
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0
    const passed = pct >= 80

    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <ConfettiCannon />
        {/* Personal best toast */}
        {toastMsg && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 glass rounded-xl px-5 py-3 text-sm font-semibold text-neon-gold border border-neon-gold/30 shadow-xl transition-all animate-pulse pointer-events-none">
            {toastMsg}
          </div>
        )}
        <div className="glass card-shimmer rounded-2xl p-10 text-center max-w-md w-full">
          <div className="text-5xl mb-4">{passed ? '🎉' : '💪'}</div>
          <h1 className="text-3xl font-bold text-neon-purple text-glow-purple mb-1">
            Review Complete
          </h1>
          <p className="text-white/50 text-sm mb-6">
            {total} card{total !== 1 ? 's' : ''} reviewed
          </p>

          <div className="flex justify-center gap-8 mb-8">
            <div className="text-center">
              <div className="text-4xl font-bold text-neon-green">{correct}</div>
              <div className="text-xs text-white/50 mt-1">Correct</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-neon-pink">{incorrect}</div>
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
              ? "Great session — your SM-2 intervals have been updated. See you tomorrow!"
              : "Keep at it — the tricky ones will get easier with repetition."}
          </p>

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

  // ── Reviewing ─────────────────────────────────────────────────────────────
  const total = cards.length
  const remaining = total - currentIdx - (cardState === 'result' ? 1 : 0)
  const scorePct = currentIdx > 0 ? Math.round((correct / currentIdx) * 100) : null

  return (
    <div className="flex flex-col min-h-screen p-4 md:p-8 gap-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-lg font-semibold text-white/70">SM-2 Review</h1>
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
          style={{ width: `${(currentIdx / total) * 100}%` }}
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
            {/* Front — question prompt (direction-aware) */}
            <div className="flip-card-front glass rounded-2xl flex flex-col items-center justify-between p-8">
              <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full">
                {/* Deck context label + direction pill */}
                <div className="flex flex-col items-center gap-1.5">
                  <p className="text-xs text-white/30 truncate max-w-xs text-center">
                    {currentCard?.deck_name}
                  </p>
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

                {/* Source sentence reveal — only for ES→EN (hint not useful for production) */}
                {currentCard?.direction !== 'en-to-es' && currentCard?.source_sentences?.length > 0 && (
                  <div className="text-center">
                    {showSentence ? (
                      <div className="text-sm text-white/60 italic max-w-sm">
                        <p className="text-neon-blue/80">
                          {highlightTerm(
                            currentCard.source_sentences[0].es,
                            currentCard.spanish_term
                          )}
                        </p>
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
                  placeholder={
                    currentCard?.direction === 'en-to-es'
                      ? 'Type the Spanish…'
                      : 'Type the English translation…'
                  }
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
                          <p className="text-sm text-neon-blue/80 italic">
                            {highlightTerm(s.es, currentCard.spanish_term)}
                          </p>
                          <p className="text-xs text-white/40">
                            {highlightTerm(s.en, currentCard.english_answer)}
                          </p>
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
