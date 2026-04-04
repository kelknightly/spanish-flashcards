import { Suspense } from 'react'
import { LoginView } from '@/views/LoginView'

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-white/50">Loading…</p>
        </div>
      }
    >
      <LoginView />
    </Suspense>
  )
}
