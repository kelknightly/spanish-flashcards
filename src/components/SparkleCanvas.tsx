'use client'

import { useEffect, useRef } from 'react'
import { useSparkle } from '@/contexts/SparkleContext'

const COLORS = [
  '#FF2D9B', '#9B2DFF', '#2DAAFF', '#2DFF9B',
  '#FFD700', '#C0C0C0', '#FF6BD6', '#A78BFA',
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
}

const MAX_PARTICLES = 60

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

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const spawnParticle = (x: number, y: number) => {
      if (particles.length >= MAX_PARTICLES) {
        // Recycle oldest
        particles.shift()
      }
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 2,
        vy: -(Math.random() * 2 + 0.5),
        size: Math.random() * 3 + 1.5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 0,
        maxLife: Math.floor(Math.random() * 10 + 18),
      })
    }

    const onMouseMove = (e: MouseEvent) => {
      // Spawn 1–2 particles per move event
      spawnParticle(e.clientX, e.clientY)
      if (Math.random() > 0.5) spawnParticle(e.clientX, e.clientY)
    }
    window.addEventListener('mousemove', onMouseMove)

    // Register the border-burst handler with the SparkleContext so any
    // component can trigger a glitter explosion without direct canvas access.
    registerBurst((rect: DOMRect) => {
      // 8 positions around the card border (4 corners + 4 midpoints)
      const positions = [
        { x: rect.left,                      y: rect.top                       },
        { x: rect.left + rect.width  / 2,    y: rect.top                       },
        { x: rect.right,                     y: rect.top                       },
        { x: rect.right,                     y: rect.top + rect.height / 2     },
        { x: rect.right,                     y: rect.bottom                    },
        { x: rect.left + rect.width  / 2,    y: rect.bottom                    },
        { x: rect.left,                      y: rect.bottom                    },
        { x: rect.left,                      y: rect.top + rect.height / 2     },
      ]
      for (const pos of positions) {
        for (let i = 0; i < 5; i++) {
          spawnParticle(
            pos.x + (Math.random() - 0.5) * 24,
            pos.y + (Math.random() - 0.5) * 24,
          )
        }
      }
    })

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.05 // gentle gravity
        p.life++

        const alpha = 1 - p.life / p.maxLife
        if (alpha <= 0) {
          particles.splice(i, 1)
          continue
        }

        ctx.save()
        ctx.globalAlpha = alpha * 0.85
        ctx.fillStyle = p.color
        ctx.shadowBlur = 6
        ctx.shadowColor = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
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
