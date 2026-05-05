'use client'

import {
  createContext,
  useCallback,
  useContext,
  type ReactNode,
} from 'react'
import { useSession, signIn as nextAuthSignIn, signOut as nextAuthSignOut } from 'next-auth/react'
import type { Session } from 'next-auth'

type AuthUser = {
  id: string
  email: string
  name?: string | null
  image?: string | null
}

type AuthState = {
  user: AuthUser | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession()
  const loading = status === 'loading'

  const user: AuthUser | null = session?.user?.email
    ? {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
      }
    : null

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await nextAuthSignIn('credentials', {
      email,
      password,
      redirect: false,
    })
    if (result?.error) {
      return { error: new Error('Invalid email or password') }
    }
    return { error: null }
  }, [])

  // Self-registration is disabled — use scripts/create-user.ts to add users.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const signUp = useCallback(async (_email: string, _password: string) => {
    return { error: new Error('Self-registration is not enabled') }
  }, [])

  const signOut = useCallback(async () => {
    await nextAuthSignOut({ redirect: false })
  }, [])

  return (
    <AuthContext.Provider value={{ user, session: session ?? null, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
