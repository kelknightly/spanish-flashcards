'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const STORAGE_KEY = 'sf_sound_enabled'

const SOUND_CONFIG = {
  correct:  { src: '/sounds/correct.wav',  volume: 0.7 },
  wrong:    { src: '/sounds/wrong.wav',    volume: 0.7 },
  complete: { src: '/sounds/complete.wav', volume: 0.6 },
} as const

type SoundType = keyof typeof SOUND_CONFIG

export function useSound() {
  const [enabled, setEnabled] = useState(false)
  const audioRef = useRef<Record<SoundType, HTMLAudioElement | null>>({
    correct: null,
    wrong: null,
    complete: null,
  })

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    setEnabled(stored === 'true')

    // Preload all sounds immediately so they're cached and ready
    ;(Object.keys(SOUND_CONFIG) as SoundType[]).forEach((type) => {
      const { src, volume } = SOUND_CONFIG[type]
      const audio = new Audio(src)
      audio.preload = 'auto'
      audio.volume = volume
      audioRef.current[type] = audio
    })
  }, [])

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  const play = useCallback(
    (type: SoundType) => {
      if (localStorage.getItem(STORAGE_KEY) !== 'true') return
      const audio = audioRef.current[type]
      if (!audio) return
      audio.currentTime = 0
      audio.play().catch(() => { /* autoplay policy — silently ignore */ })
    },
    []
  )

  return { enabled, toggle, play }
}
