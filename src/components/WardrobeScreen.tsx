'use client'

import { useEffect, useState } from 'react'

export function WardrobeScreen() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setOpen(true), 400)
    return () => clearTimeout(timer)
  }, [])

  const woodGrainLines = {
    backgroundImage:
      'repeating-linear-gradient(0deg, transparent, transparent 38px, rgba(0,0,0,0.18) 38px, rgba(0,0,0,0.18) 39px)',
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center" style={{ backgroundColor: '#070308' }}>
      {/* Shimmer of light through the gap */}
      <div
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px z-10 transition-opacity duration-700"
        style={{ opacity: open ? 1 : 0, background: 'linear-gradient(to bottom, transparent, rgba(255,220,150,0.6), transparent)', boxShadow: '0 0 20px 8px rgba(255,200,80,0.25)' }}
      />

      {/* ── Left door ────────────────────────────── */}
      <div
        className="absolute inset-y-0 left-0 w-1/2 transition-transform duration-[1000ms] ease-in-out"
        style={{
          background: 'linear-gradient(160deg, #5C2E0D 0%, #8B4A1A 20%, #4A2208 45%, #7A3D14 65%, #3D1C02 100%)',
          transform: open ? 'translateX(-100%)' : 'translateX(0)',
          boxShadow: '6px 0 30px rgba(0,0,0,0.9)',
        }}
      >
        <div className="absolute inset-0 opacity-30" style={woodGrainLines} />
        {/* Raised panel */}
        <div className="absolute inset-6 border border-[#A0622A]/25 rounded-sm">
          <div className="absolute inset-3 border border-[#A0622A]/15 rounded-sm" />
        </div>
        {/* Keyhole */}
        <div className="absolute right-8 top-1/2 -translate-y-1/2 flex flex-col items-center gap-0">
          <svg viewBox="0 0 20 28" className="w-6 h-8 opacity-40" fill="#1A0800">
            <circle cx="10" cy="9" r="6" />
            <path d="M7 15 L8.5 26 L11.5 26 L13 15 Z" />
          </svg>
        </div>
      </div>

      {/* ── Right door ───────────────────────────── */}
      <div
        className="absolute inset-y-0 right-0 w-1/2 transition-transform duration-[1000ms] ease-in-out"
        style={{
          background: 'linear-gradient(200deg, #4A2208 0%, #7A3D14 25%, #8B4A1A 50%, #4A2208 75%, #3D1C02 100%)',
          transform: open ? 'translateX(100%)' : 'translateX(0)',
          boxShadow: '-6px 0 30px rgba(0,0,0,0.9)',
        }}
      >
        <div className="absolute inset-0 opacity-30" style={woodGrainLines} />
        {/* Raised panel */}
        <div className="absolute inset-6 border border-[#A0622A]/25 rounded-sm">
          <div className="absolute inset-3 border border-[#A0622A]/15 rounded-sm" />
        </div>
        {/* Knob */}
        <div className="absolute left-6 top-1/2 -translate-y-1/2">
          <div className="w-5 h-5 rounded-full bg-[#8B5E3C]/60 border border-[#D4A574]/30 shadow-inner" />
        </div>
      </div>

      {/* ── Centre label (fades as doors open) ───── */}
      <div
        className="relative z-10 text-center transition-opacity duration-500 pointer-events-none"
        style={{ opacity: open ? 0 : 1 }}
      >
        <div className="text-5xl mb-3">🦁</div>
        <p className="text-white/25 text-sm tracking-widest uppercase">Narnia awaits…</p>
      </div>
    </div>
  )
}
