'use client'

import { useEffect } from 'react'
import confetti from 'canvas-confetti'
import { useTheme } from '@/contexts/ThemeContext'

export function ConfettiCannon() {
  const { theme } = useTheme()

  useEffect(() => {
    const colors =
      theme === 'winter'
        ? ['#FFFFFF', '#A8DAFF', '#5BB8FF', '#D0EEFF', '#E8F4FF']
        : theme === 'summer'
        ? ['#FFB800', '#FF6B35', '#FFE066', '#7FD56F', '#FF9ED2', '#FFF5CC']
        : ['#FF2D9B', '#9B2DFF', '#2DAAFF', '#2DFF9B', '#FFD700', '#FF6BD6', '#A78BFA']

    // Centre burst from top
    confetti({
      particleCount: 160,
      spread: 85,
      startVelocity: 62,
      origin: { x: 0.5, y: 0 },
      colors,
      gravity: 0.9,
    })

    // Side cannons after a short delay
    setTimeout(() => {
      confetti({ particleCount: 70, spread: 60, startVelocity: 50, angle: 60, origin: { x: 0, y: 0.35 }, colors })
      confetti({ particleCount: 70, spread: 60, startVelocity: 50, angle: 120, origin: { x: 1, y: 0.35 }, colors })
    }, 350)
  }, [theme])

  return null
}
