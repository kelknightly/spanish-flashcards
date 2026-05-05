import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAllowedEmail } from '@/lib/auth-api'
import { sql } from '@/lib/db'

export async function POST(request: NextRequest) {
  const user = await getAuthUser()
  if (!user || !isAllowedEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { count: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const count = Math.max(0, Math.round(Number(body.count)))

  const profile = (await sql`
    SELECT daily_record_cards FROM user_profiles WHERE user_id = ${user.id}
  ` as Record<string, unknown>[])[0]
  const previousRecord = (profile as { daily_record_cards: number } | undefined)?.daily_record_cards ?? 0
  const isNewRecord = count > previousRecord

  if (isNewRecord) {
    await sql`
      UPDATE user_profiles SET daily_record_cards = ${count} WHERE user_id = ${user.id}
    `
  }

  return NextResponse.json({ isNewRecord, newRecord: isNewRecord ? count : previousRecord, previousRecord })
}
