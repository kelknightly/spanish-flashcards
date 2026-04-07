import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { getModel } from '@/lib/gemini'
import { getInfinitive } from '@/lib/conjugations'

// Matches a Spanish verb form: letters + accented/special chars, 1–60 chars
const FORM_RE = /^[a-záéíóúüñA-ZÁÉÍÓÚÜÑ]{1,60}$/

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
    typeof (body as Record<string, unknown>).form !== 'string'
  ) {
    return NextResponse.json({ error: 'Missing form' }, { status: 400 })
  }

  const form = ((body as Record<string, unknown>).form as string).trim().toLowerCase()

  if (!FORM_RE.test(form)) {
    return NextResponse.json({ error: 'Invalid form' }, { status: 400 })
  }

  // ── Local lookup (no API call) ─────────────────────────────────────────
  const local = getInfinitive(form)
  if (local) {
    return NextResponse.json({ infinitive: local })
  }

  // ── Gemini fallback for forms not in the static table ─────────────────
  const model = getModel()

  const prompt = `Return only the Spanish infinitive of the verb form "${form}". Reply with just the single infinitive word in lowercase, nothing else. No punctuation, no explanation.`

  let raw: string
  try {
    const result = await model.generateContent(prompt)
    raw = result.response.text().trim().toLowerCase()
  } catch (err) {
    console.error('[infinitive] Gemini error', err)
    return NextResponse.json({ error: 'Infinitive lookup failed' }, { status: 502 })
  }

  // Take only the first word and strip non-Spanish characters
  raw = raw.split(/\s+/)[0].replace(/[^a-záéíóúüñ]/g, '')

  if (!raw || !FORM_RE.test(raw)) {
    console.error('[infinitive] Unexpected Gemini response:', raw)
    return NextResponse.json({ error: 'Unexpected response format' }, { status: 502 })
  }

  return NextResponse.json({ infinitive: raw })
}
