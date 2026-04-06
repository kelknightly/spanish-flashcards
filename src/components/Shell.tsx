'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, MessageSquare, RotateCcw, Volume2, VolumeX, Sparkles, LogOut } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useStreak } from '@/hooks/useStreak'
import { useSound } from '@/hooks/useSound'
import { useSparkle } from '@/contexts/SparkleContext'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/decks',  label: 'Decks',  icon: BookOpen },
  { href: '/chat',   label: 'New Deck', icon: MessageSquare },
  { href: '/review', label: 'Review',  icon: RotateCcw },
]

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { signOut } = useAuth()
  const streak = useStreak()
  const { enabled, toggle } = useSound()
  const { paused, togglePaused } = useSparkle()

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── Top header ─────────────────────────────────────────── */}
      <header className="glass sticky top-0 z-40 flex items-center justify-between px-4 py-3 md:px-6">
        {/* Logo */}
        <Link href="/decks" className="flex items-center gap-2">
          <span className="text-lg font-bold text-glow-pink text-neon-pink">✨ Narnia ES</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                pathname?.startsWith(href)
                  ? 'bg-neon-pink/20 text-neon-pink'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              )}
            >
              <Icon size={15} />
              {label}
            </Link>
          ))}
        </nav>

        {/* Right side: streak + sound + signout */}
        <div className="flex items-center gap-3">
          {streak > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-orange-500/20 px-3 py-1 text-sm font-semibold text-orange-400">
              🔥 {streak}
            </span>
          )}
          <button
            onClick={toggle}
            title={enabled ? 'Mute sounds' : 'Enable sounds'}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
          >
            {enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button
            onClick={togglePaused}
            title={paused ? 'Enable glitter' : 'Pause glitter'}
            className="rounded-lg p-1.5 transition-colors hover:bg-white/10 hover:text-white/80"
            style={{ color: paused ? 'rgb(255 255 255 / 0.2)' : 'rgb(255 255 255 / 0.4)' }}
          >
            <Sparkles size={16} />
          </button>
          <button
            onClick={() => signOut()}
            title="Sign out"
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────── */}
      <main className="flex-1 pb-20 md:pb-0">
        {children}
      </main>

      {/* ── Mobile bottom tab bar ──────────────────────────────── */}
      <nav className="glass fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-white/10 px-2 py-2 md:hidden">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname?.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 rounded-lg py-2 text-xs font-medium transition-colors',
                active ? 'text-neon-pink' : 'text-white/50'
              )}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.5} />
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
