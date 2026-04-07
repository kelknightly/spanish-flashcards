'use client'

import { useRef } from 'react'

const SNOWFLAKE_COUNT = 32

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

const CHARS = ['❄', '❅', '❆', '*', '✦', '·']

export function SnowLayer() {
  const flakes = useRef<Flake[]>(
    Array.from({ length: SNOWFLAKE_COUNT }, (_, i) => ({
      id: i,
      left: Math.random() * 105,
      size: Math.random() * 16 + 5,
      delay: Math.random() * 14,
      duration: Math.random() * 9 + 8,
      drift: Math.random() * 80 - 40,
      opacity: Math.random() * 0.55 + 0.35,
      char: CHARS[Math.floor(Math.random() * CHARS.length)],
    }))
  ).current

  return (
    <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden" aria-hidden="true">
      {flakes.map((f) => (
        <span
          key={f.id}
          className="absolute top-0 select-none text-[#A8DAFF]"
          style={{
            left: `${f.left}%`,
            fontSize: `${f.size}px`,
            opacity: f.opacity,
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
      ))}
    </div>
  )
}
