'use client'

import { useEffect, useRef } from 'react'
import { useSparkle } from '@/contexts/SparkleContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useCursorTrailSettings, type TrailSettings } from '@/contexts/CursorTrailSettingsContext'
import type { Theme } from '@/contexts/ThemeContext'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  life: number
  maxLife: number
  isBurst: boolean
}

interface RainZone {
  rect: DOMRect
  age: number      // frames elapsed
  duration: number // total frames to emit
}

const MAX_PARTICLES = 500

export function SparkleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { registerBurst, paused } = useSparkle()
  const { theme } = useTheme()
  const { settings } = useCursorTrailSettings()
  const pausedRef = useRef(paused)
  const themeRef = useRef(theme)
  const settingsRef = useRef(settings)
  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { themeRef.current = theme }, [theme])
  useEffect(() => { settingsRef.current = settings }, [settings])

  useEffect(() => {
    // Only run on pointer-precise (non-touch) devices
    if (typeof window === 'undefined') return
    if (window.matchMedia('(pointer: coarse)').matches) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    const particles: Particle[] = []
    const rainZones: RainZone[] = []

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const randomColor = () => {
      const ts: TrailSettings = settingsRef.current[themeRef.current as Theme]
      const hueShift = (Math.random() - 0.5) * 50
      const hue = ((ts.hue + hueShift) % 360 + 360) % 360
      const sat = Math.floor(Math.random() * 20 + 80)  // 80–100%
      const lig = Math.floor(Math.random() * 20 + 55)  // 55–75%
      return `hsl(${hue}, ${sat}%, ${lig}%)`
    }

    // Cursor trail particle – bright, fatty, long-lived
    const spawnTrailParticle = (x: number, y: number) => {
      if (particles.length >= MAX_PARTICLES) particles.shift()
      const isWinter = themeRef.current === 'winter'
      const isSummer = themeRef.current === 'summer'
      const sMult = settingsRef.current[themeRef.current as Theme].sizeMultiplier
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * (isWinter ? 3 : 4),
        vy: -(Math.random() * 3.5 + 1),
        size: (isWinter
          ? Math.random() * 9 + 5          // 5–14px — big icy shards
          : isSummer
          ? Math.random() * 5 + 3          // 3–8px — small blossoms
          : Math.random() * 4.5 + 2.5      // original glitter size
        ) * sMult,
        color: randomColor(),
        life: 0,
        maxLife: isWinter
          ? Math.floor(Math.random() * 30 + 55) // 55–85 frames — linger like snow
          : isSummer
          ? Math.floor(Math.random() * 15 + 25) // 25–40 frames — petals fade quickly
          : Math.floor(Math.random() * 20 + 40),
        isBurst: false,
      })
    }

    // Burst/rain particle – even bigger, even longer, strong initial kick
    const spawnBurstParticle = (x: number, y: number) => {
      if (particles.length >= MAX_PARTICLES) particles.shift()
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 10,
        vy: -(Math.random() * 8 + 2),
        size: Math.random() * 7 + 3,
        color: randomColor(),
        life: 0,
        maxLife: Math.floor(Math.random() * 50 + 70), // 70–120 frames ≈ 1.2–2 s
        isBurst: true,
      })
    }

    // Helpers for border positions
    const borderPositions = (rect: DOMRect) => [
      { x: rect.left,                   y: rect.top                    },
      { x: rect.left + rect.width / 4,  y: rect.top                    },
      { x: rect.left + rect.width / 2,  y: rect.top                    },
      { x: rect.left + rect.width * .75,y: rect.top                    },
      { x: rect.right,                  y: rect.top                    },
      { x: rect.right,                  y: rect.top + rect.height / 4  },
      { x: rect.right,                  y: rect.top + rect.height / 2  },
      { x: rect.right,                  y: rect.top + rect.height * .75},
      { x: rect.right,                  y: rect.bottom                 },
      { x: rect.left + rect.width * .75,y: rect.bottom                 },
      { x: rect.left + rect.width / 2,  y: rect.bottom                 },
      { x: rect.left + rect.width / 4,  y: rect.bottom                 },
      { x: rect.left,                   y: rect.bottom                 },
      { x: rect.left,                   y: rect.top + rect.height * .75},
      { x: rect.left,                   y: rect.top + rect.height / 2  },
      { x: rect.left,                   y: rect.top + rect.height / 4  },
    ]

    const randomBorderPos = (rect: DOMRect) => {
      const pts = borderPositions(rect)
      return pts[Math.floor(Math.random() * pts.length)]
    }

    const onMouseMove = (e: MouseEvent) => {
      if (pausedRef.current) return
      const qMult = settingsRef.current[themeRef.current as Theme].quantityMultiplier
      const base = (Math.floor(Math.random() * 2) + 2) * qMult
      const count = Math.max(0, Math.round(base))
      for (let i = 0; i < count; i++) spawnTrailParticle(e.clientX, e.clientY)
    }
    window.addEventListener('mousemove', onMouseMove)

    // Register burst handler – fires an initial explosion + starts a sustained rain zone
    registerBurst((rect: DOMRect) => {
      // Initial burst: 7 particles per border point (kept lean so the flip isn't blocked)
      for (const pos of borderPositions(rect)) {
        for (let i = 0; i < 7; i++) {
          spawnBurstParticle(
            pos.x + (Math.random() - 0.5) * 40,
            pos.y + (Math.random() - 0.5) * 40,
          )
        }
      }
      // Rain zone: ~1.5 seconds (90 frames @ 60 fps)
      rainZones.push({ rect, age: 0, duration: 90 })
    })

    // Track last theme so we can flush stale particles on switch
    let lastTheme = themeRef.current

    const draw = () => {
      // Flush old particles immediately when theme switches —
      // otherwise old glitter colors linger in the buffer drawn as wrong shapes
      if (themeRef.current !== lastTheme) {
        lastTheme = themeRef.current
        particles.length = 0
        rainZones.length = 0
      }

      if (pausedRef.current) {
        particles.length = 0
        rainZones.length = 0
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        animId = requestAnimationFrame(draw)
        return
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Tick rain zones and spawn continuous particles
      for (let z = rainZones.length - 1; z >= 0; z--) {
        const zone = rainZones[z]
        zone.age++
        if (zone.age > zone.duration) {
          rainZones.splice(z, 1)
          continue
        }
        // Emit 2–4 particles per frame from random border points
        const emit = Math.floor(Math.random() * 3) + 2
        for (let e = 0; e < emit; e++) {
          const pos = randomBorderPos(zone.rect)
          spawnBurstParticle(
            pos.x + (Math.random() - 0.5) * 30,
            pos.y + (Math.random() - 0.5) * 30,
          )
        }
      }

      // Draw all particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.x += p.vx
        p.y += p.vy
        // Theme-specific physics
        if (themeRef.current === 'winter') {
          p.vy += p.isBurst ? 0.16 : 0.08  // heavier gravity = snow falls fast
          p.vx += (Math.random() - 0.5) * 0.06  // blowing sideways
        } else if (themeRef.current === 'summer') {
          p.vy += p.isBurst ? 0.06 : 0.01  // light gravity — petals float
          p.vy = Math.max(p.vy, -1.2)      // cap upward drift
        } else {
          p.vy += p.isBurst ? 0.12 : 0.07  // original glitter gravity
        }
        p.vx *= 0.98                        // air resistance
        p.life++

        const alpha = 1 - p.life / p.maxLife
        if (alpha <= 0) {
          particles.splice(i, 1)
          continue
        }

        const t = themeRef.current

        // Stale particles from a previous theme are flushed on theme-switch above

        ctx.save()
        ctx.globalAlpha = alpha

        if (t === 'winter') {
          // 6-arm asterisk / snowflake stroke
          ctx.strokeStyle = p.color
          ctx.lineWidth = p.size * 0.35
          ctx.shadowBlur = p.isBurst ? 18 : 10
          ctx.shadowColor = p.color
          ctx.lineCap = 'round'
          for (let arm = 0; arm < 3; arm++) {
            const angle = (arm * Math.PI) / 3
            ctx.beginPath()
            ctx.moveTo(p.x - Math.cos(angle) * p.size, p.y - Math.sin(angle) * p.size)
            ctx.lineTo(p.x + Math.cos(angle) * p.size, p.y + Math.sin(angle) * p.size)
            ctx.stroke()
          }
        } else if (t === 'summer') {
          // Simple circle blossom — uses p.color so the hue slider applies
          ctx.shadowBlur = 6
          ctx.shadowColor = p.color
          ctx.fillStyle = p.color
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          ctx.fill()
          // Tiny yellow centre
          ctx.shadowBlur = 0
          ctx.fillStyle = '#FFD700'
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * 0.3, 0, Math.PI * 2)
          ctx.fill()
        } else {
          // Default glitter: filled circle with inner highlight
          ctx.fillStyle = p.color
          ctx.shadowBlur = p.isBurst ? 22 : 14
          ctx.shadowColor = p.color
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          ctx.fill()
          if (p.isBurst) {
            ctx.globalAlpha = alpha * 0.4
            ctx.fillStyle = '#ffffff'
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.size * 0.45, 0, Math.PI * 2)
            ctx.fill()
          }
        }

        ctx.restore()
      }

      animId = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('resize', resize)
    }
  }, [registerBurst])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50"
      aria-hidden="true"
    />
  )
}
