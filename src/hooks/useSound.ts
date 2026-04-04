'use client'

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'sf_sound_enabled'

export function useSound() {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    setEnabled(stored === 'true')
  }, [])

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  const play = useCallback(
    (type: 'flip' | 'correct' | 'wrong') => {
      if (!enabled) return
      const src = {
        flip: '/sounds/flip.wav',
        correct: '/sounds/correct.wav',
        wrong: '/sounds/wrong.wav',
      }[type]
      const audio = new Audio(src)
      audio.volume = 0.4
      audio.play().catch(() => {/* autoplay policy — silently ignore */})
    },
    [enabled]
  )

  return { enabled, toggle, play }
}
