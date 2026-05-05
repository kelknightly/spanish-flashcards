'use client'

import { type ReactNode } from 'react'
import { SessionProvider } from 'next-auth/react'
import { AuthProvider } from '@/contexts/AuthContext'
import { CardDirectionProvider } from '@/contexts/CardDirectionContext'
import { CursorTrailSettingsProvider } from '@/contexts/CursorTrailSettingsContext'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AuthProvider>
        <CardDirectionProvider>
          <CursorTrailSettingsProvider>
            {children}
          </CursorTrailSettingsProvider>
        </CardDirectionProvider>
      </AuthProvider>
    </SessionProvider>
  )
}
