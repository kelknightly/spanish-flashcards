'use client'

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'sf_sound_enabled'

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as typeof window & { _sfAudioCtx?: AudioContext }
  if (!w._sfAudioCtx) w._sfAudioCtx = new AudioContext()
  return w._sfAudioCtx
}

/** Scattered high-freq sparkle particles + airy noise shimmer — magical glitter */
function playSparkle(ctx: AudioContext) {
  const now = ctx.currentTime

  // High-pass filtered noise burst for the "air" shimmer
  const bufLen = Math.floor(ctx.sampleRate * 0.55)
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource()
  noise.buffer = buf
  const hpf = ctx.createBiquadFilter()
  hpf.type = 'highpass'
  hpf.frequency.value = 5000
  const noiseGain = ctx.createGain()
  noiseGain.gain.setValueAtTime(0, now)
  noiseGain.gain.linearRampToValueAtTime(0.05, now + 0.04)
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
  noise.connect(hpf)
  hpf.connect(noiseGain)
  noiseGain.connect(ctx.destination)
  noise.start(now)
  noise.stop(now + 0.55)

  // 20 individual sparkle tones scattered randomly in time and stereo space
  for (let i = 0; i < 20; i++) {
    const t = now + Math.random() * 0.38
    const freq = 2200 + Math.random() * 5800   // 2.2 kHz – 8 kHz
    const dur = 0.04 + Math.random() * 0.09
    const vol = 0.06 + Math.random() * 0.09

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const pan = ctx.createStereoPanner()
    osc.connect(gain)
    gain.connect(pan)
    pan.connect(ctx.destination)

    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, t)
    // Tiny upward pitch flick — each sparkle "rises"
    osc.frequency.linearRampToValueAtTime(freq * 1.04, t + dur)

    pan.pan.value = Math.random() * 2 - 1   // scatter across stereo field

    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(vol, t + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur)

    osc.start(t)
    osc.stop(t + dur + 0.01)
  }
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
