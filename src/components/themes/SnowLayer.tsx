'use client'

import { useRef } from 'react'

// Two layers: big slow flakes + small fast flakes for depth
const BIG_COUNT = 40
const SMALL_COUNT = 70

interface Flake {
  id: number
  left: number
  size: number
  delay: number
  duration: number
  drift: number
  opacity: number
  char: string
}

const BIG_CHARS = ['❄', '❅', '❆']
const SMALL_CHARS = ['*', '·', '•', '❆']

function makeFlakes(count: number, big: boolean): Flake[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 108 - 4,
    size: big ? Math.random() * 22 + 12 : Math.random() * 8 + 3,
    delay: Math.random() * 18,
    duration: big ? Math.random() * 10 + 10 : Math.random() * 6 + 4,
    drift: big ? Math.random() * 120 - 60 : Math.random() * 50 - 25,
    opacity: big ? Math.random() * 0.5 + 0.45 : Math.random() * 0.5 + 0.3,
    char: big
      ? BIG_CHARS[Math.floor(Math.random() * BIG_CHARS.length)]
      : SMALL_CHARS[Math.floor(Math.random() * SMALL_CHARS.length)],
  }))
}

export function SnowLayer() {
  const bigFlakes = useRef<Flake[]>(makeFlakes(BIG_COUNT, true)).current
  const smallFlakes = useRef<Flake[]>(makeFlakes(SMALL_COUNT, false)).current

  const renderFlake = (f: Flake) => (
    <span
      key={f.id}
      className="absolute top-0 select-none"
      style={{
        left: `${f.left}%`,
        fontSize: `${f.size}px`,
        opacity: f.opacity,
        color: '#A8DAFF',
        textShadow: f.size > 14 ? '0 0 8px rgba(168,218,255,0.7)' : 'none',
        animationName: 'snowfall',
        animationDuration: `${f.duration}s`,
        animationDelay: `${f.delay}s`,
        animationTimingFunction: 'linear',
        animationIterationCount: 'infinite',
        '--drift': `${f.drift}px`,
      } as React.CSSProperties}
    >
      {f.char}
    </span>
  )

  return (
    <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden" aria-hidden="true">
      {bigFlakes.map(renderFlake)}
      {smallFlakes.map((f) => renderFlake({ ...f, id: f.id + BIG_COUNT }))}
    </div>
  )
}
