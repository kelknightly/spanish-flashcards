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
      className="fixed bottom-24 right-4 z-50 cursor-pointer md:bottom-8 md:right-6"
      onClick={dismiss}
      title="Click to dismiss Aslan"
    >
      <div
        className="rounded-2xl overflow-hidden border-2 transition-transform duration-700 ease-out"
        style={{
          background: 'rgba(8,4,0,0.93)',
          backdropFilter: 'blur(10px)',
          borderColor: 'rgba(255,184,0,0.55)',
          boxShadow: '0 0 40px rgba(255,160,0,0.35), 0 8px 32px rgba(0,0,0,0.8)',
          transform: shown ? 'translateY(0)' : 'translateY(220px)',
        }}
      >
        {/* Image: object-top to show the head */}
        <img
          src="/aslan.png"
          alt="Aslan roars!"
          className="w-28 h-28 object-cover object-top block"
        />
        <div className="px-3 py-2 text-center">
          <p className="text-neon-gold text-xs font-bold tracking-wide">🦁 Aslan approves!</p>
          <p className="text-white/35 text-[10px] mt-0.5">{streak}-day streak 🔥</p>
        </div>
      </div>
    </div>
  )
}
