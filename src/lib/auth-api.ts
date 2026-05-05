import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * Returns the authenticated user from the NextAuth session cookie.
 * Use in API Route Handlers to protect data endpoints.
 */
export async function getAuthUser(): Promise<{ email: string; id: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || !session?.user?.id) return null
  return { email: session.user.email, id: session.user.id }
}

/**
 * Only allowed emails can access the app. Checked against ALLOWED_ACCESS_EMAILS env var.
 */
export function isAllowedEmail(email: string): boolean {
  const allowlist = (process.env.ALLOWED_ACCESS_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return allowlist.includes(email.toLowerCase())
}
