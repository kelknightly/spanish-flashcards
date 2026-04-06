'use client'

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'sf_sound_enabled'

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as typeof window & { _sfAudioCtx?: AudioContext }
  if (!w._sfAudioCtx) w._sfAudioCtx = new AudioContext()
  return w._sfAudioCtx
}

/** A cascade of high sine tones — sparkly glitter shimmer */
function playSparkle(ctx: AudioContext) {
  const freqs = [1046, 1318, 1568, 2093, 2637] // C6 E6 G6 C7 E7
  const now = ctx.currentTime
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, now + i * 0.06)
    gain.gain.setValueAtTime(0, now + i * 0.06)
    gain.gain.linearRampToValueAtTime(0.18, now + i * 0.06 + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.15)
    osc.start(now + i * 0.06)
    osc.stop(now + i * 0.06 + 0.2)
  })
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
      const ctx = getAudioContext()
      if (!ctx) return
      const run = () => (type === 'correct' ? playSparkle(ctx) : playBuzz(ctx))
      if (ctx.state === 'suspended') ctx.resume().then(run)
      else run()
    },
    [enabled]
  )

  return { enabled, toggle, play }
}
