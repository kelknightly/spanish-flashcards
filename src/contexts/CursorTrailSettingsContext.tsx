'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { Theme } from '@/contexts/ThemeContext'

export interface TrailSettings {
  hue: number               // 0–360, full spectrum
  sizeMultiplier: number    // 0.25–2.5, default 1.0
  quantityMultiplier: number // 0–3.0, default 1.0
}

const DEFAULTS: Record<Theme, TrailSettings> = {
  glitter: { hue: 300, sizeMultiplier: 1.0, quantityMultiplier: 1.0 },
  winter:  { hue: 210, sizeMultiplier: 1.0, quantityMultiplier: 1.0 },
  summer:  { hue: 350, sizeMultiplier: 1.0, quantityMultiplier: 1.0 },
}

const STORAGE_KEY = 'sf_trail_settings'

type PerThemeSettings = Record<Theme, TrailSettings>

interface CursorTrailSettingsContextValue {
  settings: PerThemeSettings
  updateThemeSettings: (theme: Theme, partial: Partial<TrailSettings>) => void
  resetTheme: (theme: Theme) => void
  defaults: Record<Theme, TrailSettings>
}

const CursorTrailSettingsContext = createContext<CursorTrailSettingsContextValue | null>(null)

function loadFromStorage(): PerThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<PerThemeSettings>
    // Merge with defaults so newly added fields always have values
    return {
      glitter: { ...DEFAULTS.glitter, ...parsed.glitter },
      winter:  { ...DEFAULTS.winter,  ...parsed.winter  },
      summer:  { ...DEFAULTS.summer,  ...parsed.summer  },
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function CursorTrailSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PerThemeSettings>(() => {
    if (typeof window === 'undefined') return { ...DEFAULTS }
    return loadFromStorage()
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  const updateThemeSettings = (theme: Theme, partial: Partial<TrailSettings>) => {
    setSettings(prev => ({
      ...prev,
      [theme]: { ...prev[theme], ...partial },
    }))
  }

  const resetTheme = (theme: Theme) => {
    setSettings(prev => ({
      ...prev,
      [theme]: { ...DEFAULTS[theme] },
    }))
  }

  return (
    <CursorTrailSettingsContext.Provider value={{ settings, updateThemeSettings, resetTheme, defaults: DEFAULTS }}>
      {children}
    </CursorTrailSettingsContext.Provider>
  )
}

export function useCursorTrailSettings() {
  const ctx = useContext(CursorTrailSettingsContext)
  if (!ctx) throw new Error('useCursorTrailSettings must be used within CursorTrailSettingsProvider')
  return ctx
}
