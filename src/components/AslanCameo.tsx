'use client'

import { useEffect, useRef, useState } from 'react'

interface AslanCameoProps {
  streak: number
  summoned?: boolean
  onDismiss?: () => void
}

export function AslanCameo({ streak, summoned = false, onDismiss }: AslanCameoProps) {
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerAppearance = () => {
    setMounted(true)
    setDismissed(false)
    const slideTimer = setTimeout(() => setShown(true), 50)
    audioRef.current = new Audio('/sounds/aslan-roar.mp3')
    audioRef.current.volume = 0.65
    audioRef.current.play().catch(() => {})
    if (autoDismissRef.current) clearTimeout(autoDismissRef.current)
    autoDismissRef.current = setTimeout(() => {
      setDismissed(true)
      onDismiss?.()
    }, 5500)
    return slideTimer
  }

  // Streak-based auto-trigger (once per session)
  useEffect(() => {
    if (streak < 7) return
    if (typeof sessionStorage === 'undefined') return
    if (sessionStorage.getItem('aslan_shown')) return
    sessionStorage.setItem('aslan_shown', '1')
    const slideTimer = triggerAppearance()
    return () => clearTimeout(slideTimer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streak])

  // Manual summon trigger
  useEffect(() => {
    if (!summoned) return
    const slideTimer = triggerAppearance()
    return () => clearTimeout(slideTimer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summoned])

  const dismiss = () => {
    setDismissed(true)
    onDismiss?.()
  }

  if (!mounted || dismissed) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
    >
      <div
        className="pointer-events-auto flex flex-col items-center gap-4 transition-all duration-700 ease-out cursor-pointer"
        style={{
          opacity: shown ? 1 : 0,
          transform: shown ? 'scale(1) translateY(0)' : 'scale(0.7) translateY(60px)',
        }}
        onClick={dismiss}
        title="Click to dismiss"
      >
        <img
          src="/aslan.png"
          alt="Aslan roars!"
          className="w-[min(80vw,520px)] h-auto object-contain drop-shadow-2xl"
          style={{ filter: 'drop-shadow(0 0 60px rgba(255,160,0,0.5))' }}
        />
        <div className="text-center">
          <p className="text-neon-gold text-2xl font-bold tracking-wide"
             style={{ textShadow: '0 0 20px rgba(255,184,0,0.8)' }}>
            🦁 Aslan approves!
          </p>
          {streak > 0 && (
            <p className="text-white/50 text-sm mt-1">{streak}-day streak 🔥</p>
          )}
          <p className="text-white/25 text-xs mt-2">click anywhere to dismiss</p>
        </div>
      </div>
    </div>
  )
}
