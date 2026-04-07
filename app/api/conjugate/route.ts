import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { getModel } from '@/lib/gemini'
import { getConjugations } from '@/lib/conjugations'

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

  // ── Local lookup (no API call) ─────────────────────────────────────────
  const local = getConjugations(infinitive)
  if (local) {
    return NextResponse.json({ infinitive, forms: local })
  }

  // ── Gemini fallback for verbs not in the static table ─────────────────
  const model = getModel()

  const prompt = `Return ONLY a JSON array of objects (no markdown, no code fences, no explanation) where each object represents one conjugated surface form of the Spanish verb "${infinitive}".

Each object must have exactly two string fields:
- "form": the conjugated form, lowercase
- "translation": a short English label in the format "Tense: subject + meaning", e.g. "Future: he/she/it will have", "Imperfect: I/he/she/it had", "Present subjunctive: you have", "Gerund", "Past participle (feminine plural)", "Infinitive"

Include ALL of these:
- All indicative tenses: present, preterite, imperfect, future, conditional (all persons EXCEPT vosotros)
- All subjunctive tenses: present subjunctive, imperfect subjunctive -ra forms, imperfect subjunctive -se forms (all persons EXCEPT vosotros)
- Imperative (affirmative and negative, all applicable persons EXCEPT vosotros)
- The infinitive itself
- The gerund (present participle)
- The past participle (all gender/number forms)

Do not include vosotros forms. Do not include reflexive pronouns. Do not include compound tenses. No duplicate form+translation pairs.

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

  if (
    !Array.isArray(forms) ||
    !forms.every(
      (f) =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as Record<string, unknown>).form === 'string' &&
        typeof (f as Record<string, unknown>).translation === 'string'
    )
  ) {
    return NextResponse.json({ error: 'Unexpected conjugation response format' }, { status: 502 })
  }

  type VerbFormEntry = { form: string; translation: string }

  // Deduplicate by form (keep first occurrence)
  const seen = new Set<string>()
  const deduplicated = (forms as VerbFormEntry[])
    .map((f) => ({ form: f.form.toLowerCase().trim(), translation: f.translation.trim() }))
    .filter((f) => f.form && !seen.has(f.form) && seen.add(f.form))

  return NextResponse.json({ infinitive, forms: deduplicated })
}
