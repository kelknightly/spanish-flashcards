'use client'

import { type ReactNode } from 'react'
import { isSupabaseConfigured, envDiagnostic } from '@/lib/supabase'
import { AuthProvider } from '@/contexts/AuthContext'
import { CardDirectionProvider } from '@/contexts/CardDirectionContext'

function SetupMessage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-bg p-6">
      <div className="max-w-md rounded-lg border border-neon-purple/30 bg-brand-surface p-6 text-white">
        <h1 className="text-lg font-semibold text-neon-pink">Setup required</h1>
        <p className="mt-2 text-sm text-white/80">
          Add <code className="rounded bg-white/10 px-1">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code className="rounded bg-white/10 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to your{' '}
          <code className="rounded bg-white/10 px-1">.env</code> file.
          Get the values from Supabase Dashboard → Project Settings → API.
        </p>
        <p className="mt-3 text-xs text-white/50">
          NEXT_PUBLIC_SUPABASE_URL: <strong>{envDiagnostic.url}</strong> ·{' '}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: <strong>{envDiagnostic.anonKey}</strong>
        </p>
      </div>
    </div>
  )
}

export function Providers({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured) {
    return <SetupMessage />
  }
  return <AuthProvider><CardDirectionProvider>{children}</CardDirectionProvider></AuthProvider>
}
