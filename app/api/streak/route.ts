import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-api'
import { sql } from '@/lib/db'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = (await sql`
    SELECT current_streak FROM user_profiles WHERE user_id = ${user.id}
  `) as { current_streak: number }[]
  const streak = rows[0] ? rows[0].current_streak ?? 0 : 0
  return NextResponse.json({ streak })
}
