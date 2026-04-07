'use client'

import { useEffect, useRef } from 'react'
import { useSparkle } from '@/contexts/SparkleContext'
import { useTheme } from '@/contexts/ThemeContext'

const COLORS_GLITTER = [
  '#FF2D9B', '#9B2DFF', '#2DAAFF', '#2DFF9B',
  '#FFD700', '#FFFFFF', '#FF6BD6', '#A78BFA',
  '#FF9500', '#FF3BFF', '#00FFF0', '#FFFA65',
]
const COLORS_WINTER = ['#FFFFFF', '#A8DAFF', '#5BB8FF', '#D0EEFF', '#E8F4FF', '#C8E8FF', '#B0CFFF']
const COLORS_SUMMER = ['#FFB800', '#FF6B35', '#FFE066', '#7FD56F', '#FF9ED2', '#FFF5CC', '#FF8C42', '#FFD700']

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
  const pausedRef = useRef(paused)
  const themeRef = useRef(theme)
  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { themeRef.current = theme }, [theme])

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
      const palette =
        themeRef.current === 'winter' ? COLORS_WINTER :
        themeRef.current === 'summer' ? COLORS_SUMMER :
        COLORS_GLITTER
      return palette[Math.floor(Math.random() * palette.length)]
    }

    // Cursor trail particle – bright, fatty, long-lived
    const spawnTrailParticle = (x: number, y: number) => {
      if (particles.length >= MAX_PARTICLES) particles.shift()
      const isWinter = themeRef.current === 'winter'
      const isSummer = themeRef.current === 'summer'
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * (isWinter ? 3 : 4),
        vy: -(Math.random() * 3.5 + 1),
        size: isWinter
          ? Math.random() * 9 + 5          // 5–14px — big icy shards
          : isSummer
          ? Math.random() * 18 + 8         // 8–26px — giant pink blossoms
          : Math.random() * 4.5 + 2.5,     // original glitter size
        color: randomColor(),
        life: 0,
        maxLife: isWinter
          ? Math.floor(Math.random() * 30 + 55) // 55–85 frames — linger like snow
          : isSummer
          ? Math.floor(Math.random() * 40 + 60) // 60–100 frames — petals drift long
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
      // Spawn more particles for summer (lush petal trail)
      const base = themeRef.current === 'summer' ? 5 : 3
      const count = Math.floor(Math.random() * 3) + base
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

    const draw = () => {
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
          // Full 5-petal blossom — giant pink flowers, varied sizes
          const petalColors = ['#FFB7C5', '#FF80AA', '#FFDDE1', '#FF93B0', '#FFC0CB', '#FFE4EC']
          const centerColors = ['#FFD700', '#FFE066', '#FFAA00']
          const pColor = petalColors[Math.floor(p.x * 6.1) % petalColors.length]
          const cColor = centerColors[Math.floor(p.y * 3.1) % centerColors.length]
          const angle0 = (p.life * 0.03) % (Math.PI * 2) // slow rotation as they fall

          ctx.shadowBlur = 18
          ctx.shadowColor = '#FFB7C5'

          // Draw 5 petals
          for (let petal = 0; petal < 5; petal++) {
            const angle = angle0 + (petal * Math.PI * 2) / 5
            const px = p.x + Math.cos(angle) * p.size * 0.65
            const py = p.y + Math.sin(angle) * p.size * 0.65
            ctx.fillStyle = pColor
            ctx.beginPath()
            ctx.ellipse(px, py, p.size * 0.45, p.size * 0.7, angle, 0, Math.PI * 2)
            ctx.fill()
          }
          // Centre dot
          ctx.shadowBlur = 8
          ctx.fillStyle = cColor
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * 0.28, 0, Math.PI * 2)
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
