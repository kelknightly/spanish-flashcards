import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { createClient } from '@supabase/supabase-js'

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

export async function GET(request: NextRequest) {
  const user = await getAuthUserFromRequest(request)
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  // Fetch card_progress rows with at least 3 reviews, ordered by fewest correct (most wrong)
  const { data: progressRows, error } = await sb
    .from('card_progress')
    .select('vocab_term_id, total_reviews, total_correct')
    .eq('user_id', user.id)
    .gte('total_reviews', 3)
    .order('total_correct', { ascending: true })
    .limit(30)

  if (error) {
    console.error('[api/nemesis-cards]', error.message)
    return NextResponse.json({ error: 'Failed to fetch progress' }, { status: 500 })
  }

  if (!progressRows?.length) {
    return NextResponse.json({ cards: [] })
  }

  // Sort by wrong count descending in JS (total_reviews - total_correct)
  const sorted = progressRows
    .map((r) => ({ ...r, wrong_count: r.total_reviews - r.total_correct }))
    .sort((a, b) => b.wrong_count - a.wrong_count)
    .slice(0, 5)

  const termIds = sorted.map((r) => r.vocab_term_id)

  // Fetch one card per vocab_term_id to get spanish_term + english_answer
  const { data: cards } = await sb
    .from('cards')
    .select('vocab_term_id, spanish_term, english_answer')
    .in('vocab_term_id', termIds)

  const cardMap = new Map(
    (cards ?? []).map((c) => [c.vocab_term_id, c])
  )

  const result = sorted
    .map((r) => ({
      vocab_term_id: r.vocab_term_id,
      spanish_term: cardMap.get(r.vocab_term_id)?.spanish_term ?? '',
      english_answer: cardMap.get(r.vocab_term_id)?.english_answer ?? '',
      wrong_count: r.wrong_count,
      total_reviews: r.total_reviews,
    }))
    .filter((r) => r.spanish_term)

  return NextResponse.json({ cards: result })
}
