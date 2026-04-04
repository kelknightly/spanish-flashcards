/**
 * SM-2 spaced repetition algorithm.
 * Runs server-side only (inside /api/evaluate) so scores cannot be tampered with.
 *
 * Quality scale (AI-assigned):
 *   5 = perfect, immediate recall
 *   4 = correct with slight hesitation
 *   3 = correct with significant difficulty
 *   2 = incorrect but close — recalled when shown answer
 *   1 = incorrect — answer was familiar when shown
 *   0 = complete blank
 *
 * Scores >= 3 = correct (green); scores < 3 = incorrect (red).
 */

export interface SM2State {
  easeFactor: number    // default 2.5, minimum 1.3
  intervalDays: number  // days until next review
  repetitions: number   // consecutive correct reviews
}

export interface SM2Result extends SM2State {
  nextReviewAt: Date
  isCorrect: boolean    // quality >= 3
}

export function updateSM2(current: SM2State, quality: number): SM2Result {
  if (quality < 0 || quality > 5) throw new Error('quality must be 0–5')

  let { easeFactor, intervalDays, repetitions } = current
  const isCorrect = quality >= 3

  if (!isCorrect) {
    // Failed recall — reset streak, review again tomorrow
    repetitions = 0
    intervalDays = 1
  } else {
    // Successful recall — advance interval
    if (repetitions === 0) {
      intervalDays = 1
    } else if (repetitions === 1) {
      intervalDays = 6
    } else {
      intervalDays = Math.round(intervalDays * easeFactor)
    }
    repetitions += 1
  }

  // Adjust ease factor — never below 1.3
  easeFactor = Math.max(
    1.3,
    easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
  )

  const nextReviewAt = new Date()
  nextReviewAt.setDate(nextReviewAt.getDate() + intervalDays)
  // Normalize to midnight UTC so date comparisons are stable
  nextReviewAt.setUTCHours(0, 0, 0, 0)

  return { easeFactor, intervalDays, repetitions, nextReviewAt, isCorrect }
}

export const SM2_DEFAULTS: SM2State = {
  easeFactor: 2.5,
  intervalDays: 0,
  repetitions: 0,
}

/** Derive a human-readable difficulty label from SM-2 state */
export function getDifficultyLabel(state: SM2State): 'New' | 'Hard' | 'Moderate' | 'Easy' {
  if (state.repetitions === 0) return 'New'
  if (state.easeFactor < 1.8) return 'Hard'
  if (state.easeFactor < 2.3) return 'Moderate'
  return 'Easy'
}
