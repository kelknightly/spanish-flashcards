import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { getModel } from '@/lib/gemini'
import { createClient } from '@supabase/supabase-js'
import { updateSM2, SM2_DEFAULTS } from '@/lib/sm2'

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

export async function POST(request: NextRequest) {
  const user = await getAuthUserFromRequest(request)
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    vocabTermId: string
    userAnswer: string
    spanishTerm: string
    englishAnswer: string
    sourceSentences?: Array<{ es: string; en: string }>
    direction?: 'es-to-en' | 'en-to-es'
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { vocabTermId, userAnswer, spanishTerm, englishAnswer, sourceSentences = [], direction = 'es-to-en' } = body

  if (!userAnswer?.trim() || !spanishTerm || !englishAnswer || !vocabTermId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  // 1. AI evaluation
  const sentenceContext =
    sourceSentences.length > 0
      ? `\nSource sentence: "${sourceSentences[0].es}" (English: "${sourceSentences[0].en}")`
      : ''

  const prompt = direction === 'en-to-es'
    ? `You are evaluating a Spanish vocabulary production exercise.

The student was shown the English prompt: "${englishAnswer}"
The correct Spanish word/phrase: "${spanishTerm}"${sentenceContext}
Student's answer: "${userAnswer}"

Rate the student's Spanish production on a 0–5 scale:
5 = Perfect — exact match or an equally valid conjugated/synonym form
4 = Correct meaning with minor spelling error or accent omission (e.g. "tenia" for "tenía")
3 = Recognisably correct but significantly misspelled or a weaker synonym
2 = Incorrect but shows some Spanish knowledge related to the concept
1 = Incorrect, barely related
0 = Completely wrong or blank

Be lenient on missing accent marks. Accept synonymous forms if they carry the same meaning.
Respond ONLY with valid JSON, no extra text:
{"qualityScore": <integer 0-5>, "feedback": "<one concise encouraging sentence explaining the score>"}`
    : `You are evaluating a Spanish vocabulary flashcard answer.

Spanish word/phrase: "${spanishTerm}"
Correct English answer: "${englishAnswer}"${sentenceContext}
Student's answer: "${userAnswer}"

Rate the student's answer on a 0–5 scale:
5 = Perfect recall, complete and accurate
4 = Correct with minor imprecision or trivial wording difference
3 = Essentially correct but missing nuance or partial
2 = Incorrect but showed some understanding when seeing the answer
1 = Incorrect, only vaguely familiar
0 = Completely wrong or blank

Be lenient with synonyms and paraphrasing — if the meaning is correct, score 4–5.
Respond ONLY with valid JSON, no extra text:
{"qualityScore": <integer 0-5>, "feedback": "<one concise encouraging sentence explaining the score>"}`

  let qualityScore = 0
  let feedback = 'Unable to evaluate — please continue.'

  try {
    const model = getModel('gemini-2.5-flash')
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      qualityScore = Math.max(0, Math.min(5, Math.round(Number(parsed.qualityScore))))
      feedback = String(parsed.feedback ?? feedback)
    }
  } catch (err) {
    console.error('[api/evaluate] AI error:', err)
  }

  // 2. Fetch current SM-2 progress
  const { data: progressRow } = await sb
    .from('card_progress')
    .select('ease_factor, interval_days, repetitions, total_reviews, total_correct')
    .eq('vocab_term_id', vocabTermId)
    .eq('user_id', user.id)
    .single()

  const isNewCard = !progressRow

  const current = progressRow
    ? {
        easeFactor: progressRow.ease_factor,
        intervalDays: progressRow.interval_days,
        repetitions: progressRow.repetitions,
      }
    : SM2_DEFAULTS

  // 3. Apply SM-2
  const sm2 = updateSM2(current, qualityScore)
  const isNewlyMastered = sm2.intervalDays >= 21 && (!progressRow || (progressRow.interval_days ?? 0) < 21)

  // 4. Persist progress
  const now = new Date().toISOString()
  const nextReviewDate = sm2.nextReviewAt.toISOString().slice(0, 10)

  if (progressRow) {
    await sb
      .from('card_progress')
      .update({
        ease_factor: sm2.easeFactor,
        interval_days: sm2.intervalDays,
        repetitions: sm2.repetitions,
        next_review_at: nextReviewDate,
        last_quality_score: qualityScore,
        last_reviewed_at: now,
        total_reviews: (progressRow.total_reviews ?? 0) + 1,
        total_correct: (progressRow.total_correct ?? 0) + (sm2.isCorrect ? 1 : 0),
        ...(isNewlyMastered ? { mastered_at: now } : {}),
      })
      .eq('vocab_term_id', vocabTermId)
      .eq('user_id', user.id)
  } else {
    await sb.from('card_progress').insert({
      vocab_term_id: vocabTermId,
      user_id: user.id,
      ease_factor: sm2.easeFactor,
      interval_days: sm2.intervalDays,
      repetitions: sm2.repetitions,
      next_review_at: nextReviewDate,
      last_quality_score: qualityScore,
      last_reviewed_at: now,
      introduced_at: now,
      total_reviews: 1,
      total_correct: sm2.isCorrect ? 1 : 0,
      ...(isNewlyMastered ? { mastered_at: now } : {}),
    })
  }

  return NextResponse.json({
    qualityScore,
    isCorrect: sm2.isCorrect,
    feedback,
    nextReviewAt: nextReviewDate,
    intervalDays: sm2.intervalDays,
    newlyMastered: isNewlyMastered,
    wasNewCard: isNewCard,
  })
}
