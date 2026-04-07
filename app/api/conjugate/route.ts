import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { getModel } from '@/lib/gemini'

// Matches a Spanish infinitive: letters + common Spanish accent chars, 1–60 chars.
const INFINITIVE_RE = /^[a-záéíóúüñA-ZÁÉÍÓÚÜÑ]{1,60}$/

export async function POST(request: NextRequest) {
  const user = await getAuthUserFromRequest(request)
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).infinitive !== 'string'
  ) {
    return NextResponse.json({ error: 'Missing infinitive' }, { status: 400 })
  }

  const infinitive = ((body as Record<string, unknown>).infinitive as string).trim().toLowerCase()

  if (!INFINITIVE_RE.test(infinitive)) {
    return NextResponse.json({ error: 'Invalid infinitive' }, { status: 400 })
  }

  const model = getModel()

  const prompt = `Return ONLY a JSON array of strings (no markdown, no code fences, no explanation) containing every conjugated surface form of the Spanish verb "${infinitive}".

Include:
- All indicative tenses: present, preterite, imperfect, future, conditional
- All subjunctive tenses: present subjunctive, imperfect subjunctive (both -ra and -se variants)
- Imperative (affirmative and negative, all persons)
- The infinitive itself
- The gerund (present participle)
- The past participle (all gender/number forms: -ado/-ada/-ados/-adas or -ido/-ida etc.)

All forms should be lowercase strings. Do not include reflexive pronouns separately. Do not include compound tenses. No duplicates.

Respond with ONLY the JSON array, nothing else.`

  let raw: string
  try {
    const result = await model.generateContent(prompt)
    raw = result.response.text().trim()
  } catch (err) {
    console.error('[conjugate] Gemini error', err)
    return NextResponse.json({ error: 'Conjugation lookup failed' }, { status: 502 })
  }

  // Strip markdown code fences if Gemini adds them despite instructions
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  let forms: unknown
  try {
    forms = JSON.parse(raw)
  } catch {
    console.error('[conjugate] Failed to parse Gemini response:', raw)
    return NextResponse.json({ error: 'Failed to parse conjugation response' }, { status: 502 })
  }

  if (!Array.isArray(forms) || !forms.every((f) => typeof f === 'string')) {
    return NextResponse.json({ error: 'Unexpected conjugation response format' }, { status: 502 })
  }

  // Deduplicate and lowercase
  const deduplicated = [...new Set((forms as string[]).map((f) => f.toLowerCase().trim()).filter(Boolean))]

  return NextResponse.json({ infinitive, forms: deduplicated })
}
