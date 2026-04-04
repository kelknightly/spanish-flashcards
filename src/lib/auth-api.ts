import { createClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
const supabase = url && anonKey ? createClient(url, anonKey) : null

/**
 * Returns the user email if the request carries a valid Supabase JWT.
 * Use in API routes to protect data endpoints.
 */
export async function getAuthUserFromRequest(
  request: NextRequest
): Promise<{ email: string; id: string } | null> {
  if (!supabase) return null
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return null
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)
  if (error || !user?.email) return null
  return { email: user.email, id: user.id }
}

/**
 * Only Kelly's email is allowed. Checked against ALLOWED_ACCESS_EMAILS env var.
 */
export function isAllowedEmail(email: string): boolean {
  const allowlist = (process.env.ALLOWED_ACCESS_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return allowlist.includes(email.toLowerCase())
}
