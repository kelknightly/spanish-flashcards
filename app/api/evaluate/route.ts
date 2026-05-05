import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAllowedEmail } from '@/lib/auth-api'
import { getModel } from '@/lib/gemini'
import { sql } from '@/lib/db'
import { updateSM2, SM2_DEFAULTS } from '@/lib/sm2'

export async function POST(request: NextRequest) {
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
  const progressRow = (await sql`
    SELECT ease_factor, interval_days, repetitions, total_reviews, total_correct
    FROM card_progress
    WHERE vocab_term_id = ${vocabTermId} AND user_id = ${user.id}
  ` as Record<string, unknown>[])[0]

  const isNewCard = !progressRow

  // Append snarky one-liner if this is a wrong answer and it's been wrong 3+ times before
  const wrongCount = ((progressRow as Record<string, number> | undefined)?.total_reviews ?? 0) - ((progressRow as Record<string, number> | undefined)?.total_correct ?? 0)
  if (qualityScore < 3 && wrongCount >= 3) {
    const snarkyLines = [
      ' ¡Nos vemos de nuevo! This one really has a grudge against you.',
      ` That's ${wrongCount} times now. Maybe try writing it on your hand? Both hands?`,
      ' Even Mr. Beaver would know this one by now.',
      ' Aslan is watching. He is not angry — just deeply, deeply disappointed.',
      ' This word has moved in. It has unpacked its bags. It is not leaving.',
      ' At this rate you and this card are becoming sworn enemies. ¡Enemigos!',
      ' The White Witch got this one right on the first try. Just saying.',
      ` ${wrongCount} attempts! Every expert was once a beginner. You are still very much a beginner.`,
      ' Slow and steady wins the race. You are bringing a very relaxed energy to "steady".',
      ' Peter and Edmund both got this right. Lucy too. Even Edmund.',
    ]
    feedback += '\n\n' + snarkyLines[wrongCount % snarkyLines.length]
  }

  const pr = progressRow as Record<string, number | null> | undefined
  const current = pr
    ? {
        easeFactor: pr.ease_factor as number,
        intervalDays: pr.interval_days as number,
        repetitions: pr.repetitions as number,
      }
    : SM2_DEFAULTS

  // 3. Apply SM-2
  const sm2 = updateSM2(current, qualityScore)
  const isNewlyMastered = sm2.intervalDays >= 21 && (!pr || ((pr.interval_days as number) ?? 0) < 21)

  // 4. Persist progress (upsert)
  const now = new Date().toISOString()
  const nextReviewDate = sm2.nextReviewAt.toISOString().slice(0, 10)

  if (pr) {
    await sql`
      UPDATE card_progress SET
        ease_factor        = ${sm2.easeFactor},
        interval_days      = ${sm2.intervalDays},
        repetitions        = ${sm2.repetitions},
        next_review_at     = ${nextReviewDate},
        last_quality_score = ${qualityScore},
        last_reviewed_at   = ${now},
        total_reviews      = ${((pr.total_reviews as number) ?? 0) + 1},
        total_correct      = ${((pr.total_correct as number) ?? 0) + (sm2.isCorrect ? 1 : 0)},
        mastered_at        = ${isNewlyMastered ? now : (pr.mastered_at as string | null) ?? null}
      WHERE vocab_term_id = ${vocabTermId} AND user_id = ${user.id}
    `
  } else {
    await sql`
      INSERT INTO card_progress
        (vocab_term_id, user_id, ease_factor, interval_days, repetitions,
         next_review_at, last_quality_score, last_reviewed_at, introduced_at,
         total_reviews, total_correct, mastered_at)
      VALUES (
        ${vocabTermId}, ${user.id}, ${sm2.easeFactor}, ${sm2.intervalDays}, ${sm2.repetitions},
        ${nextReviewDate}, ${qualityScore}, ${now}, ${now},
        1, ${sm2.isCorrect ? 1 : 0}, ${isNewlyMastered ? now : null}
      )
    `
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
