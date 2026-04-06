'use client'

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'sf_sound_enabled'

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as typeof window & { _sfAudioCtx?: AudioContext }
  if (!w._sfAudioCtx) w._sfAudioCtx = new AudioContext()
  return w._sfAudioCtx
}

/** Play the downloaded magical sparkle sound file */
function playSparkle() {
  const audio = new Audio('/sounds/correct.mp3')
  audio.volume = 0.6
  audio.play().catch(() => { /* autoplay policy — silently ignore */ })
}

/** A descending square-wave burst — low buzz */
function playBuzz(ctx: AudioContext) {
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'square'
  osc.frequency.setValueAtTime(150, now)
  osc.frequency.linearRampToValueAtTime(80, now + 0.3)
  gain.gain.setValueAtTime(0.22, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35)
  osc.start(now)
  osc.stop(now + 0.4)
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
    (type: 'correct' | 'wrong') => {
      if (!enabled) return
      if (type === 'correct') {
        playSparkle()
      } else {
        const ctx = getAudioContext()
        if (!ctx) return
        const run = () => playBuzz(ctx)
        if (ctx.state === 'suspended') ctx.resume().then(run)
        else run()
      }
    },
    [enabled]
  )

  return { enabled, toggle, play }
}
