'use client'

import { useRef } from 'react'

const BIG_COUNT = 45
const SMALL_COUNT = 50

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

const BIG_PETAL_COLORS = ['#FFB7C5', '#FF93B0', '#FFDDE1', '#FF80AA', '#FFC8D5']
const SMALL_PETAL_COLORS = ['#FFE4EC', '#F8A5B8', '#FFD6E0', '#FFBFD0', '#FFC0CB']
const CENTER_COLORS = ['#FFE066', '#FFD700', '#FFC200', '#FFAA00']

function makeFlowers(count: number, big: boolean, idOffset: number): Petal[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + idOffset,
    left: Math.random() * 115 - 7,
    size: big ? Math.random() * 22 + 16 : Math.random() * 10 + 5,
    delay: Math.random() * 22,
    duration: big ? Math.random() * 10 + 13 : Math.random() * 7 + 7,
    driftX: (Math.random() * 140 + 60) * (Math.random() > 0.5 ? 1 : -1),
    startRot: Math.random() * 360,
    petalColor: big
      ? BIG_PETAL_COLORS[Math.floor(Math.random() * BIG_PETAL_COLORS.length)]
      : SMALL_PETAL_COLORS[Math.floor(Math.random() * SMALL_PETAL_COLORS.length)],
    centerColor: CENTER_COLORS[Math.floor(Math.random() * CENTER_COLORS.length)],
  }))
}

export function PetalLayer() {
  const bigPetals = useRef<Petal[]>(makeFlowers(BIG_COUNT, true, 0)).current
  const smallPetals = useRef<Petal[]>(makeFlowers(SMALL_COUNT, false, BIG_COUNT)).current

  const renderPetal = (p: Petal) => (
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
        filter: p.size > 20 ? 'drop-shadow(0 0 4px rgba(255,150,180,0.5))' : 'none',
      } as React.CSSProperties}
    >
      <g transform="translate(16,16)">
        {[0, 72, 144, 216, 288].map((deg) => (
          <ellipse
            key={deg}
            cx="0"
            cy="-5.5"
            rx="4"
            ry="7"
            fill={p.petalColor}
            opacity="0.92"
            transform={`rotate(${deg})`}
          />
        ))}
        <circle cx="0" cy="0" r="3" fill={p.centerColor} />
      </g>
    </svg>
  )

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      {bigPetals.map(renderPetal)}
      {smallPetals.map(renderPetal)}
    </div>
  )
}
