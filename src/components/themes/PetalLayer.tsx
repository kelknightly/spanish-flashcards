'use client'

import { useRef } from 'react'

const PETAL_COUNT = 22

interface Petal {
  id: number
  left: number
  size: number
  delay: number
  duration: number
  driftX: number
  startRot: number
  petalColor: string
  centerColor: string
}

const PETAL_COLORS = ['#FFB7C5', '#FFDDE1', '#FFC8D5', '#FFE4EC', '#F8A5B8']
const CENTER_COLORS = ['#FFE066', '#FFD700', '#FFC200']

export function PetalLayer() {
  const petals = useRef<Petal[]>(
    Array.from({ length: PETAL_COUNT }, (_, i) => ({
      id: i,
      left: Math.random() * 110 - 5,
      size: Math.random() * 14 + 9,
      delay: Math.random() * 18,
      duration: Math.random() * 9 + 11,
      driftX: Math.random() * 100 + 50,
      startRot: Math.random() * 360,
      petalColor: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)],
      centerColor: CENTER_COLORS[Math.floor(Math.random() * CENTER_COLORS.length)],
    }))
  ).current

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      {petals.map((p) => (
        <svg
          key={p.id}
          viewBox="0 0 32 32"
          className="absolute top-0"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            animationName: 'petal-fall',
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            animationTimingFunction: 'ease-in-out',
            animationIterationCount: 'infinite',
            '--drift-x': `${p.driftX}px`,
            '--start-rot': `${p.startRot}deg`,
            opacity: 0,
          } as React.CSSProperties}
        >
          <g transform="translate(16,16)">
            {[0, 72, 144, 216, 288].map((deg) => (
              <ellipse
                key={deg}
                cx="0"
                cy="-5"
                rx="3.5"
                ry="6"
                fill={p.petalColor}
                opacity="0.88"
                transform={`rotate(${deg})`}
              />
            ))}
            <circle cx="0" cy="0" r="2.5" fill={p.centerColor} />
          </g>
        </svg>
      ))}
    </div>
  )
}
