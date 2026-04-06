'use client'

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'sf_sound_enabled'

const SOUNDS = {
  correct:  { src: '/sounds/correct.wav',  volume: 0.7 },
  wrong:    { src: '/sounds/wrong.wav',    volume: 0.7 },
  complete: { src: '/sounds/complete.wav', volume: 0.6 },
} as const

function playFile(type: keyof typeof SOUNDS) {
  const { src, volume } = SOUNDS[type]
  const audio = new Audio(src)
  audio.volume = volume
  audio.play().catch(() => { /* autoplay policy — silently ignore */ })
}

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
    (type: keyof typeof SOUNDS) => {
      if (!enabled) return
      playFile(type)
    },
    [enabled]
  )

  return { enabled, toggle, play }
}
