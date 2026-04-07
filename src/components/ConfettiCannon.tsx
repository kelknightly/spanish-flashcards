'use client'

import { useEffect } from 'react'
import { Fireworks } from 'fireworks-js'

const STORAGE_KEY = 'sf_sound_enabled'
const APPLAUSE_FADE_WINDOW_S = 1.5 // seconds before end to start applause fade

export function ConfettiCannon() {
  useEffect(() => {
    // ── Full-screen overlay container ─────────────────────────────────────────
    const container = document.createElement('div')
    container.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'z-index:9999;pointer-events:none;transition:opacity 0.8s ease-out;'
    document.body.appendChild(container)

    // ── Fireworks visual ──────────────────────────────────────────────────────
    const fw = new Fireworks(container, {
      hue:          { min: 0,    max: 360  },
      rocketsPoint: { min: 10,   max: 90   },
      intensity:    44,
      explosion:    16,
      particles:    180,
      traceLength:  14,
      traceSpeed:   10,
      flickering:   70,
      brightness:   { min: 55,   max: 90   },
      decay:        { min: 0.010, max: 0.022 },
      gravity:      1.0,
      friction:     0.95,
      lineWidth:    { explosion: { min: 4, max: 8 }, trace: { min: 2, max: 4 } },
      lineStyle:    'round',
      sound:        { enabled: false, files: [], volume: { min: 0, max: 0 } },
    })
    fw.start()

    // ── Timer helpers ─────────────────────────────────────────────────────────
    let fadeTimer: ReturnType<typeof setTimeout> | null = null
    let stopTimer: ReturnType<typeof setTimeout> | null = null

    function scheduleStop(durationS: number) {
      if (fadeTimer) clearTimeout(fadeTimer)
      if (stopTimer) clearTimeout(stopTimer)

      const fadeStartMs = Math.max(0, durationS * 1000 - 800)
      fadeTimer = setTimeout(() => {
        container.style.opacity = '0'
      }, fadeStartMs)

      stopTimer = setTimeout(() => {
        fw.stop(true)
        if (container.isConnected) container.remove()
      }, durationS * 1000 + 200)
    }

    // ── Audio ─────────────────────────────────────────────────────────────────
    let audioCtx: AudioContext | null = null
    const soundEnabled = localStorage.getItem(STORAGE_KEY) === 'true'

    if (soundEnabled) {
      audioCtx = new AudioContext()
      const ctx = audioCtx

      Promise.all([
        fetch('/sounds/fireworks-bangs.wav').then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)),
        fetch('/sounds/fireworks-whistles.wav').then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)),
        fetch('/sounds/applause.wav').then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)),
      ]).then(([bangs, whistles, applause]) => {
        const fireworksDuration = Math.max(bangs.duration, whistles.duration)
        const now = ctx.currentTime

        // Bangs
        const bangsGain = ctx.createGain()
        bangsGain.gain.value = 0.7
        bangsGain.connect(ctx.destination)
        const bangsSrc = ctx.createBufferSource()
        bangsSrc.buffer = bangs
        bangsSrc.connect(bangsGain)
        bangsSrc.start(now)

        // Whistles
        const whistlesGain = ctx.createGain()
        whistlesGain.gain.value = 0.5
        whistlesGain.connect(ctx.destination)
        const whistlesSrc = ctx.createBufferSource()
        whistlesSrc.buffer = whistles
        whistlesSrc.connect(whistlesGain)
        whistlesSrc.start(now)

        // Applause — hold full volume then fade to silence at fireworksDuration
        const applauseGain = ctx.createGain()
        const fadeStart = Math.max(0, fireworksDuration - APPLAUSE_FADE_WINDOW_S)
        applauseGain.gain.setValueAtTime(0.6, now)
        applauseGain.gain.setValueAtTime(0.6, now + fadeStart)
        applauseGain.gain.linearRampToValueAtTime(0, now + fireworksDuration)
        applauseGain.connect(ctx.destination)
        const applauseSrc = ctx.createBufferSource()
        applauseSrc.buffer = applause
        applauseSrc.connect(applauseGain)
        applauseSrc.start(now)

        scheduleStop(fireworksDuration)
      }).catch(() => {
        // Audio unavailable — fall back to a reasonable visual-only duration
        scheduleStop(8)
      })
    } else {
      // Sound off — run fireworks for a fixed duration
      scheduleStop(8)
    }

    // ── Cleanup on unmount ────────────────────────────────────────────────────
    return () => {
      if (fadeTimer) clearTimeout(fadeTimer)
      if (stopTimer) clearTimeout(stopTimer)
      if (fw.isRunning) fw.stop(true)
      if (container.isConnected) container.remove()
      audioCtx?.close()
    }
  }, [])

  return null
}
