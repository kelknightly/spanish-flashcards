'use client'

import { useEffect, useRef } from 'react'
import { Sparkles, Snowflake, Sun, RotateCcw } from 'lucide-react'
import type { Theme } from '@/contexts/ThemeContext'
import type { TrailSettings } from '@/contexts/CursorTrailSettingsContext'

interface Props {
  theme: Theme
  settings: TrailSettings
  defaults: TrailSettings
  onUpdate: (partial: Partial<TrailSettings>) => void
  onReset: () => void
  onClose: () => void
}

const THEME_LABELS: Record<Theme, string> = {
  glitter: 'Glitter Trail',
  winter: 'Winter Trail',
  summer: 'Summer Trail',
}

const THEME_ICONS: Record<Theme, React.ReactNode> = {
  glitter: <Sparkles size={15} strokeWidth={2.5} />,
  winter: <Snowflake size={15} strokeWidth={2.5} />,
  summer: <Sun size={15} strokeWidth={2.5} />,
}

export function CursorTrailSettingsPanel({ theme, settings, defaults, onUpdate, onReset, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [onClose])

  const isDefault =
    settings.hue === defaults.hue &&
    settings.sizeMultiplier === defaults.sizeMultiplier &&
    settings.quantityMultiplier === defaults.quantityMultiplier

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-2 z-50 w-64 rounded-2xl border border-white/10 bg-brand-surface/95 p-4 shadow-xl backdrop-blur-md"
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
          {THEME_ICONS[theme]}
          {THEME_LABELS[theme]}
        </div>
        {!isDefault && (
          <button
            onClick={onReset}
            title="Reset to defaults"
            className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
          >
            <RotateCcw size={11} />
            Reset
          </button>
        )}
      </div>

      <div className="space-y-4">
        {/* Colour */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-white/60">Colour</label>
            <span className="text-xs text-white/30">{Math.round(settings.hue)}°</span>
          </div>
          <div className="relative">
            <div
              className="absolute inset-y-0 left-0 right-0 rounded-full pointer-events-none"
              style={{
                background: 'linear-gradient(to right, hsl(0,90%,65%), hsl(30,90%,65%), hsl(60,90%,65%), hsl(90,90%,65%), hsl(120,90%,65%), hsl(150,90%,65%), hsl(180,90%,65%), hsl(210,90%,65%), hsl(240,90%,65%), hsl(270,90%,65%), hsl(300,90%,65%), hsl(330,90%,65%), hsl(360,90%,65%))',
                height: '6px',
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            />
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={settings.hue}
              onChange={e => onUpdate({ hue: Number(e.target.value) })}
              className="trail-slider relative w-full"
              style={{ '--thumb-color': `hsl(${settings.hue}, 90%, 65%)` } as React.CSSProperties}
            />
          </div>
        </div>

        {/* Size */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-white/60">Size</label>
            <span className="text-xs text-white/30">{settings.sizeMultiplier.toFixed(2)}×</span>
          </div>
          <input
            type="range"
            min={0.25}
            max={2.5}
            step={0.05}
            value={settings.sizeMultiplier}
            onChange={e => onUpdate({ sizeMultiplier: Number(e.target.value) })}
            className="trail-slider w-full"
          />
          <div className="mt-0.5 flex justify-between text-[10px] text-white/20">
            <span>Small</span>
            <span>Large</span>
          </div>
        </div>

        {/* Quantity */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-white/60">Quantity</label>
            <span className="text-xs text-white/30">{settings.quantityMultiplier.toFixed(1)}×</span>
          </div>
          <input
            type="range"
            min={0}
            max={3}
            step={0.1}
            value={settings.quantityMultiplier}
            onChange={e => onUpdate({ quantityMultiplier: Number(e.target.value) })}
            className="trail-slider w-full"
          />
          <div className="mt-0.5 flex justify-between text-[10px] text-white/20">
            <span>None</span>
            <span>Dense</span>
          </div>
        </div>
      </div>
    </div>
  )
}
