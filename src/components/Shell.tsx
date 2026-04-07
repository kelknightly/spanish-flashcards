'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { BookOpen, MessageSquare, RotateCcw, BookText, Volume2, VolumeX, Sparkles, LogOut, Languages, Snowflake, Sun } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useStreak } from '@/hooks/useStreak'
import { useSound } from '@/hooks/useSound'
import { useSparkle } from '@/contexts/SparkleContext'
import { useCardDirection } from '@/contexts/CardDirectionContext'
import { useTheme, type Theme } from '@/contexts/ThemeContext'
import { AslanCameo } from '@/components/AslanCameo'
import { SnowLayer } from '@/components/themes/SnowLayer'
import { SunraysLayer } from '@/components/themes/SunraysLayer'
import { PetalLayer } from '@/components/themes/PetalLayer'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/decks',  label: 'Decks',   icon: BookOpen },
  { href: '/chat',   label: 'New Deck', icon: MessageSquare },
  { href: '/review', label: 'Review',   icon: RotateCcw },
  { href: '/reader', label: 'Reader',   icon: BookText },
]

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { signOut } = useAuth()
  const streak = useStreak()
  const { enabled, toggle } = useSound()
  const { paused, togglePaused } = useSparkle()
  const { direction, toggle: toggleDirection } = useCardDirection()
  const { theme, setTheme } = useTheme()

  // Desktop-only features (coarse pointer = touch device)
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    setIsDesktop(!window.matchMedia('(pointer: coarse)').matches)
  }, [])

  // Manual Aslan summon
  const [aslanSummoned, setAslanSummoned] = useState(false)
  const [lionBtnShaking, setLionBtnShaking] = useState(false)

  const handleSummonAslan = () => {
    // Shake the button
    setLionBtnShaking(true)
    setTimeout(() => setLionBtnShaking(false), 500)
    // Re-summon even if already shown (reset by toggling)
    setAslanSummoned(false)
    setTimeout(() => setAslanSummoned(true), 50)
  }

  const themeIcons: Record<Theme, React.ReactNode> = {
    glitter: <Sparkles size={18} strokeWidth={2.5} />,
    winter: <Snowflake size={18} strokeWidth={2.5} />,
    summer: <Sun size={18} strokeWidth={2.5} />,
  }
  const themeColors: Record<Theme, string> = {
    glitter: '#FF2D9B',
    winter: '#A8DAFF',
    summer: '#FFB800',
  }
  const themeOrder: Theme[] = ['glitter', 'winter', 'summer']
  const nextTheme = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length]
  const themeLabels: Record<Theme, string> = { glitter: 'Glitter', winter: 'Winter', summer: 'Summer' }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* ── Ambient theme layers (desktop only — too heavy for mobile) ── */}
      {isDesktop && theme === 'winter' && <SnowLayer />}
      {isDesktop && theme === 'summer' && <SunraysLayer />}
      {isDesktop && theme === 'summer' && <PetalLayer />}

      {/* ── Aslan cameo ─────────────────────────────────────────── */}
      <AslanCameo streak={streak} summoned={aslanSummoned} onDismiss={() => setAslanSummoned(false)} />
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

        {/* Right side: streak + aslan + controls + signout */}
        <div className="flex items-center gap-3">
          {streak > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-orange-500/20 px-3 py-1 text-sm font-semibold text-orange-400">
              🔥 {streak}
            </span>
          )}
          {/* Aslan summon button — desktop only */}
          <button
            onClick={handleSummonAslan}
            title="Summon Aslan"
            className={`hidden md:flex rounded-xl p-2 text-xl leading-none transition-colors hover:bg-white/10 ${lionBtnShaking ? 'animate-shake' : ''}`}
          >
            🦁
          </button>
          <button
            onClick={toggleDirection}
            title={direction === 'es-to-en' ? 'Switch to EN→ES production mode' : 'Switch to ES→EN recognition mode'}
            className={cn(
              'rounded-xl px-2.5 py-1.5 text-xs font-bold tracking-wide transition-colors flex items-center gap-1',
              direction === 'en-to-es'
                ? 'bg-neon-gold/20 text-neon-gold hover:bg-neon-gold/30'
                : 'text-white/40 hover:bg-white/10 hover:text-white/70'
            )}
          >
            <Languages size={14} />
            {direction === 'es-to-en' ? 'ES→EN' : 'EN→ES'}
          </button>
          <button
            onClick={toggle}
            title={enabled ? 'Mute sounds' : 'Enable sounds'}
            className="rounded-xl p-2 text-neon-pink transition-colors hover:bg-neon-pink/20"
          >
            {enabled ? <Volume2 size={22} strokeWidth={2.5} /> : <VolumeX size={22} strokeWidth={2.5} />}
          </button>
          {/* Theme toggle — shows icon of CURRENT theme */}
          <button
            onClick={() => setTheme(nextTheme)}
            title={`Theme: ${themeLabels[theme]} → click for ${themeLabels[nextTheme]}`}
            className="rounded-xl p-2 transition-all hover:bg-white/10"
            style={{
              color: themeColors[theme],
              filter: `drop-shadow(0 0 6px ${themeColors[theme]}88)`,
            }}
          >
            {themeIcons[theme]}
          </button>
          <button
            onClick={togglePaused}
            title={paused ? 'Enable glitter' : 'Pause glitter'}
            className="rounded-xl p-2 transition-colors hover:bg-neon-pink/20"
            style={{ color: paused ? 'rgb(255 255 255 / 0.2)' : 'var(--neon-pink, #ff2d9b)' }}
          >
            <Sparkles size={22} strokeWidth={2.5} />
          </button>
          <button
            onClick={() => signOut()}
            title="Sign out"
            className="rounded-xl p-2 text-neon-pink transition-colors hover:bg-neon-pink/20"
          >
            <LogOut size={22} strokeWidth={2.5} />
          </button>
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-auto pb-20 md:pb-0">
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
