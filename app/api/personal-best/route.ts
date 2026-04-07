import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserFromRequest, isAllowedEmail } from '@/lib/auth-api'
import { createClient } from '@supabase/supabase-js'

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

  let body: { count: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const count = Math.max(0, Math.round(Number(body.count)))

  const sb = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: profile } = await sb
    .from('user_profiles')
    .select('daily_record_cards')
    .eq('user_id', user.id)
    .single()

  const previousRecord = profile?.daily_record_cards ?? 0
  const isNewRecord = count > previousRecord

  if (isNewRecord) {
    await sb
      .from('user_profiles')
      .update({ daily_record_cards: count })
      .eq('user_id', user.id)
  }

  return NextResponse.json({ isNewRecord, newRecord: isNewRecord ? count : previousRecord, previousRecord })
}
