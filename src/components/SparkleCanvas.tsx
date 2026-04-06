'use client'

import { useEffect, useRef } from 'react'
import { useSparkle } from '@/contexts/SparkleContext'

const COLORS = [
  '#FF2D9B', '#9B2DFF', '#2DAAFF', '#2DFF9B',
  '#FFD700', '#FFFFFF', '#FF6BD6', '#A78BFA',
  '#FF9500', '#FF3BFF', '#00FFF0', '#FFFA65',
]

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
  const { registerBurst } = useSparkle()

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

    const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)]

    // Cursor trail particle – bright, fatty, long-lived
    const spawnTrailParticle = (x: number, y: number) => {
      if (particles.length >= MAX_PARTICLES) particles.shift()
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 4,
        vy: -(Math.random() * 3.5 + 1),
        size: Math.random() * 4.5 + 2.5,
        color: randomColor(),
        life: 0,
        maxLife: Math.floor(Math.random() * 20 + 40), // 40–60 frames ≈ 0.7–1 s
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
      // Spawn 3–5 trail particles per move event
      const count = Math.floor(Math.random() * 3) + 3
      for (let i = 0; i < count; i++) spawnTrailParticle(e.clientX, e.clientY)
    }
    window.addEventListener('mousemove', onMouseMove)

    // Register burst handler – fires an initial explosion + starts a sustained rain zone
    registerBurst((rect: DOMRect) => {
      // Initial big explosion: 20 particles per border point
      for (const pos of borderPositions(rect)) {
        for (let i = 0; i < 20; i++) {
          spawnBurstParticle(
            pos.x + (Math.random() - 0.5) * 40,
            pos.y + (Math.random() - 0.5) * 40,
          )
        }
      }
      // Start a rain zone that keeps emitting for ~2.5 seconds (150 frames @ 60 fps)
      rainZones.push({ rect, age: 0, duration: 150 })
    })

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Tick rain zones and spawn continuous particles
      for (let z = rainZones.length - 1; z >= 0; z--) {
        const zone = rainZones[z]
        zone.age++
        if (zone.age > zone.duration) {
          rainZones.splice(z, 1)
          continue
        }
        // Emit 4–6 particles per frame from random border points
        const emit = Math.floor(Math.random() * 3) + 4
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
        p.vy += p.isBurst ? 0.12 : 0.07 // gravity – burst falls faster/more dramatically
        p.vx *= 0.98                      // slight air resistance
        p.life++

        const alpha = 1 - p.life / p.maxLife
        if (alpha <= 0) {
          particles.splice(i, 1)
          continue
        }

        ctx.save()
        ctx.globalAlpha = alpha
        ctx.fillStyle = p.color
        ctx.shadowBlur = p.isBurst ? 22 : 14
        ctx.shadowColor = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
        // Extra inner glow for burst particles
        if (p.isBurst) {
          ctx.globalAlpha = alpha * 0.4
          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * 0.45, 0, Math.PI * 2)
          ctx.fill()
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
